(ns etzhayyim.crawler.indexer
  "The crawler's projection index: upsert documents, rank them for a query.

  A `.cljc` port of `provider/crawler-indexer-rs` (ADR-2607072000). Like the
  frontier, that crate has no I/O — it is a vector of documents, a bag-of-words
  embedding and a scoring function, i.e. a decision about what a search
  RETURNS. That belongs in portable source.

  ## Boundary with `kotoba-lang/search`

  `search.model` is the workspace's other in-memory index, and it is NOT this
  one: it scores field-weighted term matches (`{:title 4 :tags 3 :body 1}`).
  This scores a lexical hit PLUS a cosine similarity over a hashed 64-bucket
  embedding. Adopting `search.model` here would change which pages a crawl
  returns and in what order, so the two stay separate until someone decides
  that trade deliberately.

  ## One thing the Rust cannot promise, and this does

  `stable_vid` in the crate hashes with `std::collections::hash_map::
  DefaultHasher`, whose algorithm Rust explicitly does not specify:
  \"the internal algorithm is not specified, and so it and its hashes should
  not be relied upon over releases.\" The bucket a token lands in is therefore
  a function of the toolchain, which means embeddings written by two builds of
  the same crate are not guaranteed comparable — a latent defect the port
  cannot inherit and should not imitate.

  So `token-bucket` here is FNV-1a 32, written out: a specified function of the
  bytes, identical on every runtime and every version. (32 rather than 64
  because ClojureScript has no 64-bit integer — a `.cljc` FNV-1a 64 would
  silently degrade into doubles on one of the two hosts.) That makes this port
  deliberately NOT bit-identical to the Rust in the semantic component. The
  lexical component, the ranking rule, the tie order and the upsert semantics
  ARE identical, and are pinned against the crate in the tests."
  (:require [kotoba.lang.text :as str]))

(def embedding-dim 64)

;; ── tokens ──────────────────────────────────────────────────────────────────

(defn tokenize
  "Lower-cased runs of Unicode letters/digits.

  The Rust splits on `!char::is_alphanumeric()`, which is Unicode-aware, so the
  pattern is `\\p{L}\\p{N}` rather than ASCII `\\w` — an ASCII class would split
  Japanese into nothing and quietly make every such document embed as zero."
  [text]
  (->> (re-seq #"[\p{L}\p{N}]+" (or text ""))
       (map str/lower)
       vec))

(def ^:private fnv-offset-32
  ;; 2166136261 does not fit a signed 32-bit int; `unchecked-int` takes the
  ;; two's-complement bits, which is what FNV-1a means by its offset basis.
  #?(:clj (unchecked-int 2166136261) :cljs 2166136261))
(def ^:private fnv-prime-32 16777619)

(defn- mul32
  "32-bit wrapping multiply, spelled per host.

  FNV-1a is defined over a fixed width, so the wrap IS the algorithm — take it
  away and different hosts produce different buckets, which is the exact defect
  this function exists to avoid. The 64-bit variant is not an option here:
  ClojureScript has no 64-bit integer, so a `.cljc` FNV-1a 64 would either
  overflow into doubles or need a bignum, and the first is silent."
  [a b]
  #?(:clj  (unchecked-int (unchecked-multiply (int a) (int b)))
     :cljs (js/Math.imul a b)))

(defn- utf8-bytes [^String token]
  #?(:clj (seq (.getBytes token "UTF-8"))
     :cljs (array-seq (.encode (js/TextEncoder.) token))))

(defn token-bucket
  "Which of the 64 buckets a token counts in — FNV-1a 32 over its UTF-8 bytes.

  Specified on purpose; see the namespace docstring for what it replaces.
  `embedding-dim` is a power of two, so masking the low bits is the unsigned
  remainder and sidesteps sign entirely."
  [token]
  (let [h (reduce (fn [h b] (mul32 (bit-xor h (bit-and b 0xff)) fnv-prime-32))
                  fnv-offset-32
                  (utf8-bytes token))]
    (bit-and h (dec embedding-dim))))

;; ── embedding ───────────────────────────────────────────────────────────────

(defn- normalize [v]
  (let [norm (Math/sqrt (reduce + 0.0 (map #(* % %) v)))]
    (if (zero? norm) v (mapv #(/ % norm) v))))

(defn embed-text
  "Bag of tokens over `embedding-dim` buckets, L2-normalised."
  [text]
  (normalize
   (reduce (fn [v t] (update v (token-bucket t) inc))
           (vec (repeat embedding-dim 0.0))
           (tokenize text))))

(defn embedding-for-document
  "The Rust embeds title, snippet, content and url joined by single spaces, in
  that order. Order is irrelevant to a bag of words but the joining is not —
  concatenating without the space would weld `foo` and `bar` into one token."
  [{:keys [title snippet content url]}]
  (embed-text (str title " " snippet " " content " " url)))

;; ── scoring ─────────────────────────────────────────────────────────────────

(def lexical-weights
  "Where a query substring was found, and what that is worth. Straight from the
  crate; kept as data so the ranking can be read rather than traced."
  [[:title 400] [:snippet 250] [:content 150] [:url 100]])

(defn lexical-boost
  "Substring containment, not term matching: the whole query has to appear. A
  two-word query therefore scores zero on a document holding both words apart,
  which is the crate's behaviour and is why the semantic term exists at all."
  [doc query]
  (let [needle (str/lower (or query ""))]
    (if (= "" needle)
      0
      (reduce (fn [score [k weight]]
                (if (str/includes? (str/lower (or (get doc k) "")) needle)
                  (+ score weight)
                  score))
              0
              lexical-weights))))

(defn semantic-boost
  "Cosine similarity (both vectors are unit-length) scaled to an integer, with
  the Rust's truncation toward zero — `(x * 1000.0) as i32`, not rounding."
  [left right]
  (long (* 1000.0 (reduce + 0.0 (map * left right)))))

;; ── index ───────────────────────────────────────────────────────────────────

(defn index [] {:docs []})

(defn upsert
  "Replace the document with this `:doc-id`, or append it. Position is retained
  on replace, which decides ties: equal scores come back in insertion order."
  [{:keys [docs] :as idx} doc]
  (if-let [i (first (keep-indexed #(when (= (:doc-id %2) (:doc-id doc)) %1) docs))]
    (assoc-in idx [:docs i] doc)
    (update idx :docs conj doc)))

(defn doc-count [idx] (count (:docs idx)))

(defn- ->hit [doc] (select-keys doc [:doc-id :url :title :snippet]))

(defn search
  "Ranked hits for `query`, highest score first.

  Documents scoring zero or less are dropped BEFORE paging, so `offset` walks
  matches rather than the corpus. A blank query or a zero limit returns
  nothing rather than everything."
  [idx query limit offset]
  (if (or (str/blank? (or query "")) (nil? limit) (zero? limit))
    []
    (let [qe (embed-text query)]
      (->> (:docs idx)
           (map (fn [doc]
                  [(+ (lexical-boost doc query)
                      (semantic-boost qe (embedding-for-document doc)))
                   doc]))
           (filter (fn [[score _]] (pos? score)))
           ;; stable sort by descending score: equal scores keep insertion order,
           ;; matching the Rust's `sort_by` (which is stable).
           (sort-by first #(compare %2 %1))
           (drop offset)
           (take limit)
           (mapv (fn [[_ doc]] (->hit doc)))))))
