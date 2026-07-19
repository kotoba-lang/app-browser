# crawler-control-http-rs

HTTP facade for crawler v2 control/query APIs.

Routes:

- `POST /xrpc/etzhayyim.crawler.v2.CrawlerCommandService/StartJob`
- `POST /xrpc/etzhayyim.crawler.v2.CrawlerCommandService/CancelJob`
- `POST /xrpc/etzhayyim.crawler.v2.CrawlerQueryService/GetJob`
- `POST /xrpc/etzhayyim.crawler.v2.CrawlerQueryService/ListResults`
- `POST /xrpc/etzhayyim.crawler.v2.CrawlerQueryService/SearchResults`
- `POST /xrpc/etzhayyim.crawler.v2.CrawlerQueryService/GetStats`

The facade wraps `crawler-control-rs` and uses `crawler-fetch-rs` +
`crawler-indexer-rs` as concrete providers.

Local run:

```bash
cargo run
```

or:

```bash
LISTEN_ADDR=127.0.0.1:18241 cargo run
```

Smoke test:

```bash
curl -sS -X POST http://127.0.0.1:18241/xrpc/etzhayyim.crawler.v2.CrawlerQueryService/GetStats \
  -H 'content-type: application/json' \
  -d '{}'
```
