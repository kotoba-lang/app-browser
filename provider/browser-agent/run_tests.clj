;; run_tests.clj — repo rule: tests run via clj/bb, not .sh.
;;   bb run_tests.clj      (or: bb test)
(require '[babashka.http-client :as http]
         '[clojure.string :as str]
         '[clojure.test :as t]
         '[org.httpkit.server :as httpkit]
         '[etzhayyim.browser-agent.nodes :as nodes]
         '[etzhayyim.browser-agent.server :as server]
         '[etzhayyim.browser-agent.tools :as tools]
         'etzhayyim.browser-agent.core-test)

(defn- env [name default] (or (System/getenv name) default))
(defn- origins [value]
  (set (remove str/blank? (str/split value #"[,\s]+"))))

(def host-config
  {:tools {:searxng-url (env "SEARXNG_URL" (:searxng-url tools/default-config))
           :crawl-engine-url (env "CRAWL_ENGINE_URL" (:crawl-engine-url tools/default-config))}
   :llm {:base-url (env "LLM_BASE_URL" (:base-url nodes/default-llm-config))
         :api-key (env "LLM_API_KEY" (env "OPENROUTER_API_KEY" ""))
         :model (env "LLM_MODEL" (:model nodes/default-llm-config))}
   :cors-origins (origins (env "BROWSER_AGENT_CORS_ORIGINS"
                               "https://browser.etzhayyim.com,https://cr4wl3r0.etzhayyim.com,https://etzhayyim.com,https://www.etzhayyim.com"))})

(defn handler [request]
  (server/app-with-capabilities
   {:cors-origins (:cors-origins host-config)
    :graph-runner
    (fn [initial on-step]
      (binding [tools/*config* (:tools host-config)
                tools/*http-get* http/get
                tools/*http-post* http/post
                nodes/*chat-complete* (partial nodes/chat-with http/post (:llm host-config))]
        ((resolve 'etzhayyim.browser-agent.graph/run-graph) initial on-step)))}
   request))

(defn start-server! [port]
  (server/run-server-with httpkit/run-server port handler))

(let [{:keys [fail error]} (t/run-tests 'etzhayyim.browser-agent.core-test)]
  (System/exit (if (pos? (+ (or fail 0) (or error 0))) 1 0)))
