# etzhayyim-project-www-crawler App migration

このディレクトリは `etzhayyim-project-www-crawler` の App 実装です。

## 実行状況評価（2026-03）

- App コンポーネント `crawler-mcp-component` で crawler API の運用に必要な Connect RPC/MCP を提供。
- `REST API (/api/v1/*, /jobs, /results, /crawls)` は廃止し、`/xrpc/etzhayyim.crawler.v1.*` に統一。
- App runtime 依存は不要となったため、このプロジェクトの移行は完了扱い。

## App 実装方針

- `projects/*/wasm/*-component` を正式実装として運用。
- nanoid path (`/{nanoid}/...`) を API/MCP 向けに維持し、`crawler.etzhayyim.com` は UI 入口として扱う。
- 追加の jobs/status 系は App 側で拡張し、legacy runtime 側には依存しない。
- crawler runtime は `crawler-mcp-component/` を唯一の実装として運用する。
- `crawler-provider-legacy/` は廃止済みポインタのみを保持する。

### エンドポイント方針（運用）

- UI: `https://crawler.etzhayyim.com/`（ルート）
- API/MCP: `https://1.etzhayyim.com/` 配下（API のみ。UI は `https://crawler.etzhayyim.com/` のみ）


## 外部 curl での稼働評価
