# Frontier + Sitemap Component Design

Date: 2026-02-26

## Overview

分散クローラーアーキテクチャ。Frontier component (1 replica) が URL キューを管理し、
Crawler worker replicas (N) が wRPC 経由で URL を pull → fetch → ack する。

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │  Scheduler (etzhayyim:scheduler tick)     │
                    │  cron: "*/1 * * * * *" (毎秒)         │
                    └──────────────┬───────────────────────┘
                                   │ HTTP (fan-out to replicas)
                                   ▼
┌──────────────────────────────────────────────────────────┐
│  Crawler Workers (spreadscaler replicas: N)              │
│                                                          │
│  On tick:                                                │
│    1. frontier.poll-url(worker-id) ──wRPC──┐             │
│    2. fetch page (wasi:http/outgoing)      │             │
│    3. extract links                        │             │
│    4. frontier.ack-url(id, outcome, links) │             │
│    5. store result (KV + LanceDB)          │             │
│                                            │             │
│  Imports:                                  │             │
│    - etzhayyim:frontier/frontier (wRPC)         │             │
│    - wasi:http/outgoing-handler            │             │
│    - wasi:keyvalue/store                   │             │
│    - wasi:blobstore (images)               │             │
└────────────────────────────────────────────┼─────────────┘
                                             │ wRPC over NATS
                                             ▼
┌──────────────────────────────────────────────────────────┐
│  Frontier Component (spreadscaler replicas: 1)           │
│  Single-writer for frontier state consistency            │
│                                                          │
│  Exports:                                                │
│    - etzhayyim:frontier/frontier (wRPC)                       │
│    - wasi:http/incoming-handler (MCP admin API)          │
│    - etzhayyim:actor-handler (tool dispatch)                  │
│                                                          │
│  Core responsibilities:                                  │
│    - URL queue management (priority + host bucketing)    │
│    - Per-host rate limiting (crawl-delay enforcement)    │
│    - URL dedup (SHA-256 hash in KV)                      │
│    - robots.txt fetch + cache                            │
│    - sitemap.xml discovery + parsing                     │
│    - sitemap index recursive resolution                  │
│    - RSS/Atom feed parsing                               │
│    - Seed catalog management                             │
│    - Assignment tracking (deadline enforcement)          │
│                                                          │
│  Imports:                                                │
│    - wasi:http/outgoing-handler (sitemap/robots fetch)   │
│    - wasi:keyvalue/store (NATS JetStream KV)             │
└──────────────────────────────────────────────────────────┘
```

## WIT Interface

定義: `packages/wasm/wit/frontier/frontier.wit`

```
etzhayyim:frontier@0.1.0
  ├── interface types
  │   ├── url-priority: critical|high|normal|low|bulk
  │   ├── url-source: seed|sitemap|sitemap-news|rss|link-extract|manual
  │   ├── crawl-outcome: success|not-modified|redirect|blocked-robots|anti-bot|error-*
  │   ├── frontier-url { url, priority, source, depth, parent-url, lastmod-hint }
  │   ├── url-assignment { id, url, host, priority, source, depth, render-hint, deadline }
  │   ├── sitemap-result { host, urls-found, urls-enqueued, sitemaps-parsed, ... }
  │   ├── host-state { host, total-crawled, total-errors, robots, sitemap, anti-bot, ... }
  │   └── frontier-stats { total-queued, total-crawled, total-hosts, ... }
  └── interface frontier
      ├── submit-urls(urls) -> u32           # enqueue discovered URLs
      ├── poll-url(worker-id) -> assignment  # pull next URL (rate-limited)
      ├── ack-url(id, outcome, hash, links)  # report result + new links
      ├── nack-url(id, reason)               # return URL to queue
      ├── discover-sitemap(host) -> result   # fetch + parse sitemap.xml
      ├── discover-feed(feed-url) -> u32     # parse RSS/Atom
      ├── import-seeds(urls) -> u32          # bulk seed import
      ├── get-host-state(host) -> state      # per-host info
      ├── get-stats() -> stats               # aggregate metrics
      ├── purge-host(host) -> u64            # remove all URLs for host
      ├── flag-anti-bot(host)                # mark host as WAF-protected
      └── clear-anti-bot(host)               # clear anti-bot flag
