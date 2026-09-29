# browserless — Project Runbook

## Service

| Item | Value |
|------|-------|
| K8s Service | `etzhayyim-browserless.kotodama-runtime.svc.cluster.local:8080` |
| Manifest | `60-apps/etzhayyim-project-browserless/k8s/browserless.yaml` |
| Image | `mcr.microsoft.com/playwright:v1.50.0-noble` |
| Namespace | `kotodama-runtime` |

## Architecture

Headless Chromium rendering proxy with stealth anti-bot bypass. Deployed as K8s Deployment using ConfigMap + initContainer pattern (no Docker build required).

### Deployment Pattern

```
ConfigMap (package.json + server.mjs)
  → initContainer: copy to emptyDir + npm install
  → Container: node server.mjs (Playwright + Fastify)
```

### Stealth Features

- Chrome args: `--disable-blink-features=AutomationControlled`, `--no-sandbox`
- `navigator.webdriver` = false, fake plugins/languages/chrome object
- Realistic viewport (1920x1080), locale (en-US), timezone (America/New_York)
- Bypasses Cloudflare JS challenge, basic bot detection

### Version Pinning (Critical)

Playwright version in ConfigMap `package.json` **must exactly match** MCR image version. No caret (`^`).

```json
"playwright": "1.50.0"
```

Add `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to initContainer to avoid downloading browsers (MCR image already has them).

## API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/content` | POST | Render page and return HTML |

### POST /content

```json
{
  "url": "https://example.com",
  "wait_until": "domcontentloaded",
  "timeout_ms": 12000,
  "user_agent": "optional custom UA"
}
```

Response: `{ status, url, final_url, title, content }`

## Deploy

```bash
kubectl apply -f 60-apps/etzhayyim-project-browserless/k8s/browserless.yaml
```

## Source Files

- `src/server.ts` — TypeScript source (reference, not deployed directly)
- `k8s/browserless.yaml` — K8s ConfigMap (inline `server.mjs`) + Deployment + Service
