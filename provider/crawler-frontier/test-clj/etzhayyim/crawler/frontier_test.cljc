(ns etzhayyim.crawler.frontier-test
  "Parity with `provider/crawler-frontier-rs`.

  The numbers below are a TRANSCRIPT of the Rust, not a reading of it: the
  crate's core was lifted into a standalone binary (it needs nothing but std
  once the derives are stripped), driven through the sequence this file
  replays, and its stats printed after every step. Replaying the same script
  is what makes this a parity test rather than a restatement of my own port."
  (:require [clojure.test :refer [deftest is testing]]
            [etzhayyim.crawler.frontier :as f]))

(def cfg {:max-depth 2 :max-pages 6 :max-domains 2})

(defn- seeded [] (f/frontier "https://example.com" "example.com" cfg))

(defn- snapshot [state]
  (assoc (f/stats state) :queued (f/queued-len state)))

(deftest the-rust-transcript-replays-exactly
  (let [s0 (seeded)]
    (testing "seed"
      (is (= {:pages-found 0 :frontier-enqueued 1 :frontier-done 0
              :frontier-failed 0 :domains-seen 1 :queued 1}
             (snapshot s0))))

    (let [{s1 :state [item] :items} (f/dequeue-batch s0 1)]
      (testing "dequeue1"
        (is (= "https://example.com" (:url item)))
        (is (= {:pages-found 0 :frontier-enqueued 1 :frontier-done 0
                :frontier-failed 0 :domains-seen 1 :queued 0}
               (snapshot s1))))

      (let [s2 (f/mark-success s1 item)]
        (testing "success"
          (is (= {:pages-found 1 :frontier-enqueued 1 :frontier-done 1
                  :frontier-failed 0 :domains-seen 1 :queued 0}
                 (snapshot s2))))

        (let [a {:url "https://example.com/a" :host "example.com" :depth 1 :parent-url nil}
              r1 (f/enqueue s2 a)
              r2 (f/enqueue (:state r1) a)
              r3 (f/enqueue (:state r2) {:url "https://deep.example.com/x"
                                         :host "deep.example.com" :depth 3 :parent-url nil})
              r4 (f/enqueue (:state r3) {:url "https://other.com/1"
                                         :host "other.com" :depth 1 :parent-url nil})
              r5 (f/enqueue (:state r4) {:url "https://third.com/1"
                                         :host "third.com" :depth 1 :parent-url nil})]
          (testing "admission answers, one per Rust line"
            (is (= true (:result r1)) "enq-a Ok(true)")
            (is (= false (:result r2)) "enq-a-dup Ok(false) — a duplicate is not an error")
            (is (= :depth-limit-exceeded (:error r3)) "enq-too-deep Err(DepthLimitExceeded)")
            (is (= true (:result r4)) "enq-host2 Ok(true)")
            (is (= :max-domains-exceeded (:error r5)) "enq-host3 Err(MaxDomainsExceeded)"))
          (testing "a refused item leaves the state untouched"
            (is (= (snapshot (:state r4)) (snapshot (:state r5)))))
          (testing "after-enqueues"
            (is (= {:pages-found 1 :frontier-enqueued 3 :frontier-done 1
                    :frontier-failed 0 :domains-seen 2 :queued 2}
                   (snapshot (:state r5)))))

          (let [parent {:url "https://example.com" :host "example.com" :depth 0 :parent-url nil}
                d (f/enqueue-discovered (:state r5) parent
                                        ["https://example.com/b"
                                         "https://example.com/a"
                                         "https://example.com/c"])]
            (testing "discovered [Ok(true), Ok(false), Ok(true)] — order preserved"
              (is (= [true false true] (:results d))))
            (testing "after-discovered"
              (is (= {:pages-found 1 :frontier-enqueued 5 :frontier-done 1
                      :frontier-failed 0 :domains-seen 2 :queued 4}
                     (snapshot (:state d)))))

            (let [{s :state items :items} (f/dequeue-batch (:state d) 10)]
              (testing "batch2 is FIFO, in the Rust's order"
                (is (= 4 (count items)))
                (is (= ["https://example.com/a" "https://other.com/1"
                        "https://example.com/b" "https://example.com/c"]
                       (mapv :url items))))
              (testing "after-failure"
                (is (= {:pages-found 1 :frontier-enqueued 5 :frontier-done 2
                        :frontier-failed 1 :domains-seen 2 :queued 0}
                       (snapshot (f/mark-failure s (first items)))))))))))))

(deftest the-page-budget-counts-admitted-work-not-distinct-pages
  ;; pages-found + frontier-enqueued is checked BEFORE dedup, so once the budget
  ;; is spent even a URL already seen is refused with an error rather than being
  ;; quietly reported as a duplicate. Easy to "simplify" away; it is the Rust's.
  (let [tight (f/frontier "https://example.com" "example.com"
                          {:max-depth 5 :max-pages 1 :max-domains 5})
        dup (f/enqueue tight {:url "https://example.com" :host "example.com"
                              :depth 1 :parent-url nil})]
    (is (= :max-pages-exceeded (:error dup)))
    (is (nil? (:result dup)))))

(deftest depth-is-an-error-and-a-duplicate-is-not
  (testing "the caller can tell 'over the limit' from 'already have it'"
    (let [s (seeded)]
      (is (= :depth-limit-exceeded
             (:error (f/enqueue s {:url "https://x/1" :host "x" :depth 99 :parent-url nil}))))
      (is (= false
             (:result (f/enqueue s {:url "https://example.com" :host "example.com"
                                    :depth 1 :parent-url nil})))))))

(deftest host-in-flight-is-released-on-both-outcomes
  (let [{s :state [item] :items} (f/dequeue-batch (seeded) 1)]
    (is (= {"example.com" 1} (:host-inflight s)))
    (is (= {} (:host-inflight (f/mark-success s item))))
    (is (= {} (:host-inflight (f/mark-failure s item))))))

(deftest host-from-url-matches-the-rust
  (is (= "a.b.c" (f/host-from-url "https://a.b.c/x/y")))
  (is (= "a.b.c" (f/host-from-url "https://a.b.c")))
  (is (nil? (f/host-from-url "nope")))
  (testing "unlike common-crawl's extract-domain, the port neither lower-cases
            nor strips a port — these are different functions over different
            corpora and must not be quietly unified"
    (is (= "A.B.C:8080" (f/host-from-url "https://A.B.C:8080/p")))))
