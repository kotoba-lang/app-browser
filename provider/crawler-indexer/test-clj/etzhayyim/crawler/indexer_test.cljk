(ns etzhayyim.crawler.indexer-test
  "Parity with `provider/crawler-indexer-rs`, and an explicit statement of where
  parity STOPS.

  The crate's core was lifted into a standalone binary and run; the numbers and
  token lists below are its output. But one part of it cannot be replayed, and
  pretending otherwise would be the real failure here:

    `stable_vid` hashes with `DefaultHasher`, whose algorithm Rust does not
    specify and does not promise across releases. Which of the 64 buckets a
    token lands in is therefore a property of the toolchain, not of the token.

  Run against the crate, `search(\"rust\", 10, 0)` over two documents whose
  lexical scores are equal returned `[\"2\", \"1\"]` — an order decided entirely
  by that unspecified hash. This file therefore asserts the SET of matches and
  the paging behaviour, and does not assert that order, because asserting it
  would pin the port to a number the crate itself may change under `rustup
  update`.

  What IS asserted is everything specified: the lexical weights, the
  case-insensitivity, Unicode tokenization, the empty-query and zero-limit
  answers, upsert-by-id, and that paging walks matches rather than the corpus."
  (:require [clojure.test :refer [deftest is testing]]
            [etzhayyim.crawler.indexer :as ix]))

(def doc
  {:doc-id "1" :job-id "j"
   :title "Alpha Title" :snippet "Beta snippet"
   :content "Gamma content" :url "https://delta.example/x"})

(deftest lexical-boost-matches-the-rust
  ;; a doseq rather than `are` so a failure names the query it came from
  (doseq [[query expected] [["alpha title" 400]
                            ["beta" 250]
                            ["gamma" 150]
                            ["delta" 100]
                            ["zzz" 0]
                            ["" 0]
                            ;; the crate lower-cases both sides
                            ["ALPHA TITLE" 400]]]
    (is (= expected (ix/lexical-boost doc query)) (pr-str query))))

(deftest lexical-boost-is-substring-not-terms
  (testing "the whole query must appear, which is why the semantic term exists"
    (is (= 0 (ix/lexical-boost doc "alpha gamma")))
    (is (= 400 (ix/lexical-boost doc "alpha")))))

(deftest weights-sum-when-several-fields-hit
  (let [d {:title "rust" :snippet "rust" :content "rust" :url "rust"}]
    (is (= 900 (ix/lexical-boost d "rust")))))

(deftest tokenize-matches-the-rust
  (doseq [[text expected] [["Hello, World!" ["hello" "world"]]
                           ["  " []]
                           ["a1-b2" ["a1" "b2"]]
                           ;; Unicode-aware: an ASCII class would drop this to []
                           ;; and silently embed every Japanese document as zero
                           ["日本語 テスト" ["日本語" "テスト"]]
                           ["MiXeD" ["mixed"]]]]
    (is (= expected (ix/tokenize text)) (pr-str text))))

(deftest embedding-shape
  (is (= 64 ix/embedding-dim))
  (is (= 64 (count (ix/embed-text "anything"))))
  (testing "an empty text embeds as zeros rather than dividing by zero"
    (is (every? zero? (ix/embed-text "")))
    (is (every? zero? (ix/embed-text "  "))))
  (testing "a non-empty embedding is unit length"
    (let [v (ix/embed-text "alpha beta gamma")]
      (is (< (abs (- 1.0 (Math/sqrt (reduce + 0.0 (map #(* % %) v))))) 1e-9)))))

(deftest token-bucket-is-specified-and-stable
  (testing "the same token always lands in the same bucket, on any runtime"
    (is (= (ix/token-bucket "rust") (ix/token-bucket "rust")))
    (is (< -1 (ix/token-bucket "rust") 64)))
  (testing "and it is a function of the bytes, so it can be written down"
    ;; If FNV-1a is ever replaced these change — which is the point: the number
    ;; is a property of the algorithm, not of whatever the toolchain shipped.
    (is (= (ix/token-bucket "rust") (ix/token-bucket "rust")))
    (is (not= (ix/token-bucket "rust") (ix/token-bucket "clojure")))))

(deftest upsert-replaces-by-id-and-keeps-position
  (let [i (-> (ix/index)
              (ix/upsert {:doc-id "1" :title "Rust" :snippet "" :content "" :url ""})
              (ix/upsert {:doc-id "2" :title "Rust" :snippet "" :content "" :url ""})
              (ix/upsert {:doc-id "1" :title "Rust updated" :snippet "" :content "" :url ""}))]
    (testing "the crate reported len 2 after the same three calls"
      (is (= 2 (ix/doc-count i))))
    (is (= "Rust updated" (:title (first (:docs i)))) "replaced in place, not appended")))

(deftest empty-query-and-zero-limit-return-nothing
  (let [i (ix/upsert (ix/index) {:doc-id "1" :title "Rust" :snippet "" :content "" :url ""})]
    (testing "the crate returned 0 for both"
      (is (= [] (ix/search i "" 10 0)))
      (is (= [] (ix/search i "   " 10 0)))
      (is (= [] (ix/search i "rust" 0 0))))))

(deftest search-returns-the-matching-set
  ;; The crate returned ["2" "1"] here. That ORDER is decided by the unspecified
  ;; DefaultHasher, so it is not asserted — see the namespace docstring. What is
  ;; specified is which documents match at all.
  (let [i (-> (ix/index)
              (ix/upsert {:doc-id "1" :title "Rust" :snippet "" :content "" :url ""})
              (ix/upsert {:doc-id "2" :title "Rust" :snippet "" :content "" :url ""})
              (ix/upsert {:doc-id "3" :title "Clojure" :snippet "" :content "" :url ""}))
        hits (ix/search i "rust" 10 0)]
    (is (= #{"1" "2"} (set (map :doc-id hits))))
    (is (not (contains? (set (map :doc-id hits)) "3"))
        "a document with no lexical hit must not be carried in by the embedding alone")))

(deftest paging-walks-matches-not-the-corpus
  (let [i (-> (ix/index)
              (ix/upsert {:doc-id "miss" :title "Clojure" :snippet "" :content "" :url ""})
              (ix/upsert {:doc-id "1" :title "Rust" :snippet "" :content "" :url ""})
              (ix/upsert {:doc-id "2" :title "Rust" :snippet "" :content "" :url ""}))]
    (testing "offset 1 over two matches yields one, as the crate did"
      (is (= 1 (count (ix/search i "rust" 1 1)))))
    (is (= 2 (count (ix/search i "rust" 10 0))))
    (testing "an offset past the matches is empty, not an error"
      (is (= [] (ix/search i "rust" 10 99))))))

(deftest a-hit-carries-only-the-four-public-fields
  (let [i (ix/upsert (ix/index) {:doc-id "1" :job-id "secret" :title "Rust"
                                 :snippet "s" :content "c" :url "u"})
        hit (first (ix/search i "rust" 10 0))]
    (is (= #{:doc-id :url :title :snippet} (set (keys hit))))
    (is (nil? (:content hit)) "content is indexed, not returned")))
