(ns etzhayyim.crawler.control
  "The crawler's job state machine: start, cancel, absorb a page, report.

  The rest of the `.cljc` port of `provider/crawler-control-rs`
  (ADR-2607072000). `etzhayyim.crawler.page` took what a page yields; this
  takes what a JOB does with it.

  ## The gateways are gone, on purpose

  The Rust's `process_next` takes `FetchGateway` and `IndexGateway` and calls
  them in the middle of a state transition. That is dependency injection doing
  the job of a boundary: the effect is still inside the transition, it just
  arrives by argument.

  Here the transition is split where the effect actually is:

    (next-target svc job-id)   -> what to fetch, or why there is nothing
    ... the caller fetches ...
    (absorb-fetched svc job-id target page) -> next state + result + document

  which is the `state + event -> next-state + effects` shape CLAUDE.md asks
  for. The caller owns the fetching, and both halves are testable without a
  fake gateway.

  SSoT INVARIANT with `provider/crawler-control-rs/src/lib.rs`; expectations in
  `control_test.cljc` came from running it."
  (:require [kotoba.lang.text :as str]
            [etzhayyim.crawler.frontier :as frontier]
            [etzhayyim.crawler.page :as page]))

;; ── extension envelopes ─────────────────────────────────────────────────────

(def kind->route
  "The six envelope kinds the extension may send, and whether each changes
  anything. As data: the crate spells this as a six-arm match, which cannot be
  enumerated by a caller wanting to know what it may send."
  {"crawler.job.start"     [:command :start-job]
   "crawler.job.cancel"    [:command :cancel-job]
   "crawler.job.status"    [:query :get-job]
   "crawler.result.list"   [:query :list-results]
   "crawler.result.search" [:query :search-results]
   "crawler.stats.get"     [:query :get-stats]})

(defn route-extension
  "Envelope -> {:route :command|:query :op kw :body m}, or {:error …}.

  An unknown kind is refused by name rather than ignored, so a caller that
  ships a typo hears about it instead of watching nothing happen."
  [{:keys [kind body]}]
  (if-let [[route op] (get kind->route kind)]
    {:route route :op op :body body}
    {:error :unsupported-kind :kind kind}))

;; ── service ─────────────────────────────────────────────────────────────────

(defn service [] {:jobs {} :next-job-seq 0 :next-result-seq 0})

(defn- pad6 [n]
  (let [s (str n)] (str (apply str (repeat (max 0 (- 6 (count s))) "0")) s)))

(defn- next-job-id [svc]
  (let [n (inc (:next-job-seq svc))]
    [(assoc svc :next-job-seq n) (str "job-" (pad6 n))]))

(defn- next-result-id [svc job-id]
  (let [n (inc (:next-result-seq svc))]
    [(assoc svc :next-result-seq n) (str "res-" job-id "-" (pad6 n))]))

(defn start-job
  "Accept a crawl. → {:service s :job j}."
  [svc {:keys [url max-depth max-pages max-domains render-javascript org-id]}]
  (let [[svc job-id] (next-job-id svc)
        host (or (page/url-host url) "")
        fr (frontier/frontier url host {:max-depth max-depth
                                        :max-pages max-pages
                                        :max-domains max-domains})
        stats (frontier/stats fr)
        job {:job-id job-id :org-id org-id :url url :status :accepted
             :max-depth max-depth :max-pages max-pages :max-domains max-domains
             :render-javascript render-javascript
             :pages-found 0
             :frontier-enqueued (:frontier-enqueued stats)
             :frontier-done (:frontier-done stats)
             :frontier-failed (:frontier-failed stats)}]
    {:service (assoc-in svc [:jobs job-id]
                        {:job job :frontier fr :results [] :indexed []})
     :job job}))

(defn- with-job [svc job-id f]
  (if-let [record (get-in svc [:jobs job-id])]
    (f record)
    {:error :job-not-found :job-id job-id}))

(defn cancel-job [svc job-id]
  (with-job svc job-id
    (fn [record]
      (let [job (assoc (:job record) :status :cancelled)]
        {:service (assoc-in svc [:jobs job-id :job] job) :job job}))))

(defn get-job [svc job-id]
  (with-job svc job-id (fn [record] {:job (:job record)})))

(defn list-results [svc job-id offset limit]
  (with-job svc job-id
    (fn [{:keys [results]}]
      {:total (count results) :results (page/paginate results offset limit)})))

(defn search-results
  "Substring search across EVERY job's indexed documents, not one job's.

  The crate iterates `self.jobs.values()`, so a query reaches other crawls'
  pages. Preserved, and stated here rather than left to be discovered by
  someone who assumed a search was scoped to the job they asked about.

  Order follows map iteration, which is unspecified in both languages; callers
  that need determinism must sort."
  [svc query offset limit]
  (let [needle (str/lower (or query ""))
        hit? (fn [doc]
               (some #(str/includes? (str/lower (or (get doc %) "")) needle)
                     [:title :snippet :content :url]))
        matches (vec (for [record (vals (:jobs svc))
                           doc (:indexed record)
                           :when (hit? doc)]
                       {:result-id (:doc-id doc) :job-id (:job-id doc)
                        :url (:url doc) :title (:title doc)
                        :snippet (:snippet doc) :text-content (:content doc)
                        :status-code 200}))]
    {:total (count matches) :results (page/paginate matches offset limit)}))

