#!/usr/bin/env bb
(require '[babashka.classpath :as cp] '[babashka.fs :as fs] '[clojure.test :as t])
(let [here (fs/parent (fs/absolutize *file*))]
  (cp/add-classpath (str (fs/path here "src-clj")))
  (cp/add-classpath (str (fs/path here "test-clj"))))
(require 'etzhayyim.crawler.page-test)
(let [{:keys [fail error]} (t/run-tests 'etzhayyim.crawler.page-test)]
  (println (if (zero? (+ fail error))
             "── crawler-control (page): green ──"
             "── crawler-control (page): FAILURES above ──"))
  (System/exit (if (zero? (+ fail error)) 0 1)))
