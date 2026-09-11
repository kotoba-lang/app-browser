#!/usr/bin/env bb
;; bb-native runner for the frontier port (repo convention: operational code is
;; clj/bb, no shell). Classpath is derived from this file's location so the
;; namespaces resolve without a --classpath flag.
(require '[babashka.classpath :as cp] '[babashka.fs :as fs] '[clojure.test :as t])
(let [here (fs/parent (fs/absolutize *file*))]
  (cp/add-classpath (str (fs/path here "src-clj")))
  (cp/add-classpath (str (fs/path here "test-clj"))))
(require 'etzhayyim.crawler.frontier-test)
(let [{:keys [fail error]} (t/run-tests 'etzhayyim.crawler.frontier-test)]
  (println (if (zero? (+ fail error))
             "── crawler-frontier: green ──"
             "── crawler-frontier: FAILURES above ──"))
  (System/exit (if (zero? (+ fail error)) 0 1)))
