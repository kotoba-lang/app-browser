(ns etzhayyim.crawler.page
  "What a crawled page yields: its title, a summary, and the links to follow.

  A `.cljc` port of the pure helpers in `provider/crawler-control-rs`
  (ADR-2607072000). That crate's dependencies are the frontier, serde and
  thiserror — no HTTP, no async, no I/O. It is the crawler's policy, and this
  is the half of it that reads a page.

  Deliberately NOT an HTML parser. The crate scans for `<title>` and `href=`
  with string search, and a real parser would disagree with it about malformed
  markup — which is most of the web. Replacing this with one is a change to
  what the crawler collects, not a cleanup.

  SSoT INVARIANT: these and their counterparts in
  `provider/crawler-control-rs/src/lib.rs` must agree. The expectations in
  `page_test.cljc` were produced by RUNNING the crate."
  (:require [clojure.string :as str]))

(defn- utf8-length [s]
  #?(:clj (alength (.getBytes ^String s "UTF-8"))
     :cljs (.-length (.encode (js/TextEncoder.) s))))

;; ── urls ────────────────────────────────────────────────────────────────────

(defn url-host
  "Authority of a URL, or nil. No lower-casing, no port stripping — the same
  narrow scan the frontier uses, and for the same reason."
  [raw]
  (when (string? raw)
    (when-let [i (str/index-of raw "://")]
      (let [rest (subs raw (+ i 3))
            end (or (str/index-of rest "/") (count rest))]
        (subs rest 0 end)))))

(defn absolutize-url
  "A page-relative href resolved against `base-url`, or nil.

  Only absolute-path hrefs (`/x`) are resolved. A document-relative one
  (`page.html`, `../up`) returns nil and is therefore DROPPED by
  `extract-links` — the crate has no path-joining and does not pretend to.
  Worth knowing before trusting a crawl's coverage: a site that links
  relatively is invisible to it."
  [base-url raw]
  (cond
    (or (str/starts-with? (or raw "") "http://")
        (str/starts-with? (or raw "") "https://")) raw
    (not (str/starts-with? (or raw "") "/")) nil
    :else (when-let [i (str/index-of (or base-url "") "://")]
            (let [scheme (subs base-url 0 i)
                  rest (subs base-url (+ i 3))
                  host (subs rest 0 (or (str/index-of rest "/") (count rest)))]
              (str scheme "://" host raw)))))

;; ── page content ────────────────────────────────────────────────────────────

(defn extract-title
  "Text between the first `<title>` and the next `</title>`, trimmed.

  Tag matching is case-insensitive but the CONTENT keeps its original case —
  the crate lower-cases a copy only to find the offsets. An unclosed `<title>`
  yields nil rather than the rest of the document."
  [content]
  (let [c (or content "")
        lower (str/lower-case c)]
    (when-let [start (str/index-of lower "<title>")]
      (let [from (+ start 7)]
        (when-let [end (str/index-of (subs lower from) "</title>")]
          (str/trim (subs c from (+ from end))))))))

(def summary-limit-bytes
  "The crate stops at `out.len() >= 160`, and Rust's `len()` is BYTES. A
  character limit would cut Japanese roughly three times longer."
  160)

(defn summarize-text
  "Tag-stripped, control-stripped, whitespace-collapsed prefix of a page.

  Stripping is by `<`/`>` toggling, not by parsing: a stray `<` in text opens
  a tag as far as this is concerned. That is the crate's behaviour and part of
  what the summaries already in the corpus mean."
  [content]
  (loop [chars (seq (or content "")) in-tag? false out []]
    (if (or (nil? chars) (>= (utf8-length (apply str out)) summary-limit-bytes))
      (str/join " " (remove str/blank? (str/split (apply str out) #"\s+")))
      (let [ch (first chars)]
        (cond
          (= ch \<) (recur (next chars) true out)
          (= ch \>) (recur (next chars) false out)
          in-tag? (recur (next chars) in-tag? out)
          ;; control characters are dropped, not replaced
          (Character/isISOControl ^char ch) (recur (next chars) in-tag? out)
          :else (recur (next chars) in-tag? (conj out ch)))))))

(defn extract-links
  "Every `href=\"…\"` or `href='…'` on the page, absolutised against `base-url`.

  An unquoted href is skipped and the scan CONTINUES from just after it — the
  crate advances the cursor rather than giving up, so `<a href=bare>` does not
  hide the links after it. Links that cannot be absolutised are dropped."
  [base-url content]
  (let [c (or content "")
        lower (str/lower-case c)
        n (count c)]
    (loop [cursor 0 out []]
      (if-let [rel (str/index-of (subs lower cursor) "href=")]
        (let [idx (+ cursor rel 5)]
          (if (>= idx n)
            out
            (let [quote (nth c idx)]
              (if-not (or (= quote \") (= quote \'))
                (recur idx out)
                (let [start (inc idx)]
                  (if-let [end (str/index-of (subs c start) (str quote))]
                    (let [raw (subs c start (+ start end))
                          url (absolutize-url base-url raw)]
                      (recur (+ start end 1) (cond-> out url (conj url))))
                    out))))))
        out))))

;; ── paging ──────────────────────────────────────────────────────────────────

(defn paginate
  "A window over `items`. A limit of 0 means ALL remaining, not none — the
  opposite of `search`'s limit in the indexer, and a difference the crate has,
  so it is preserved rather than harmonised. An offset past the end is empty."
  [items offset limit]
  (let [items (vec items)]
    (if (>= offset (count items))
      []
      (subvec items offset (if (zero? limit)
                             (count items)
                             (min (count items) (+ offset limit)))))))