```

## NATS KV Schema (bucket: `crawler-frontier`)

```
Key Pattern                                    Value                           Purpose
─────────────────────────────────────────────  ──────────────────────────────  ─────────────────────
fr.q.{priority}.{host-b32}.{url-sha}          frontier-url JSON               URL queue entry
fr.host.{host-b32}                            host-state JSON                 Per-host state
fr.seen.{url-sha}                             "1" (marker)                    URL dedup
fr.asgn.{assignment-id}                       url-assignment JSON             Active assignment
fr.robots.{host-b32}                          robots.txt rules JSON           Cached robots rules
fr.sitemap.{host-b32}                         sitemap-cache JSON              Parsed sitemap state
fr.feed.{host-b32}                            feed-cache JSON                 RSS/Atom cache
fr.stats                                      frontier-stats JSON             Aggregate stats
fr.seeds                                      []frontier-url JSON             Seed catalog
fr.idx.hosts                                  []string                        Host index
fr.idx.queue.{priority}                       []string                        Queue index per priority
```

Key encoding:
- `host-b32`: base32-lowercase of host string (NATS KV safe, no `:`)
- `url-sha`: first 16 chars of SHA-256 hex of normalized URL
- Priority values: `0`=critical, `1`=high, `2`=normal, `3`=low, `4`=bulk
- Queue scan: `fr.q.0.*` → all critical URLs, `fr.q.1.*` → all high, etc.

## poll-url Dispatch Algorithm

```
func poll-url(worker-id):
  for priority in [critical, high, normal, low, bulk]:
    hosts = scan fr.idx.queue.{priority}
    for host in hosts (round-robin):
      state = get fr.host.{host}
      if now - state.last_crawl < state.crawl_delay:
        continue  // rate limit not elapsed
      url = pop first from fr.q.{priority}.{host}.*
      if url == nil:
        continue
      assignment = create_assignment(url, deadline=now+120s)
      put fr.asgn.{assignment.id} = assignment
      update fr.host.{host}.last_crawl = now
      return assignment
  return None  // no URLs available
```

## Sitemap Discovery Flow

```
discover-sitemap(host):
  1. Fetch robots.txt → parse Sitemap: directives
     - If no Sitemap: directive, try well-known paths:
       /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml
  2. For each sitemap URL:
     a. Fetch XML
     b. If <sitemapindex>: recursively fetch child <sitemap> URLs (max depth 3)
     c. If <urlset>: parse each <url>
        - Extract <loc>, <lastmod>, <changefreq>, <priority>
        - If <news:news> extension: mark as sitemap-news, priority=high
     d. Dedup against fr.seen.{url-sha}
     e. Enqueue new URLs with lastmod-based priority:
        - lastmod < 1h ago  → critical
        - lastmod < 24h ago → high
        - lastmod < 7d ago  → normal
        - lastmod < 30d ago → low
        - older or missing  → bulk
  3. Cache parsed state in fr.sitemap.{host}
  4. If RSS/Atom <link> found in HTML: store feed URL
  5. Return sitemap-result
```

## RSS/Atom Feed Flow

```
discover-feed(feed-url):
  1. Fetch feed URL
  2. Parse as RSS 2.0 or Atom 1.0
  3. For each <item>/<entry>:
     - Extract <link> URL + <pubDate>/<updated> timestamp
     - Dedup against fr.seen.{url-sha}
     - Enqueue with source=rss, priority based on pubDate:
       - < 1h → critical
       - < 24h → high
       - < 7d → normal
       - else → low
  4. Return count enqueued
