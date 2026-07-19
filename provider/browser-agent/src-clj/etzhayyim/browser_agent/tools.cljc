(ns etzhayyim.browser-agent.tools
  "Web search + page fetch tools — faithful clj port of tools.py.

  httpx.AsyncClient -> babashka.http-client (bb built-in); json -> cheshire;
  BeautifulSoup text extraction -> a regex tag-stripper (`extract-text`) since
  bb has no jsoup/bs4 — script/style/nav/footer/aside are dropped with their
  content, remaining tags removed, a few HTML entities decoded, whitespace
  collapsed. All network errors are swallowed to [] / \"\" exactly like the
  python (which returned empty on any exception)."
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

;; SearXNG meta search (internal, no API key required)
(def default-config
  {:searxng-url "https://searxng.etzhayyim.com"
   :crawl-engine-url "https://crawl-engine.etzhayyim.com"})
(def ^:dynamic *config* default-config)
(def ^:dynamic *http-get* nil)
(def ^:dynamic *http-post* nil)

(def max-content-chars 4000)

(defn- truncate
  "_truncate: collapse 3+ newlines and cut to max-content-chars."
  [text]
  (let [t (str/replace (or text "") #"\n{3,}" "\n\n")]
    (subs t 0 (min (count t) max-content-chars))))

(defn extract-text
  "BeautifulSoup-equivalent text extraction: drop script/style/nav/footer/aside
  (tag + content), strip remaining tags, decode a few entities, collapse runs of
  whitespace."
  [html]
  (-> (or html "")
      (str/replace #"(?is)<(script|style|nav|footer|aside)\b[^>]*>.*?</\1>" " ")
      (str/replace #"(?s)<[^>]+>" " ")
      (str/replace #"&nbsp;" " ")
      (str/replace #"&amp;" "&")
      (str/replace #"&lt;" "<")
      (str/replace #"&gt;" ">")
      (str/replace #"&#39;|&apos;" "'")
      (str/replace #"&quot;" "\"")
      (str/replace #"[ \t]+" " ")
      (str/replace #" *\n *" "\n")
      str/trim))

(defn- searxng-search
  "GET /search?format=json from the internal SearXNG instance."
  [query max-results]
  (try
    (let [resp (*http-get* (str (:searxng-url *config*) "/search")
                         {:query-params {:q query
                                         :format "json"
                                         :categories "general"
                                         :engines "bing,duckduckgo,brave"}
                          :headers {"User-Agent" "etzhayyim-browser-agent/1.0"}
                          :timeout 15000
                          :throw false})]
      (if (not= 200 (:status resp))
        []
        (let [data (json/parse-string (:body resp) true)]
          (->> (take max-results (:results data))
               (keep (fn [item]
                       (when-let [url (not-empty (:url item))]
                         {:url url
                          :title (or (:title item) "")
                          :snippet (or (:content item) "")})))
               vec))))
    (catch Exception _ [])))

(defn web-search
  "Search via the internal SearXNG meta search aggregator."
  ([query] (web-search query 5))
  ([query max-results] (searxng-search query max-results)))

(defn fetch-page
  "Fetch page text via crawl-engine (preferred, JS-heavy pages) then a direct
  HTTP fallback with regex text extraction. Returns \"\" on total failure."
  [url]
  (or
   ;; prefer crawl-engine for JS-heavy pages
   (try
     (let [resp (*http-post* (str (:crawl-engine-url *config*) "/fetch")
                           {:headers {"Content-Type" "application/json"}
                            :body (json/generate-string {:url url :fetchMode "static"})
                            :timeout 20000
                            :throw false})]
       (when (= 200 (:status resp))
         (let [data (json/parse-string (:body resp) true)]
           (truncate (or (not-empty (:content data)) (:text data) "")))))
     (catch Exception _ nil))
   ;; direct fallback
   (try
     (let [resp (*http-get* url {:headers {"User-Agent" "etzhayyim-browser-agent/1.0"}
                               :timeout 15000
                               :throw false})]
       (truncate (extract-text (:body resp))))
     (catch Exception _ ""))))
