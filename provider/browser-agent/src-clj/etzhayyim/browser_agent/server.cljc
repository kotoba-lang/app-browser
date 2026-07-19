(ns etzhayyim.browser-agent.server
  "HTTP server — faithful clj port of server.py (aiohttp SSE) to httpkit.

  aiohttp.web -> org.httpkit.server (bb built-in). Routes:
    GET  /health  -> {:ok true :app \"browser-agent\"}
    POST /search  -> text/event-stream of {type ...} events, terminated by
                     `data: [DONE]`.

  Event parity with python: `phase` transitions per node, `source` per newly
  scraped url, `section` per synthesized section, `error` on failure. The
  python `token` events came from langchain's `on_chat_model_stream`; the clj
  chat seam is non-streaming, so token-level events are intentionally dropped
  (phase/source/section/error/DONE preserved)."
  (:require [cheshire.core :as json]
            [clojure.string :as str]
            [etzhayyim.browser-agent.graph :as graph]
            [etzhayyim.browser-agent.state :as state]
            [org.httpkit.server :as hk]))

(def ^:private phase-map
  {:plan-queries  "planning"
   :search-web    "searching"
   :scrape-pages  "scraping"
   :synthesize    "synthesizing"
   :quality-check "done"})

(def ^:private default-cors-origins
  "First-party origins permitted cross-origin access (project CLAUDE.md app
   domains). Override via BROWSER_AGENT_CORS_ORIGINS (comma/space separated)."
  #{"https://browser.etzhayyim.com"
    "https://cr4wl3r0.etzhayyim.com"
    "https://etzhayyim.com"
    "https://www.etzhayyim.com"})
(def ^:dynamic *cors-origins* default-cors-origins)

(defn- cors-origin-allowlist
  "Set of allowed origins. BROWSER_AGENT_CORS_ORIGINS (comma/space separated)
   overrides the first-party default."
  [] *cors-origins*)

(defn- origin-allowed? [origin allowlist] (contains? allowlist origin))

(defn- cors-headers-for
  "CORS response headers for an allowed origin; empty map if disallowed/nil."
  [origin allowlist]
  (if (origin-allowed? origin allowlist)
    {"Access-Control-Allow-Origin" origin
     "Vary" "Origin"}
    {}))

(defn- cors-headers
  "CORS headers derived from the request Origin + current allowlist."
  [req]
  (cors-headers-for (get-in req [:headers "origin"]) (cors-origin-allowlist)))

(defn- sse [ch data]
  (hk/send! ch {:body (str "data: " (json/generate-string data) "\n\n")} false))

(defn- read-json [req]
  (let [b (:body req)]
    (when b (json/parse-string (slurp b) true))))

(defn search-handler
  "POST /search — stream the browser-search graph as Server-Sent Events."
  ([req] (search-handler req graph/run-graph *cors-origins*))
  ([req graph-runner cors-origins]
  (hk/as-channel
   req
   {:on-open
    (fn [ch]
      (let [body (read-json req)
            query (str/trim (or (:query body) ""))
            page-url (or (:page_url body) "")]
        (if (str/blank? query)
          (hk/send! ch {:status 400
                        :headers {"Content-Type" "application/json"}
                        :body (json/generate-string {:error "query required"})}
                    true)
          (do
            (hk/send! ch {:status 200
                          :headers (merge {"Content-Type" "text/event-stream"
                                           "Cache-Control" "no-cache"
                                           "X-Accel-Buffering" "no"}
                                          (cors-headers-for
                                           (get-in req [:headers "origin"])
                                           cors-origins))
                          :body ""}
                      false)
            (try
              (graph-runner
               (state/init-state query page-url)
               (fn [node delta _state]
                 (when-let [p (phase-map node)]
                   (sse ch {:type "phase" :phase p}))
                 (when (= node :scrape-pages)
                   (doseq [r (:scraped-contents delta)]
                     (sse ch {:type "source" :url (:url r)})))
                 (when (= node :synthesize)
                   (doseq [s (:sections delta)]
                     (sse ch {:type "section" :title (:title s) :content (:content s)})))))
              (catch Exception e
                (sse ch {:type "error" :message (.getMessage e)})))
            (hk/send! ch {:body "data: [DONE]\n\n"} false)
            (hk/close ch)))))})))

(defn app-with-capabilities
  "Ring handler: /health (GET) and /search (POST)."
  [{:keys [graph-runner cors-origins]
    :or {graph-runner graph/run-graph cors-origins default-cors-origins}}
   req]
  (case [(:request-method req) (:uri req)]
    [:get "/health"]
    {:status 200
     :headers {"Content-Type" "application/json"}
     :body (json/generate-string {:ok true :app "browser-agent"})}

    [:post "/search"]
    (search-handler req graph-runner cors-origins)

    [:options "/search"]
    (if-let [origin (get-in req [:headers "origin"])]
      (if (origin-allowed? origin cors-origins)
        {:status 204
         :headers (merge {"Access-Control-Allow-Methods" "POST"
                          "Access-Control-Allow-Headers" "Content-Type"}
                         {"Access-Control-Allow-Origin" origin
                          "Vary" "Origin"})}
        {:status 403
         :headers {"Content-Type" "application/json"}
         :body (json/generate-string {:error "origin not allowed"})})
      {:status 204 :headers {}})

    {:status 404
     :headers {"Content-Type" "application/json"}
     :body (json/generate-string {:error "not found"})}))

(defn app [req] (app-with-capabilities {} req))

(defn run-server-with [run-server port handler]
  (when-not (fn? run-server)
    (throw (ex-info "browser-agent requires an explicit server capability"
                    {:capability :browser-agent/run-server})))
  (run-server handler {:port port :ip "0.0.0.0"}))

(defn -main [& _]
  (throw (ex-info "browser-agent portable runtime requires an explicit host adapter"
                  {:capability :browser-agent/host-adapter})))
