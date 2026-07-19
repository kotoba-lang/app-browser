# browser-agent — Clojure twin (ADR-2606280030)

Idiomatic clj/bb port of the (now-removed) Python `browser_agent` package
(Genspark-like Sparkpage search synthesis). **The clj twin is the canonical code**
(ADR-2606280030, founder directive "twin の py を削除"): the DEV-stage Python
(`src/browser_agent/*.py` + `pyproject.toml` / `langgraph.json` / `Dockerfile`)
was deleted once the twin was verified and nothing imported it. The module map
below records the python→clj provenance.

## Module map (python → clj)

| python | clj namespace | notes |
|---|---|---|
| `state.py` | `etzhayyim.browser-agent.state` | pydantic `BaseModel` → plain maps; `operator.add` reducers → `apply-update` |
| `tools.py` | `etzhayyim.browser-agent.tools` | `httpx` → `babashka.http-client`; `bs4` → regex `extract-text`; json → `cheshire` |
| `nodes.py` | `etzhayyim.browser-agent.nodes` | `asyncio.gather` → futures; `ChatOpenAI` → injectable `*chat-complete*` (Murakumo loopback, ADR-2605215000) |
| `graph.py` | `etzhayyim.browser-agent.graph` | langgraph StateGraph (1 conditional back-edge) → functional `run-graph` loop |
| `server.py` | `etzhayyim.browser-agent.server` | aiohttp SSE → `org.httpkit.server`; token-stream events dropped (non-streaming chat seam) |

All deps are bundled in babashka — no external deps, no langgraph-clj needed.

## Run

```bash
bb test          # clojure.test suite (offline; network stubbed)
PORT=8000 bb serve
```

`GET /health` · `POST /search {"query": "...", "page_url": "..."}` → SSE of
`phase` / `source` / `section` / `error` events, terminated by `data: [DONE]`.

Cross-origin (`Access-Control-Allow-Origin`) is restricted to a first-party
allowlist (issue #1553). Override with a comma/space-separated env var:

```bash
BROWSER_AGENT_CORS_ORIGINS="https://browser.etzhayyim.com,https://app.example.com" bb serve
```

## Substrate boundary

RisingWave/psycopg state is not ported here; per ADR-2605312345 any persisted
state goes through an injectable kotoba-Datom-log store seam (the removed
python's `langgraph-checkpoint-postgres` checkpointer was deploy-only).
