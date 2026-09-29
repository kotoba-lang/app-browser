# etzhayyim-project-browser — Browser Agent (L2)

**browser.etzhayyim.com** — L2 Browser Agent。JS rendering, stealth anti-bot bypass, darkweb Tor proxy, phishing detection, LLM entity extraction。browserless (Playwright headless Chromium) 統合済み。

## CRITICAL: L2 Browser Agent Role

→ `etzhayyim dodaf tv1 query --id etzhayyim-project-browser-l2-browser-agent-role` / MCP `etzhayyim.dodaf.tv1.query`

## Components

| Component | Path | 役割 |
|---|---|---|
| browser-agent (WASM) | `wasm/etzhayyim-wasm-browser-agent-br0ws3r0/` | Browser Agent main (JS rendering, crawl, darkweb) |
| crawler (WASM) | `wasm/etzhayyim-wasm-crawler-cr4wl3r0/` | Crawl engine + darkweb engine |
| browserless (provider) | `provider/browserless/` | Headless Chromium proxy (Playwright, stealth anti-bot) |
| crawl-engine (provider) | `provider/crawl-engine/` | HTTP fetcher + browserless renderer |
| frontier (Rust) | `provider/crawler-frontier-rs/` | URL frontier queue |

## App (WASM)

| Item | Value |
|------|-------|
| nanoid | `cr4wl3r0` |
| Path | `60-apps/etzhayyim-project-browser/wasm/etzhayyim-wasm-crawler-cr4wl3r0/` |
| Domain | `browser.etzhayyim.com` / `cr4wl3r0.etzhayyim.com` |
| Runtime | Single Worker (canvas) |
| UI mode | canvas |
| Service path | `/xrpc/etzhayyim.crawler.v1.CrawlerService/` |

## Architecture

Single Worker + KotodamaContainer DO (WASM-in-DO)。W Protocol Event Stream で crawl 結果を channel publish。

### Webpage DID Architecture (CRITICAL)

**1 crawled webpage = 1 path-based DID (AT Protocol actor)**。`com-atproto:identity/identity@1.0.0` WIT 経由。

```
did:web:site.etzhayyim.com                        ← primary DID (controller)
  └── did:web:site.etzhayyim.com:page:{urlHash}   ← webpage path-based DID
```

- `DIDCreate("page:"+urlHash, profile)` で冪等登録 (同一 URL → 同一 DID)
- `DIDWrite(did, "com.etzhayyim.apps.crawler.crawlPage", record)` で crawl data を AT Record として永続化
- `ATPost(did, title, embed)` で webpage DID として Bluesky timeline に投稿
- `actor_id` = webpage DID (provenance tracking)
- yoro.etzhayyim.com/profile/{did} で各 webpage が followable/likeable
- re-crawl 時: 同一 DID → DIDWrite で update + ATPost で更新通知
- `ListWebpageDIDs` / `DeactivateWebpageDID` で DID lifecycle 管理

### Darkweb Proxy (Container sidecar)

Darkweb crawling は自前 Container (`darkweb-proxy.etzhayyim.com`) 経由で Tor + headless Chromium を使用。Worker が `kotodama.Send()` で Container HTTP API を呼ぶ hybrid 構成。

```
site.etzhayyim.com (Worker) → POST darkweb-proxy.etzhayyim.com/fetch
  → Tor SOCKS5 (127.0.0.1:9050)
    → Chromium headless (--proxy-server=socks5://...)
      → .onion page HTML + screenshot (base64 PNG)
```

## W Protocol Channels

| Channel | Kind | 用途 |
|---|---|---|
| `crawl-feed` | public (default) | Crawl results + extracted entities |
| `crawl-alerts` | public | Job status changes, anomaly alerts |
| `darkweb-feed` | public | Darkweb crawl results, discovered .onion sites |
| `phishing-alerts` | public | High-confidence phishing site detections with screenshots |

## API (agent tool call style)

### Surface Web

| Method | Description | Tags |
|--------|-------------|------|
| `StartCrawl` | Start a crawl job for a URL | data-collection, crawler, web |
| `CancelCrawl` | Cancel a running crawl job | crawler |
| `FetchPage` | Fetch + parse a single page | data-collection, http, web |
| `LLMExtract` | Extract entities via Murakumo LLM | nlp, extraction, murakumo |
| `SchedulerTick` | Internal: find seeds to crawl | scheduler, internal |
| `RunPending` | Internal: process frontier URLs | worker, internal |
| `SeedBootstrap` | Initialize default seed catalog | crawler, seed |
| `AddSeed` | Add a custom seed URL | crawler, seed |
| `RemoveSeed` | Remove a seed URL | crawler, seed |
| `Chat` | Chat with the crawler agent | crawler, chat |

### Darkweb

| Method | Description | Tags | Approval |
|--------|-------------|------|----------|
| `DarkwebCrawl` | Start darkweb crawl for .onion URLs via Tor | darkweb, tor, threat-intel | DecisionClassB |
| `DarkwebFetch` | Fetch single .onion page with screenshot | darkweb, tor, screenshot | DecisionClassB |
| `DarkwebSeedBootstrap` | Initialize darkweb seed catalog | darkweb, seed | DecisionClassB |
| `DarkwebSchedulerTick` | Internal: darkweb seed scheduler (30min) | scheduler, darkweb | DecisionClassC |