```

## WADM: Frontier Component

```yaml
apiVersion: core.oam.dev/v1beta1
kind: Application
metadata:
  name: crawler-frontier-fr0nt13r
  namespace: kotodama-runtime
  annotations:
    description: Distributed URL frontier with sitemap/RSS discovery
    performer.etzhayyim.com/categories: go,crawler,frontier
spec:
  components:
    # ── Frontier component (single-writer) ──
    - name: frontier-component
      type: component
      properties:
        image: ghcr.io/etzhayyim/frontier-component:v0.1.0
        config:
          - name: frontier-config
            properties:
              KV_BUCKET: crawler-frontier
              DEFAULT_CRAWL_DELAY_SEC: "1"
              ASSIGNMENT_DEADLINE_SEC: "120"
              MAX_QUEUE_PER_HOST: "10000"
              SITEMAP_CACHE_TTL_SEC: "3600"
              ROBOTS_CACHE_TTL_SEC: "86400"
              DEDUP_ENABLED: "true"
      traits:
        - type: spreadscaler
          properties:
            replicas: 1   # MUST be 1 — single-writer for state consistency
        - type: link
          properties:
            target: http-client
            namespace: wasi
            package: http
            interfaces: [outgoing-handler]
        - type: link
          properties:
            target: keyvalue-nats
            namespace: wasi
            package: keyvalue
            interfaces: [store]
            target_config:
              - name: frontier-kv-config
                properties:
                  bucket: crawler-frontier
                  enable_bucket_auto_create: "true"
                  cluster_uri: "nats://nats.kotodama-system.svc.cluster.local:4222"

    # ── HTTP server (MCP admin API) ──
    - name: http-server
      type: capability
      dependsOn: [frontier-component]
      properties:
        image: ghcr.io/etzhayyim/http-server:0.26.0
      traits:
        - type: daemonscaler
          properties:
            replicas: 1
        - type: link
          properties:
            target: frontier-component
            namespace: wasi
            package: http
            interfaces: [incoming-handler]
            source_config:
              - name: frontier-http-config
                properties:
                  address: "0.0.0.0:8020"

    # ── HTTP client (sitemap/robots.txt fetch) ──
    - name: http-client
      type: capability
      dependsOn: [frontier-component]
      properties:
        image: ghcr.io/etzhayyim/http-client:0.12.0
      traits:
        - type: daemonscaler
          properties:
            replicas: 1

    # ── KV store (NATS JetStream) ──
    - name: keyvalue-nats
      type: capability
      dependsOn: [frontier-component]
      properties:
        image: ghcr.io/etzhayyim/keyvalue-nats:0.3.1
      traits:
        - type: daemonscaler
          properties:
            replicas: 1
```

## WADM: Updated Crawler Workers

```yaml
apiVersion: core.oam.dev/v1beta1
kind: Application
metadata:
  name: www-crawler-o0dqx491
  namespace: kotodama-runtime
  annotations:
    description: Distributed crawler workers — pull URLs from frontier via wRPC
    performer.etzhayyim.com/categories: go,mcp,crawler
