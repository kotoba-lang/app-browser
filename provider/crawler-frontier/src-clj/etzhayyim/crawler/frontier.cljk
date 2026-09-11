(ns etzhayyim.crawler.frontier
  "What the crawler visits next, and what it refuses to.

  A `.cljc` port of `provider/crawler-frontier-rs` (ADR-2607072000: work that
  would reach for Rust is written here). The Rust crate is a `VecDeque` plus two
  `HashSet`s behind `&mut self` methods and no I/O at all — it is not a
  performance mechanism, it is the policy that decides which URLs enter the
  crawl. That is the part this workspace keeps in portable source.

  The shape changes on the way over, deliberately. The Rust mutates a struct;
  here every operation is `state -> {:state … :result …}`, which is the
  `state + event -> next-state` form CLAUDE.md asks for. A frontier is a thing
  you want to snapshot, replay and diff — three limits, a queue and two seen
  sets — and a value gives you that for free.

  SSoT INVARIANT: the decisions here and in
  `provider/crawler-frontier-rs/src/lib.rs` must agree. Change one, change
  both, and extend `frontier_test.cljc`, whose expectations were produced by
  RUNNING the crate rather than by reading it.

  Two behaviours are load-bearing and easy to \"fix\" into something else:

    The page budget counts pages ALREADY FOUND PLUS everything enqueued, and
    is checked BEFORE dedup. So re-offering a URL already in the frontier can
    fail with :max-pages-exceeded rather than being ignored as a duplicate —
    the budget is on work admitted, not on distinct pages.

    Depth is rejected with an error, but a duplicate URL is not: an error and
    a plain `false` mean different things to the caller, and collapsing them
    loses the distinction between \"this crawl is over its limit\" and \"we
    already have that one\"."
  (:require [clojure.string :as str]))

;; ── construction ────────────────────────────────────────────────────────────

(defn host-from-url
  "The authority of a URL, or nil.

  Same narrow scan as the Rust: split once on `://`, take up to the next `/`.
  No lower-casing and no port stripping — unlike `common-crawl`'s
  `extract-domain`, which does both. They are not the same function and must
  not be unified without deciding which corpus gets re-keyed."
  [raw]
  (when (string? raw)
    (when-let [i (str/index-of raw "://")]
      (let [rest (subs raw (+ i 3))
            end (or (str/index-of rest "/") (count rest))]
        (subs rest 0 end)))))

(defn frontier
  "A frontier seeded with one URL. `cfg` is {:max-depth :max-pages :max-domains}."
  [seed-url seed-host cfg]
  {:cfg cfg
   :queue [{:url seed-url :host seed-host :depth 0 :parent-url nil}]
   :seen-urls #{seed-url}
   :seen-hosts #{seed-host}
   :host-inflight {}
   :stats {:pages-found 0 :frontier-enqueued 1 :frontier-done 0
           :frontier-failed 0 :domains-seen 1}})

;; ── admission ───────────────────────────────────────────────────────────────

(defn enqueue
  "Offer one item. → {:state s :result true|false} on admission or refusal by
  dedup, or {:state s :error kw} when a limit stops the crawl.

  Order matters and is the Rust's: depth, then the page budget, then dedup,
  then the domain budget. Checking dedup earlier would make a duplicate free
  once the budget is spent, which is a different policy."
  [{:keys [cfg seen-urls seen-hosts stats] :as state} {:keys [url host depth] :as item}]
  (cond
    (> depth (:max-depth cfg))
    {:state state :error :depth-limit-exceeded}

    (>= (+ (:pages-found stats) (:frontier-enqueued stats)) (:max-pages cfg))
    {:state state :error :max-pages-exceeded}

    (contains? seen-urls url)
    {:state state :result false}

    (and (not (contains? seen-hosts host))
         (>= (count seen-hosts) (:max-domains cfg)))
    {:state state :error :max-domains-exceeded}

    :else
    (let [new-host? (not (contains? seen-hosts host))]
      {:state (-> state
                  (update :seen-urls conj url)
                  (update :seen-hosts conj host)
                  (update :queue conj item)
                  (update-in [:stats :frontier-enqueued] inc)
                  (cond-> new-host? (update-in [:stats :domains-seen] inc)))
       :result true})))

(defn enqueue-discovered
  "Offer every URL found on `parent`'s page, at one greater depth.

  → {:state s :results [...]}, one entry per URL in order, each the `:result`
  or `:error` that `enqueue` gave. The Rust returns the same per-URL vector;
  callers use it to tell \"already seen\" from \"budget spent\"."
  [state parent urls]
  (let [next-depth (inc (:depth parent))]
    (reduce (fn [{:keys [state results]} url]
              (let [r (enqueue state {:url url
                                      :host (or (host-from-url url) "")
                                      :depth next-depth
                                      :parent-url (:url parent)})]
                {:state (:state r)
                 :results (conj results (if (contains? r :error) (:error r) (:result r)))}))
            {:state state :results []}
            urls)))

;; ── work ────────────────────────────────────────────────────────────────────

(defn dequeue-batch
  "Take up to `limit` items, counting each against its host's in-flight tally.
  → {:state s :items [...]}."
  [state limit]
  (let [items (vec (take limit (:queue state)))]
    {:state (-> state
                (update :queue #(vec (drop (count items) %)))
                (update :host-inflight
                        (fn [m] (reduce (fn [m {:keys [host]}]
                                          (update m host (fnil inc 0)))
                                        m items))))
     :items items}))

(defn- release-host [state host]
  (update state :host-inflight
          (fn [m]
            (if-let [n (get m host)]
              (if (<= n 1) (dissoc m host) (assoc m host (dec n)))
              m))))

(defn mark-success [state item]
  (-> state
      (update-in [:stats :pages-found] inc)
      (update-in [:stats :frontier-done] inc)
      (release-host (:host item))))

(defn mark-failure [state item]
  (-> state
      (update-in [:stats :frontier-done] inc)
      (update-in [:stats :frontier-failed] inc)
      (release-host (:host item))))

(defn stats [state] (:stats state))
(defn queued-len [state] (count (:queue state)))
