# etzhayyim-project-browserless

Headless browser rendering service (browserless-style) for fetching rendered HTML from modern web pages (SPA/AJAX).

This service is intended to be called by other components (for example `crawler.etzhayyim.com`) when static HTTP fetch is insufficient.

## Endpoints

- `GET /health`
  - Returns `{ "status": "ok" }`

- `POST /content`
  - JSON body:
    - `url` (string, required)
    - `wait_until` (string, optional) one of `load`, `domcontentloaded`, `networkidle` (default `networkidle`)
    - `timeout_ms` (number, optional) default `15000`
    - `user_agent` (string, optional)
  - Response JSON:
    - `status` (number) best-effort HTTP status code for the navigation response (0 if unknown)
    - `url` (string) requested URL
    - `final_url` (string) page.url() after navigation
    - `title` (string)
    - `content` (string) rendered HTML

## Env

- `PORT` (default `8080`)
- `MAX_CONCURRENCY` (default `2`)
- `CHROME_LAUNCH_TIMEOUT_MS` (default `30000`)
- `NAV_TIMEOUT_MS` (default `15000`)
- `ALLOW_HOSTS` (optional) comma-separated hostname allowlist (if set, other hosts are rejected)
- `TOR_PROXY` (optional) SOCKS5 proxy for `.onion` (example: `socks5://tor:9050`)

## Run

```sh
npm i
npm run dev
```
