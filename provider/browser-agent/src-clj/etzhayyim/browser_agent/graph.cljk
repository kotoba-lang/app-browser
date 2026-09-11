(ns etzhayyim.browser-agent.graph
  "Browser search graph — faithful clj port of graph.py.

  The python langgraph StateGraph is:
    START -> plan_queries -> search_web -> scrape_pages -> synthesize
          -> quality_check -> (plan_queries if needs_more else END)
  i.e. a linear pipeline with one conditional loop back to the top. Rather than
  pull in langgraph-clj for a single back-edge, this is expressed as an
  idiomatic functional runner: one `reduce` over the node order per iteration,
  looping while `:needs-more`. Channel-reducer (operator.add) semantics live in
  `state/apply-update`."
  (:require [etzhayyim.browser-agent.nodes :as nodes]
            [etzhayyim.browser-agent.state :as state]))

(def node-order
  "Ordered [node-kw node-fn] pairs (plan -> search -> scrape -> synth -> qc)."
  [[:plan-queries  nodes/plan-queries]
   [:search-web    nodes/search-web]
   [:scrape-pages  nodes/scrape-pages]
   [:synthesize    nodes/synthesize]
   [:quality-check nodes/quality-check]])

(defn run-graph
  "Run the graph to completion, returning the final state.

  `on-step`, if given, is called (on-step node-kw delta merged-state) after each
  node — the delta is the node's raw output (matching python's per-node
  `on_chain_end` output), used by the server for SSE phase/source/section events."
  ([initial] (run-graph initial nil))
  ([initial on-step]
   (loop [st initial]
     (let [st' (reduce
                (fn [s [k f]]
                  (let [delta (f s)
                        merged (state/apply-update s delta)]
                    (when on-step (on-step k delta merged))
                    merged))
                st node-order)]
       (if (:needs-more st')
         (recur st')
         st')))))