(defn- sync-stats [record]
  (let [s (frontier/stats (:frontier record))]
    (update record :job merge {:pages-found (:pages-found s)
                               :frontier-enqueued (:frontier-enqueued s)
                               :frontier-done (:frontier-done s)
                               :frontier-failed (:frontier-failed s)})))

(defn ingest-result
  "Record a page fetched elsewhere. → {:service s :result r}.

  This also CONSUMES ONE FRONTIER ITEM and marks it successful, then completes
  the job if that emptied the queue. So the job can come back `:completed`
  from a call that sets `:running` two lines earlier — which is what the crate
  does (`frontier_done_success`), and is not obvious from reading the setter.

  Measured against the crate: after one `process-next` and one `ingest-result`
  the job reports `Completed`, not `Running`. A port that only set `:running`
  here would drift from it on the very first ingest, which is how this was
  caught."
  [svc job-id {:keys [url title snippet status-code]}]
  (let [[svc result-id] (next-result-id svc job-id)]
    (with-job svc job-id
      (fn [record]
        (let [result {:result-id result-id :job-id job-id :url url :title title
                      :snippet snippet :text-content snippet
                      :status-code status-code}
              {fr :state [item] :items} (frontier/dequeue-batch (:frontier record) 1)
              fr (cond-> fr item (frontier/mark-success item))
              record (-> record
                         (assoc :frontier fr)
                         (update :results conj result)
                         (assoc-in [:job :status] :running)
                         sync-stats)
              record (cond-> record
                       (zero? (frontier/queued-len fr))
                       (assoc-in [:job :status] :completed))]
          {:service (assoc-in svc [:jobs job-id] record)
           :result result})))))

(defn get-stats [svc]
  {:total-jobs (count (:jobs svc))
   :total-results (reduce + 0 (map #(count (:results %)) (vals (:jobs svc))))
   :total-indexed-docs (reduce + 0 (map #(count (:indexed %)) (vals (:jobs svc))))})

;; ── the crawl step, split at the effect ─────────────────────────────────────

(defn next-target
  "What to fetch next for `job-id`.

  → {:service s :target item} when there is work,
    {:service s :done :cancelled|:completed} when there is not.

  A finished queue completes the job here rather than on the next call, which
  is what the crate does: `dequeue_batch` returning nothing IS completion."
  [svc job-id]
  (with-job svc job-id
    (fn [{:keys [job frontier] :as record}]
      (if (#{:cancelled :completed} (:status job))
        {:service svc :done (:status job)}
        (let [{fr :state [item] :items} (frontier/dequeue-batch frontier 1)]
          (if (nil? item)
            {:service (assoc-in svc [:jobs job-id :job :status] :completed)
             :done :completed}
            {:service (-> svc
                          (assoc-in [:jobs job-id :frontier] fr)
                          (assoc-in [:jobs job-id :job :status] :running))
             :target item}))))))

(defn fetch-failed
  "The fetch for `target` did not return. Marks the item failed and the job
  Failed — the crate treats one failed fetch as a failed job."
  [svc job-id target]
  (with-job svc job-id
    (fn [record]
      (let [record (-> record
                       (update :frontier frontier/mark-failure target)
                       sync-stats
                       (assoc-in [:job :status] :failed))]
        {:service (assoc-in svc [:jobs job-id] record) :status :failed}))))

(defn absorb-fetched
  "Fold a fetched page into the job: a result, an indexed document, the links
  it discovered, and the frontier bookkeeping.

  → {:service s :result r :document d}.

  `page` is {:final-url :body :status-code}. The title falls back to the final
  URL when the document has none — an untitled page still has to be findable."
  [svc job-id target {:keys [final-url body status-code]}]
  (let [[svc result-id] (next-result-id svc job-id)]
    (with-job svc job-id
      (fn [record]
        (let [content (or body "")
              title (or (page/extract-title content) final-url)
              snippet (page/summarize-text content)
              discovered (page/extract-links final-url content)
              result {:result-id result-id :job-id job-id :url final-url
                      :title title :snippet snippet :text-content content
                      :status-code status-code}
              document {:doc-id result-id :job-id job-id :url final-url
                        :title title :snippet snippet :content content}
              fr (:state (frontier/enqueue-discovered (:frontier record) target discovered))
              fr (frontier/mark-success fr target)
              record (-> record
                         (assoc :frontier fr)
                         (update :results conj result)
                         (update :indexed conj document)
                         sync-stats)
              record (cond-> record
                       (zero? (frontier/queued-len fr))
                       (assoc-in [:job :status] :completed))]
          {:service (assoc-in svc [:jobs job-id] record)
           :result result
           :document document})))))
