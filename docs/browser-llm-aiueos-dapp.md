# app-browser（LLM 判定）— itonami（dapp）上の分散型設計

状態: 第 1 スライス実装（2026-10-20）。正本はこの文書。
追跡: Linear JUN-128（親 JUN-116）。

## 位置づけ

app-browser は **L2 Browser Agent**（browser.etzhayyim.com）—— JS レンダリング、
stealth anti-bot、darkweb Tor proxy、phishing 検知、LLM エンティティ抽出。
本スライスは **LLM 呼び出しと検索資源の判定**（nodes.cljk）を判定コア化。

## このスライス: LLM 判定コア

| 層 | 実体 | 状態 |
|---|---|---|
| 判定コア guest | `aiueos/browser_llm.cljk` — bounds-ok（**検索 8 / スクレイプ 6 / 反復 2** の閉じた上限）/ quality-gate（**品質 0.75**）/ llm-admission（**HTTP POST capability 明示必須** + **Murakumo のみ** = ADR-2605215000）/ fanout-isolation（**個別例外分離**） | **実装済み・実測** |
| 記述子 | `aiueos/browser-llm.edn` | **実装済み** |
| parity | `browser/llm_parity_test.cljk` — 正本（nodes.cljk）の上限・閾値・capability・Murakumo 規約と一致 | **実装済み・実測** |

実測: `amu test aiueos/browser_llm.cljk` → **18/18**（jvm-kir / js / wasm）。
parity → 2 tests / 9 assertions / 0 failures。

## 正本の正確な規則（guest はこれに追従 —— nodes.cljk の明文）

- **上限定数**: `max-search-results 8` / `max-scrape-urls 6` /
  `max-iterations 2` / `quality-threshold 0.75`。
- **LLM は capability 明示**: 「browser-agent LLM requires an explicit HTTP
  POST capability」（`:browser-agent/llm-http-post`）—— 環境権限で勝手に
  呼ばない。
- **推論は Murakumo のみ**（ADR-2605215000。「LLM_BASE_URL should point at
  the Murakumo loopback」）。default の openrouter 設定は seam の初期値であり
  運用は Murakumo。
- **fan-out は per-item exception isolation**（1 件の失敗で全体を落とさない）。

## 未実装境界

- phishing 検知・darkweb Tor proxy・stealth anti-bot の判定。
- グラフ進行（graph.cljk の LangGraph 配線）と tools の実行。
- LLM 応答の品質評価そのもの（閾値判定は guest、評価は host）。
- mon（DNA）化、aiueos session 載せ（fleet 共通）。
