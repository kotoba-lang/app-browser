(ns etzhayyim.crawler.page-test
  "Parity with the pure helpers in `provider/crawler-control-rs`.

  Every expectation is the crate's own output: those functions depend on
  nothing but std once lifted out, so they were compiled standalone and run
  over these inputs. Three of the answers are ones a reader would 'fix':
  relative hrefs are dropped, an unquoted href does not stop the scan, and the
  summary cap counts bytes."
  (:require [clojure.test :refer [deftest is testing]]
            [etzhayyim.crawler.page :as page]))

(def base "https://example.com/dir/page")

(deftest extract-title-matches-the-rust
  (testing "tags match case-insensitively; the content keeps its own case"
    (is (= "Hi There" (page/extract-title "<html><TITLE> Hi There </TITLE></html>"))))
  (is (= "a" (page/extract-title "<title>a</title>")))
  (is (nil? (page/extract-title "no title")))
  (testing "an unclosed title is nothing, not the rest of the document"
    (is (nil? (page/extract-title "<title>unclosed")))))

(deftest summarize-text-matches-the-rust
  (is (= "Hello world" (page/summarize-text "<p>Hello   world</p>")))
  (is (= "ab" (page/summarize-text "<b>a</b><i>b</i>")))
  (is (= "spaced out" (page/summarize-text "  spaced   out  ")))
  (testing "the cap is 160 BYTES, and the crate stopped at exactly 160"
    (is (= 160 (count (page/summarize-text (str "<p>" (apply str (repeat 300 "x")) "</p>")))))))

(deftest extract-links-matches-the-rust
  (testing "both quote styles, absolutised"
    (is (= ["https://example.com/a" "https://example.com/b"]
           (page/extract-links base "<a href=\"/a\">A</a><a href='/b'>B</a>"))))
  (testing "an already-absolute href passes through"
    (is (= ["https://other.com/x"]
           (page/extract-links base "<a href=\"https://other.com/x\">X</a>"))))
  (testing "a document-relative href is DROPPED — the crate has no path joining"
    (is (= [] (page/extract-links base "<a href=\"relative\">R</a>"))))
  (testing "an unquoted href is skipped but does not stop the scan"
    (is (= ["https://example.com/ok"]
           (page/extract-links base "<a href=noquote>N</a><a href=\"/ok\">OK</a>"))))
  (testing "HREF in caps is found"
    (is (= ["https://example.com/upper"]
           (page/extract-links base "<a HREF=\"/upper\">U</a>")))))

(deftest absolutize-url-matches-the-rust
  (is (= "https://example.com/x" (page/absolutize-url base "/x")))
  (is (= "https://a.b/c" (page/absolutize-url base "https://a.b/c")))
  (is (= "http://a.b/c" (page/absolutize-url base "http://a.b/c")))
  (is (nil? (page/absolutize-url base "rel")))
  (is (nil? (page/absolutize-url base ""))))

(deftest url-host-matches-the-rust
  (is (= "a.b" (page/url-host "https://a.b/c")))
  (is (nil? (page/url-host "nope"))))

(deftest paginate-matches-the-rust
  (let [items [0 1 2 3 4]]
    (testing "limit 0 means ALL remaining — the opposite of the indexer's limit"
      (is (= [0 1 2 3 4] (page/paginate items 0 0))))
    (is (= [0 1] (page/paginate items 0 2)))
    (is (= [3 4] (page/paginate items 3 10)))
    (testing "an offset at or past the end is empty, not an error"
      (is (= [] (page/paginate items 5 1)))
      (is (= [] (page/paginate items 9 1))))
    (is (= [1 2] (page/paginate items 1 2)))))
