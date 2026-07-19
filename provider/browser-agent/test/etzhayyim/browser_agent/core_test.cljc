(ns etzhayyim.browser-agent.core-test
  "clojure.test port of the browser-agent logic. Network is stubbed: the LLM
  seam (`nodes/*chat-complete*`) is rebound and tools/web-search + tools/fetch-page
  are redef'd, so the suite runs fully offline."
  (:require [clojure.test :refer [deftest is testing]]
            [etzhayyim.browser-agent.state :as state]
            [etzhayyim.browser-agent.tools :as tools]
            [etzhayyim.browser-agent.nodes :as nodes]
            [etzhayyim.browser-agent.graph :as graph]
            [etzhayyim.browser-agent.server :as server]
            [cheshire.core :as json]))

;; ---- state -----------------------------------------------------------------

(deftest init-state-defaults
  (let [s (state/init-state "hello")]
    (is (= "hello" (:query s)))
    (is (= "" (:page-url s)))
    (is (= [] (:sub-queries s)))
    (is (= 0 (:iteration s)))
    (is (false? (:needs-more s))))
  (is (= "https://x" (:page-url (state/init-state "q" "https://x")))))

(deftest apply-update-reducer-semantics
  (testing "append keys concat; others replace"
    (let [s0 (state/init-state "q")
          s1 (state/apply-update s0 {:search-results [{:url "a"}] :iteration 1})
          s2 (state/apply-update s1 {:search-results [{:url "b"}] :iteration 2})]
      (is (= ["a" "b"] (mapv :url (:search-results s2))))
      (is (= 2 (:iteration s2)))
      (is (= [] (:scraped-contents s2))))))

(deftest constructors-default-blanks
  (is (= {:url "u" :title "" :snippet "" :content ""}
         (state/search-result {:url "u"})))
  (is (= {:title "" :content ""} (state/spark-section {}))))

;; ---- tools (pure text extraction) ------------------------------------------

