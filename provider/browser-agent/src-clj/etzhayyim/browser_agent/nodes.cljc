(ns etzhayyim.browser-agent.nodes
  "Graph node implementations — faithful clj port of nodes.py.

  Differences from python, all behaviour-preserving:
  - async/await + asyncio.gather -> plain fns; parallel fan-out (search/scrape)
    uses futures, gathering results with per-item exception isolation
    (return_exceptions=True equivalent via the ::err sentinel).
  - langchain_openai.ChatOpenAI -> the injectable `*chat-complete*` seam, whose
    default posts to an OpenAI-compatible `/chat/completions` endpoint. Per
    ADR-2605215000 (etzhayyim inference = Murakumo only) `LLM_BASE_URL` should
    point at the Murakumo loopback; tests rebind `*chat-complete*`."
  (:require [cheshire.core :as json]
            [clojure.string :as str]
            [etzhayyim.browser-agent.state :as state]
            [etzhayyim.browser-agent.tools :as tools]))

(def default-llm-config
  {:base-url "https://openrouter.ai/api/v1"
   :api-key ""
   :model "google/gemma-3-27b-it"})

(def max-search-results 8)
(def max-scrape-urls 6)
(def max-iterations 2)
(def quality-threshold 0.75)

(defn chat-with
  "OpenAI-compatible chat completion (Murakumo loopback per ADR-2605215000).
  Takes {:system :prompt}, returns the assistant message content (trimmed)."
  [http-post {:keys [base-url api-key model]} {:keys [system prompt]}]
  (when-not (fn? http-post)
    (throw (ex-info "browser-agent LLM requires an explicit HTTP POST capability"
                    {:capability :browser-agent/llm-http-post})))
  (let [resp (http-post (str (str/replace base-url #"/+$" "") "/chat/completions")
                        {:headers (cond-> {"Content-Type" "application/json"}
                                    (seq api-key)
                                    (assoc "Authorization" (str "Bearer " api-key)))
                         :body (json/generate-string
                                {:model model
                                 :temperature 0.2
                                 :messages [{:role "system" :content system}
                                            {:role "user" :content prompt}]})
                         :timeout 60000
                         :throw false})
        data (json/parse-string (:body resp) true)]
    (-> (get-in data [:choices 0 :message :content] "") str str/trim)))

(def ^:dynamic *chat-complete*
  "Injectable chat-completion fn: (fn [{:keys [system prompt]}] -> string).
  nil -> `default-chat`. Rebound in tests to avoid network."
  nil)

(defn- chat [args]
  (when-not (fn? *chat-complete*)
    (throw (ex-info "browser-agent requires an explicit chat capability"
                    {:capability :browser-agent/chat-complete})))
  (*chat-complete* args))

(defn extract-json-array
  "Pull the first JSON array (`[` .. `]`) out of an LLM response and parse it.
  Returns the parsed value, or nil on any parse failure (python caught
  ValueError/JSONDecodeError)."
  [text]
  (try
    (let [s (str/index-of text "[")
          e (str/last-index-of text "]")]
      (when (and s e (< s e))
        (json/parse-string (subs text s (inc e)) true)))
    (catch Exception _ nil)))

(defn plan-queries
  "Decompose the user query into 2-4 targeted sub-queries."
  [state]
  (let [system (str "You decompose a user query into 2-4 distinct web search sub-queries "
                    "that together cover the topic comprehensively. Return a JSON array of "
                    "strings only.")
        context (if (not-empty (:page-url state))
                  (str "\nCurrent page: " (:page-url state)) "")
        prompt (str "Query: " (:query state) context
                    "\n\nReturn JSON array of 2-4 sub-queries:")
        text (chat {:system system :prompt prompt})
        parsed (extract-json-array text)
        sub-queries (if (sequential? parsed) parsed [(:query state)])]
    {:sub-queries (vec (take 4 sub-queries))
     :iteration (inc (:iteration state))}))

(def ^:private err ::err)

(defn- gather
  "asyncio.gather(..., return_exceptions=True): run `f` over `coll` in parallel
  futures; failures become the ::err sentinel rather than throwing."
  [f coll]
  (->> coll
       (mapv (fn [x] (future (try (f x) (catch Exception _ err)))))
       (mapv deref)))

(defn search-web
  "Run parallel web searches for all sub-queries, de-duplicating by url."
  [state]
  (let [results-nested (gather #(tools/web-search % 3) (:sub-queries state))
        seen (atom (set (map :url (:search-results state))))
        new-results (reduce
                     (fn [acc batch]
                       (if (= err batch)
                         acc
                         (reduce (fn [a item]
                                   (let [url (:url item)]
                                     (if (and (not-empty url) (not (@seen url)))
                                       (do (swap! seen conj url)
                                           (conj a (state/search-result item)))
                                       a)))
                                 acc batch)))
                     [] results-nested)]
    {:search-results (vec (take max-search-results new-results))}))

(defn scrape-pages
  "Fetch full content for the top search results not yet scraped."
  [state]
  (let [already (set (map :url (:scraped-contents state)))
        to-scrape (->> (:search-results state)
                       (remove #(already (:url %)))
                       (take max-scrape-urls)
                       vec)
        contents (gather #(tools/fetch-page (:url %)) to-scrape)
        enriched (mapv (fn [r content]
                         (let [text (if (= err content) (:snippet r) (str content))]
                           (state/search-result
                            (assoc r :content (subs text 0 (min (count text) 4000))))))
                       to-scrape contents)]
    {:scraped-contents enriched}))

(defn synthesize
  "Synthesize scraped content into a structured Sparkpage (JSON sections)."
  [state]
  (let [sources (->> (take max-scrape-urls (:scraped-contents state))
                     (map-indexed
                      (fn [i r]
                        (str "[" (inc i) "] " (:title r) "\nURL: " (:url r) "\n"
                             (if (not-empty (:content r)) (:content r) (:snippet r)))))
                     (str/join "\n\n"))
        system (str "You synthesize web research into a well-structured, informative page "
                    "(Sparkpage). Return a JSON array of {\"title\": string, \"content\": "
                    "string} sections. Include 3-5 sections. Be comprehensive but concise. "
                    "Cite sources inline as [1], [2], etc.")
        prompt (str "User query: " (:query state) "\n\n"
                    "Source materials:\n" sources "\n\n"
                    "Return JSON array of sections:")
        text (chat {:system system :prompt prompt})
        raw (extract-json-array text)
        sections (if (sequential? raw)
                   (mapv #(state/spark-section {:title (get % :title "")
                                                :content (get % :content "")}) raw)
                   [(state/spark-section {:title "Summary" :content text})])]
    {:sections sections}))

(defn quality-check
  "Score synthesis quality (heuristic); decide whether to re-search."
  [state]
  (if (>= (:iteration state) max-iterations)
    {:quality-score 1.0 :needs-more false}
    (let [total-content (reduce + 0 (map #(count (:content %)) (:scraped-contents state)))
          section-count (count (:sections state))
          score (min 1.0 (+ (* (/ total-content 8000.0) 0.6)
                            (* (/ section-count 4.0) 0.4)))
          needs-more (and (< score quality-threshold)
                          (< (:iteration state) max-iterations))]
      {:quality-score score :needs-more needs-more})))
