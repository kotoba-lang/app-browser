(ns etzhayyim.crawler.control-test
  "Parity with `provider/crawler-control-rs`'s job state machine.

  The numbers are a transcript of the crate: it was driven through this exact
  sequence with a fake fetcher and its state printed after each step. One of
  the answers contradicted my first port, which is the reason for doing it this
  way rather than reading the source — see `ingest-result-also-consumes-work`."
  (:require [clojure.test :refer [deftest is testing]]
            [etzhayyim.crawler.control :as ctl]))

(def page
  {:final-url "https://example.com/"
   :status-code 200
   :body "<html><title>Home</title><a href=\"/a\">A</a><p>Body text</p></html>"})

(defn- start []
  (ctl/start-job (ctl/service)
                 {:url "https://example.com" :max-depth 2 :max-pages 10
                  :max-domains 2 :render-javascript false}))

(deftest start-job-matches-the-rust
  (let [{:keys [service job]} (start)]
    (is (= "job-000001" (:job-id job)) "ids are job-%06d from 1")
    (is (= :accepted (:status job)))
    (testing "the seed is already enqueued, so the counters start at 1/0/0"
      (is (= 1 (:frontier-enqueued job)))
      (is (= 0 (:frontier-done job)))
      (is (= 0 (:frontier-failed job)))
      (is (= 0 (:pages-found job))))
    (testing "the second job takes the next id"
      (is (= "job-000002"
             (get-in (ctl/start-job service {:url "https://second.com" :max-depth 1
                                             :max-pages 3 :max-domains 1
                                             :render-javascript true})
                     [:job :job-id]))))))

(deftest a-crawl-step-matches-the-rust
  (let [{svc :service {jid :job-id} :job} (start)
        {svc :service target :target} (ctl/next-target svc jid)
        {svc :service result :result} (ctl/absorb-fetched svc jid target page)]
    (testing "the crate returned res-job-000001-000001 / Home / HomeABody text / 200"
      (is (= "res-job-000001-000001" (:result-id result)))
      (is (= "Home" (:title result)))
      (is (= "HomeABody text" (:snippet result))
          "the summary strips tags, so title text and link text run together")
      (is (= 200 (:status-code result))))
    (testing "after1 status=Running pages=1 enq=2 done=1"
      (let [j (:job (ctl/get-job svc jid))]
        (is (= :running (:status j)))
        (is (= 1 (:pages-found j)))
        (is (= 2 (:frontier-enqueued j)) "the discovered /a link was admitted")
        (is (= 1 (:frontier-done j)))))))

(deftest ingest-result-also-consumes-work
  ;; The crate's `ingest_result` sets Running and then calls
  ;; `frontier_done_success`, which dequeues an item, marks it successful and
  ;; COMPLETES the job if that emptied the queue. Measured: after one step and
  ;; one ingest the job reports Completed, not Running. My first port only set
  ;; Running and would have drifted on the very first ingest.
  (let [{svc :service {jid :job-id} :job} (start)
        {svc :service target :target} (ctl/next-target svc jid)
        {svc :service} (ctl/absorb-fetched svc jid target page)
        {svc :service result :result} (ctl/ingest-result svc jid {:url "https://example.com/x"
                                                                  :title "T" :snippet "S"
                                                                  :status-code 201})]
    (is (= "res-job-000001-000002" (:result-id result)) "one result sequence, service-wide")
    (is (= :completed (:status (:job (ctl/get-job svc jid))))
        "Running is set and then overtaken by completion in the same call")))

(deftest queries-match-the-rust
  (let [{svc :service {jid :job-id} :job} (start)
        {svc :service target :target} (ctl/next-target svc jid)
        {svc :service} (ctl/absorb-fetched svc jid target page)
        {svc :service} (ctl/ingest-result svc jid {:url "https://example.com/x" :title "T"
                                                   :snippet "S" :status-code 201})
        svc (:service (ctl/start-job svc {:url "https://second.com" :max-depth 1
                                          :max-pages 3 :max-domains 1
                                          :render-javascript true}))]
    (testing "list total=2 n=2 (limit 0 means all)"
      (let [lr (ctl/list-results svc jid 0 0)]
        (is (= 2 (:total lr)))
        (is (= 2 (count (:results lr))))))
    (testing "search total=1 — only INDEXED documents match, and ingest does not index"
      (let [sr (ctl/search-results svc "home" 0 10)]
        (is (= 1 (:total sr)))
        (is (= ["res-job-000001-000001"] (mapv :result-id (:results sr))))))
    (testing "stats jobs=2 results=2 indexed=1"
      (is (= {:total-jobs 2 :total-results 2 :total-indexed-docs 1}
             (ctl/get-stats svc))))))

(deftest cancel-stops-further-work
  (let [{svc :service {jid :job-id} :job} (start)
        {svc :service job :job} (ctl/cancel-job svc jid)]
    (is (= :cancelled (:status job)))
    (testing "the crate returned None from process_next after cancelling"
      (is (= :cancelled (:done (ctl/next-target svc jid)))))))

(deftest an-empty-queue-completes-the-job
  (let [{svc :service {jid :job-id} :job} (start)
        {svc :service target :target} (ctl/next-target svc jid)
        ;; a page with no links leaves the frontier empty
        {svc :service} (ctl/absorb-fetched svc jid target
                                           {:final-url "https://example.com/"
                                            :status-code 200 :body "<html>no links</html>"})]
    (is (= :completed (:status (:job (ctl/get-job svc jid)))))
    (is (= :completed (:done (ctl/next-target svc jid))))))

(deftest a-failed-fetch-fails-the-job
  (let [{svc :service {jid :job-id} :job} (start)
        {svc :service target :target} (ctl/next-target svc jid)
        {svc :service} (ctl/fetch-failed svc jid target)
        j (:job (ctl/get-job svc jid))]
    (testing "one failed fetch is a failed job, which is the crate's rule"
      (is (= :failed (:status j)))
      (is (= 1 (:frontier-failed j)))
      (is (= 0 (:pages-found j))))))

(deftest an-unknown-job-is-an-error-not-an-empty-answer
  (let [svc (ctl/service)]
    (is (= :job-not-found (:error (ctl/get-job svc "nope"))))
    (is (= :job-not-found (:error (ctl/cancel-job svc "nope"))))
    (is (= :job-not-found (:error (ctl/list-results svc "nope" 0 10))))))

(deftest routing-matches-the-rust
  (testing "the crate lists exactly these six kinds"
    (is (= #{"crawler.job.start" "crawler.job.cancel" "crawler.job.status"
             "crawler.result.list" "crawler.result.search" "crawler.stats.get"}
           (set (keys ctl/kind->route)))))
  (is (= {:route :query :op :get-stats :body {}}
         (ctl/route-extension {:kind "crawler.stats.get" :body {}})))
  (is (= {:route :command :op :start-job :body {:url "u"}}
         (ctl/route-extension {:kind "crawler.job.start" :body {:url "u"}})))
  (testing "an unknown kind is refused by name"
    (is (= {:error :unsupported-kind :kind "nope"}
           (ctl/route-extension {:kind "nope" :body {}})))))