### Webpage DID Management

| Method | Description | Tags |
|--------|-------------|------|
| `ListWebpageDIDs` | List all webpage DIDs controlled by this crawler | crawler, did |
| `DeactivateWebpageDID` | Deactivate a webpage DID | crawler, did |

### Phishing Scoring

| Method | Description | Tags |
|--------|-------------|------|
| `PhishingScore` | Score page for phishing via LLM text analysis | phishing, scoring, murakumo |
| `PhishingScoreScreenshot` | Visual phishing analysis of screenshot via LLM | phishing, visual-analysis, murakumo |

## Queries

`GetStats`, `ListJobs`, `ListResults`, `ListRecentResults`, `SearchResults`, `FrontierStats`, `ListFrontierHosts`, `ListFrontierURLs`, `ListSeeds`, `GetRealtimeSnapshot`, `GetEntityGraph`, `ListDarkwebPages`, `ListPhishingAlerts`, `GetPhishingScore`

## Storage (W Protocol Event Stream)

| Table | PK | 用途 |
|---|---|---|
| `crawl_job` | `id` | Crawl jobs with status/progress (JSON `data` column) |
| `crawl_frontier` | `id` | Frontier URLs with depth/priority |
| `crawl_link` | `id` | Discovered link edges |
| `crawl_banner` | `id` | Server banner observations |
| `crawl_anti_bot` | `id` | Anti-bot detection records |
| `darkweb_page` | `id` | Darkweb page captures |
| `darkweb_seed` | `id` | Darkweb seed catalog (.onion directories) |
| `phishing_score` | `id` | Phishing analysis results |

## SQL Graph Nodes

| Label | Key | 用途 |
|---|---|---|
| `:CrawlJob` | `job_id` | Surface web crawl jobs |
| `:CrawlResult` | `result_id` | Surface web crawl results (`page_did` = webpage DID) |
| `:CrawlPage` | `url_hash` | Surface web page graph (`page_did` = webpage DID) |
| `:CrawlLink` | `source_hash,target_hash` | Surface web link edges |
| `:CrawlBanner` | `banner_id` | Server banner observations |
| `:DarkwebPage` | `url_hash` | Darkweb page captures (onion_url, screenshot_url, tor_exit_node) |
| `:PhishingScore` | `score_id` | Phishing scoring results (phishing_score, brand_impersonated, alert_level) |

## SQL Edges

| Edge | From → To | 意味 |
|---|---|---|
| `DARKWEB_LINK` | `:DarkwebPage` → `:DarkwebPage` | Discovered .onion inter-links |
| `PHISHING_SCORE_FOR` | `:PhishingScore` → `:DarkwebPage`/`:CrawlPage` | Scoring → target page |

## Phishing Scoring Algorithm

Evidence-weighted scoring (yabai pattern):

| Category | Weight | Description |
|---|---|---|
| BrandImpersonation | ×25 | Login form + visual similarity to known brand |
| CredentialHarvesting | ×20 | Password/card/SSN form fields |
| MalwareDistribution | ×18 | Executable DL, crypto miners |
| URLDeception | ×15 | Homograph attack, misleading domain |
| DataExfiltration | ×15 | Hidden form targets, cross-origin submit |
| SSLAnomaly | ×12 | Invalid/self-signed SSL |
| ContentCloning | ×10 | SimHash similarity to legitimate site |
| SocialEngineering | ×10 | Urgency language, fake warnings |
| SuspiciousInfra | ×8 | Bullet-proof hosting indicators |
| DarkwebSpecific | ×5 | Tor hosting, cryptocurrency payment |

`score = min(Σ(severity × confidence × weight), 100)`

| Level | Score | Action |
|---|---|---|
| Low | < 40 | Log only |
| Monitor | ≥ 40 | Watch list |
| High | ≥ 70 | W Protocol alert |
| Critical | ≥ 85 | cross-actor → malak (threat intel) + yabai (risk) |
| Takedown | ≥ 95 | cross-actor → malak law enforcement referral |

## Cross-actor Integration

| Target | Tool | Trigger |
|---|---|---|
| malak.etzhayyim.com (`m4l4k001`) | `CreateThreatActor` | PhishingScore ≥ 85 |
| malak.etzhayyim.com (`m4l4k001`) | `SubmitIntelReport` | PhishingScore ≥ 95 |
| yabai.etzhayyim.com (`y8b41k0x`) | `IngestEvidence` | All high-scoring pages |
| ← malak/yabai | `DarkwebCrawl`/`DarkwebFetch` | Inbound cross-actor crawl request |

## WIT Capability

```wit
package etzhayyim:crawler@1.0.0;
interface crawl-engine {
    start-crawl, fetch-page, llm-extract, get-entity-graph, add-seed
}
interface darkweb-engine {
    darkweb-crawl, darkweb-fetch, phishing-score, list-phishing-alerts
}
```