(deftest extract-text-strips-markup
  (let [html (str "<html><head><style>.a{}</style></head><body>"
                  "<nav>menu</nav><p>Hello&nbsp;&amp;&nbsp;world</p>"
                  "<script>evil()</script><footer>foot</footer></body></html>")
        txt (tools/extract-text html)]
    (is (re-find #"Hello & world" txt))
    (is (not (re-find #"evil" txt)))
    (is (not (re-find #"menu" txt)))
    (is (not (re-find #"foot" txt)))))

(deftest network-capabilities-are-explicit
  (testing "tools cannot access the network without host HTTP capabilities"
    (binding [tools/*http-get* nil tools/*http-post* nil]
      (is (= [] (tools/web-search "q" 1)))
      (is (= "" (tools/fetch-page "https://example.com")))))
  (testing "LLM and server capabilities fail closed when absent"
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"explicit HTTP POST"
                          (nodes/chat-with nil nodes/default-llm-config
                                           {:system "s" :prompt "p"})))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"explicit server capability"
                          (server/run-server-with nil 0 server/app)))))

;; ---- nodes -----------------------------------------------------------------

(deftest extract-json-array-parsing
  (is (= ["a" "b"] (nodes/extract-json-array "noise [\"a\", \"b\"] tail")))
  (is (nil? (nodes/extract-json-array "no array here")))
  (is (nil? (nodes/extract-json-array "[broken"))))

(deftest plan-queries-parses-llm
  (binding [nodes/*chat-complete*
            (fn [_] "Here you go: [\"q1\", \"q2\", \"q3\", \"q4\", \"q5\"]")]
    (let [out (nodes/plan-queries (state/init-state "topic"))]
      (is (= 4 (count (:sub-queries out))) "capped at 4")
      (is (= ["q1" "q2" "q3" "q4"] (:sub-queries out)))
      (is (= 1 (:iteration out))))))

(deftest plan-queries-falls-back-on-garbage
  (binding [nodes/*chat-complete* (fn [_] "totally not json")]
    (let [out (nodes/plan-queries (state/init-state "topic"))]
      (is (= ["topic"] (:sub-queries out))))))

(deftest search-web-dedupes
  (with-redefs [tools/web-search
                (fn [q _] [{:url (str "http://" q) :title q :snippet "s"}
                           {:url "http://dup" :title "d" :snippet "s"}])]
    (let [st (assoc (state/init-state "q") :sub-queries ["x" "y"])
          out (nodes/search-web st)
          urls (mapv :url (:search-results out))]
      (is (= 1 (count (filter #(= "http://dup" %) urls))) "dup url kept once")
      (is (some #{"http://x"} urls))
      (is (some #{"http://y"} urls)))))

(deftest scrape-pages-enriches-and-truncates
  (with-redefs [tools/fetch-page (fn [_] (apply str (repeat 5000 "a")))]
    (let [st (assoc (state/init-state "q")
                    :search-results [(state/search-result {:url "u1" :snippet "snip"})])
          out (nodes/scrape-pages st)
          r (first (:scraped-contents out))]
      (is (= "u1" (:url r)))
      (is (= 4000 (count (:content r))) "content capped at 4000"))))

(deftest scrape-pages-uses-snippet-on-error
  (with-redefs [tools/fetch-page (fn [_] (throw (ex-info "boom" {})))]
    (let [st (assoc (state/init-state "q")
                    :search-results [(state/search-result {:url "u1" :snippet "fallback"})])
          out (nodes/scrape-pages st)]
      (is (= "fallback" (:content (first (:scraped-contents out))))))))

(deftest synthesize-parses-sections
  (binding [nodes/*chat-complete*
            (fn [_] "[{\"title\":\"A\",\"content\":\"x\"},{\"title\":\"B\",\"content\":\"y\"}]")]
    (let [st (assoc (state/init-state "q")
                    :scraped-contents [(state/search-result {:url "u" :content "c"})])
          out (nodes/synthesize st)]
      (is (= [{:title "A" :content "x"} {:title "B" :content "y"}] (:sections out))))))

(deftest synthesize-falls-back-to-summary
  (binding [nodes/*chat-complete* (fn [_] "plain prose, no json")]
    (let [out (nodes/synthesize (state/init-state "q"))]
      (is (= "Summary" (:title (first (:sections out)))))
      (is (= "plain prose, no json" (:content (first (:sections out))))))))

(deftest quality-check-caps-at-max-iterations
  (let [out (nodes/quality-check (assoc (state/init-state "q") :iteration 2))]
    (is (= 1.0 (:quality-score out)))
    (is (false? (:needs-more out)))))

(deftest quality-check-low-content-needs-more
  (let [out (nodes/quality-check (assoc (state/init-state "q") :iteration 0))]
    (is (< (:quality-score out) nodes/quality-threshold))
    (is (true? (:needs-more out)))))

(deftest quality-check-rich-content-passes
  (let [big {:url "u" :title "t" :snippet "" :content (apply str (repeat 8000 "a"))}
        st (assoc (state/init-state "q")
                  :iteration 0
                  :scraped-contents [big]
                  :sections [{:title "a" :content "b"} {:title "c" :content "d"}
                             {:title "e" :content "f"} {:title "g" :content "h"}])
        out (nodes/quality-check st)]
    (is (>= (:quality-score out) nodes/quality-threshold))
    (is (false? (:needs-more out)))))

;; ---- graph (end to end, offline) -------------------------------------------

(deftest run-graph-end-to-end
  (with-redefs [tools/web-search (fn [q _] [{:url (str "http://" q "/1") :title q :snippet "s"}])
                tools/fetch-page (fn [_] (apply str (repeat 9000 "a")))]
    (binding [nodes/*chat-complete*
              (fn [{:keys [system]}]
                (if (re-find #"sub-queries" system)
                  "[\"q1\",\"q2\"]"
                  "[{\"title\":\"S1\",\"content\":\"c1\"},{\"title\":\"S2\",\"content\":\"c2\"},{\"title\":\"S3\",\"content\":\"c3\"}]"))]
      (let [steps (atom [])
            final (graph/run-graph (state/init-state "deep topic")
                                   (fn [k _ _] (swap! steps conj k)))]
        (is (seq (:sections final)))
        (is (false? (:needs-more final)) "terminates")
        (is (= [:plan-queries :search-web :scrape-pages :synthesize :quality-check]
               (vec (take 5 @steps))))
        (is (>= (:iteration final) 1))))))

;; ---- server (pure routing) -------------------------------------------------

(deftest server-health
  (let [resp (server/app {:request-method :get :uri "/health"})]
    (is (= 200 (:status resp)))
    (is (= {:ok true :app "browser-agent"} (json/parse-string (:body resp) true)))))

(deftest server-404
  (is (= 404 (:status (server/app {:request-method :get :uri "/nope"})))))

;; ---- cors allowlist (issue #1553) ------------------------------------------

(deftest cors-origin-membership
  (testing "allowed origin in allowlist"
    (is (#'server/origin-allowed? "https://browser.etzhayyim.com"
                                  #{"https://browser.etzhayyim.com"})))
  (testing "disallowed origin rejected"
    (is (not (#'server/origin-allowed? "https://evil.example"
                                      #{"https://browser.etzhayyim.com"}))))
  (testing "nil origin rejected"
    (is (not (#'server/origin-allowed? nil #{"https://browser.etzhayyim.com"})))))

(deftest cors-headers-for-known-origin
  (is (= {"Access-Control-Allow-Origin" "https://x.com" "Vary" "Origin"}
         (#'server/cors-headers-for "https://x.com" #{"https://x.com"})))
  (is (= {} (#'server/cors-headers-for nil #{"https://x.com"})))
  (is (= {} (#'server/cors-headers-for "https://evil.example" #{"https://x.com"}))))

(deftest cors-default-allowlist-has-first-party-domains
  (testing "default allowlist permits project app domains (no env set)"
    (is (#'server/origin-allowed? "https://browser.etzhayyim.com"
                                  (#'server/cors-origin-allowlist)))
    (is (#'server/origin-allowed? "https://cr4wl3r0.etzhayyim.com"
                                  (#'server/cors-origin-allowlist))))
  (testing "default allowlist rejects unknown origin"
    (is (not (#'server/origin-allowed? "https://evil.example"
                                      (#'server/cors-origin-allowlist))))))

(deftest cors-allowlist-is-an-explicit-host-capability
  (binding [server/*cors-origins* #{"https://host.example"}]
    (is (= #{"https://host.example"} (#'server/cors-origin-allowlist))))
  (let [resp (server/app-with-capabilities
              {:cors-origins #{"https://host.example"}}
              {:request-method :options :uri "/search"
               :headers {"origin" "https://host.example"}})]
    (is (= 204 (:status resp)))
    (is (= "https://host.example"
           (get-in resp [:headers "Access-Control-Allow-Origin"])))))

(deftest cors-options-preflight
  (testing "allowed origin -> 204 with echo + methods"
    (let [resp (server/app {:request-method :options
                             :uri "/search"
                             :headers {"origin" "https://browser.etzhayyim.com"}})]
      (is (= 204 (:status resp)))
      (is (= "https://browser.etzhayyim.com"
             (get-in resp [:headers "Access-Control-Allow-Origin"])))
      (is (= "POST" (get-in resp [:headers "Access-Control-Allow-Methods"])))))
  (testing "disallowed origin -> 403, no ACAO"
    (let [resp (server/app {:request-method :options
                             :uri "/search"
                             :headers {"origin" "https://evil.example"}})]
      (is (= 403 (:status resp)))
      (is (nil? (get-in resp [:headers "Access-Control-Allow-Origin"])))))
  (testing "no origin (server-to-server) -> 204, no ACAO"
    (let [resp (server/app {:request-method :options :uri "/search"})]
      (is (= 204 (:status resp)))
      (is (nil? (get-in resp [:headers "Access-Control-Allow-Origin"]))))))
