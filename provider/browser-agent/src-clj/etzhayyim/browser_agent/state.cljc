(ns etzhayyim.browser-agent.state
  "Browser search state — faithful clj port of state.py (BrowserSearchState).

  Plain maps replace the pydantic BaseModel; constructors normalize defaults.
  The two append-reducer fields in the python state
  (`Annotated[list[...], operator.add]`: search-results, scraped-contents) are
  reproduced by `apply-update`, which concats those keys and replaces the rest —
  i.e. the langgraph channel-reducer semantics, made explicit for the plain
  functional graph runner in `etzhayyim.browser-agent.graph`.")

(defn search-result
  "SearchResult constructor. Accepts a map; missing fields default to \"\"."
  [{:keys [url title snippet content]
    :or {title "" snippet "" content ""}}]
  {:url (or url "") :title title :snippet snippet :content content})

(defn spark-section
  "SparkSection constructor."
  [{:keys [title content] :or {title "" content ""}}]
  {:title title :content content})

(defn init-state
  "Initial BrowserSearchState for a user query (+ optional current page url)."
  ([query] (init-state query ""))
  ([query page-url]
   {:query query
    :page-url (or page-url "")
    :sub-queries []
    :search-results []
    :scraped-contents []
    :sections []
    :quality-score 0.0
    :iteration 0
    :needs-more false}))

(def ^:private add-keys
  "State keys whose node-output is appended (langgraph operator.add reducer)."
  #{:search-results :scraped-contents})

(defn apply-update
  "Merge a node's output delta into the state. Keys in `add-keys` are appended
  (concat); every other key is replaced — mirroring the python state's
  per-field reducers."
  [state delta]
  (reduce-kv
   (fn [s k v]
     (if (add-keys k)
       (assoc s k (into (vec (get s k)) v))
       (assoc s k v)))
   state delta))