spec:
  components:
    # ── Crawler worker (horizontally scaled) ──
    - name: crawler-mcp-component
      type: component
      properties:
        image: ghcr.io/etzhayyim/crawler-mcp-component:v1.0.0-frontier
        config:
          - name: crawler-worker-config
            properties:
              LANCEDB_BASE_URL: http://lancedb-api.kotodama-runtime.svc.cluster.local:8080
              KV_ENABLE: "true"
              KV_BUCKET: crawler-mcp-state
              CRAWLER_BLOBSTORE_ENABLE: "true"
              CRAWLER_BLOB_CONTAINER: etzhayyim-cdn
              CRAWLER_BLOB_PREFIX: crawler/images
              CRAWLER_BLOB_CDN_BASE: https://f004.backblazeb2.com/file/etzhayyim-cdn/
              # Frontier mode: disable local scheduler/seed, use wRPC frontier
              FRONTIER_MODE: "true"
              WORKER_ID_PREFIX: "crawler"
      traits:
        - type: spreadscaler
          properties:
            replicas: 50   # Scale: 50 replicas = ~50 concurrent fetches
        # ── wRPC link to frontier component ──
        - type: link
          properties:
            target: frontier-component
            namespace: etzhayyim
            package: frontier
            interfaces: [frontier]
        - type: link
          properties:
            target: http-client
            namespace: wasi
            package: http
            interfaces: [outgoing-handler]
        - type: link
          properties:
            target: keyvalue-nats
            namespace: wasi
            package: keyvalue
            interfaces: [store]
            target_config:
              - name: wasi-keyvalue-config
                properties:
                  bucket: crawler-mcp-state
                  enable_bucket_auto_create: "true"
                  cluster_uri: "nats://nats.kotodama-system.svc.cluster.local:4222"
        - type: link
          properties:
            target: blobstore-s3
            namespace: wasi
            package: blobstore
            interfaces: [blobstore]
            target_config:
              - name: crawler-blobstore-config
                properties:
                  endpoint: "https://s3.us-west-004.backblazeb2.com"
                  region: "us-west-004"
                  bucket: "etzhayyim-cdn"

    # ── Shared capabilities ──
    - name: http-server
      type: capability
      dependsOn: [crawler-mcp-component]
      properties:
        image: ghcr.io/etzhayyim/http-server:0.26.0
      traits:
        - type: daemonscaler
          properties:
            replicas: 1
        - type: link
          properties:
            target: crawler-mcp-component
            namespace: wasi
            package: http
            interfaces: [incoming-handler]
            source_config:
              - name: crawler-mcp-http-config-v4
                properties:
                  address: "0.0.0.0:8006"

    - name: http-client
      type: capability
      dependsOn: [crawler-mcp-component]
      properties:
        image: ghcr.io/etzhayyim/http-client:0.12.0
      traits:
        - type: daemonscaler
          properties:
            replicas: 1

    - name: keyvalue-nats
      type: capability
      dependsOn: [crawler-mcp-component]
      properties:
        image: ghcr.io/etzhayyim/keyvalue-nats:0.3.1
      traits:
        - type: daemonscaler
          properties:
            replicas: 1

    - name: blobstore-s3
      type: capability
      dependsOn: [crawler-mcp-component]
      properties:
        image: ghcr.io/etzhayyim/blobstore-s3:0.10.0
      traits:
        - type: daemonscaler
          properties:
            replicas: 1
```

## Cross-Application wRPC Link

frontier-component は別の WADM application にある。
App は同一 NATS クラスタ内であれば **cross-application wRPC link** が動作する。
Crawler worker の `target: frontier-component` は application 境界を越えて解決される
（App lattice 内の component name でルーティング）。

## Worker Trigger Loop

Crawler workers は WASM (シングルスレッド、background goroutine 不可) のため、
外部からの HTTP リクエストで poll ループを駆動する。

### Option A: Scheduler-driven (推奨)

```
etzhayyim:scheduler tick (1s cron)
  → actor-handler.call-tool("crawler.poll_and_crawl") on crawler worker
  → App distributes across N replicas (round-robin)
  → Each replica: poll-url → fetch → ack-url
```

### Option B: Self-chaining

```
HTTP request → /api/v1/worker/tick
  → poll-url → fetch → ack-url
  → Fire-and-forget HTTP to self (next tick)
  → App distributes next request to different replica
```

### Option C: External cron (最もシンプル)

```
K8s CronJob (every 1s, parallelism=50)
  → curl http://crawler-mcp-component:8006/api/v1/worker/tick
  → Each request handled by different replica
```

**推奨: Option A** — 既存の `etzhayyim:scheduler` を利用。新規インフラ不要。

## Scaling Table

| Replicas | Concurrent fetches | Pages/month (est.) | Memory (est.) |
|----------|-------------------|---------------------|---------------|
| 1        | 1                 | ~2.6M               | 2-5 MB        |
| 10       | 10                | ~26M                | 20-50 MB      |
| 50       | 50                | ~130M               | 100-250 MB    |
| 200      | 200               | ~520M               | 400 MB-1 GB   |
| 500      | 500               | ~1.3B               | 1-2.5 GB      |

## Sitemap XML Parsing (TinyGo-compatible)

TinyGo 0.40 は `encoding/xml` を部分的にサポート。
Sitemap XML はシンプルな構造のため、文字列ベースのパーサーで対応可能:

```go
// TinyGo-safe sitemap parser (no encoding/xml)
func parseSitemapXML(body []byte) ([]SitemapEntry, bool, error) {
    s := string(body)
    isSitemapIndex := strings.Contains(s, "<sitemapindex")

    var entries []SitemapEntry
    tag := "<url>"
    if isSitemapIndex {
        tag = "<sitemap>"
    }
    // Split by <url> or <sitemap> tags and extract <loc>, <lastmod>
    parts := strings.Split(s, tag)
    for _, p := range parts[1:] {
        loc := extractTag(p, "loc")
        lastmod := extractTag(p, "lastmod")
        changefreq := extractTag(p, "changefreq")
        priority := extractTag(p, "priority")
        entries = append(entries, SitemapEntry{
            URL: loc, Lastmod: lastmod,
            Changefreq: changefreq, Priority: priority,
        })
    }
    return entries, isSitemapIndex, nil
}

func extractTag(s, tag string) string {
    open := "<" + tag + ">"
    close := "</" + tag + ">"
    i := strings.Index(s, open)
    if i < 0 { return "" }
    j := strings.Index(s[i:], close)
    if j < 0 { return "" }
    return strings.TrimSpace(s[i+len(open) : i+j])
}
```

## MCP Tools (Frontier Admin API)

| Tool | Purpose |
|------|---------|
| `frontier.stats` | Get frontier statistics |
| `frontier.host_state` | Get per-host state |
| `frontier.import_seeds` | Bulk import seeds from URL list |
| `frontier.discover_sitemap` | Trigger sitemap discovery for a host |
| `frontier.discover_feed` | Parse and enqueue RSS/Atom feed |
| `frontier.purge_host` | Remove all URLs for a host |
| `frontier.flag_anti_bot` | Mark host as anti-bot |
| `frontier.clear_anti_bot` | Clear anti-bot flag |

## Migration Path (from current monolithic crawler)

### Phase 0: Frontier component deploy (standalone)
- Deploy frontier component
- Populate seeds via `frontier.import_seeds` (migrate from current `crawler:seed:sites:v1`)
- Run sitemap discovery for all seed hosts
- Verify KV schema and stats

### Phase 1: Crawler workers → frontier mode
- Add `FRONTIER_MODE=true` config to crawler WADM
- Add wRPC link to frontier-component
- Modify crawler main.go:
  - When `FRONTIER_MODE=true`:
    - `worker.tick` MCP tool calls `frontier.poll-url()` instead of local BFS
    - After fetch, calls `frontier.ack-url()` instead of local queue management
    - Remove local seed catalog, scheduler, frontier management code paths
  - When `FRONTIER_MODE=false`: legacy behavior (backward compatible)
- Scale `replicas: 1 → 10` (initial test)

### Phase 2: Scale up
- Enable `etzhayyim:scheduler` with 1s tick targeting crawler workers
- Scale `replicas: 10 → 50`
- Monitor frontier stats, adjust crawl-delay and rate limits
- Run sitemap discovery for top 10K domains

### Phase 3: Full scale
- Import Tranco Top 1M seeds
- Scale `replicas: 50 → 200`
- Enable automatic sitemap re-discovery (24h cycle)
- Enable RSS feed polling (1h cycle for news sites)
