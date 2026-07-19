#!/usr/bin/env bash
set -euo pipefail

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

NS="${NS:-spinkube}"
CRAWLER_SVC="${CRAWLER_SVC:-crawler-mcp-spin}"
LANCEDB_SVC="${LANCEDB_SVC:-tonbo}"
CRAWLER_LOCAL_PORT="${CRAWLER_LOCAL_PORT:-18081}"
LANCEDB_LOCAL_PORT="${LANCEDB_LOCAL_PORT:-18080}"
TEST_URL="${TEST_URL:-https://example.com/}"

kubectl -n "$NS" port-forward "svc/$CRAWLER_SVC" "$CRAWLER_LOCAL_PORT:80" >/tmp/pf_crawler_smoke.log 2>&1 &
PF_CRAWLER_PID=$!
kubectl -n "$NS" port-forward "svc/$LANCEDB_SVC" "$LANCEDB_LOCAL_PORT:8084" >/tmp/pf_lancedb_smoke.log 2>&1 &
PF_LANCEDB_PID=$!
cleanup() {
  kill "$PF_CRAWLER_PID" >/dev/null 2>&1 || true
  kill "$PF_LANCEDB_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sleep 2

echo "[smoke] startCrawl url=$TEST_URL"
START_RAW=$(curl -fsS -m 120 -X POST "http://127.0.0.1:$CRAWLER_LOCAL_PORT/api/grpc/etzhayyim.crawler.v1.CrawlerService/Crawler.startCrawl" \
  -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' \
  -d "{\"url\":\"$TEST_URL\",\"depth\":1,\"max_pages\":1,\"max_domains\":1,\"follow_external_links\":false,\"render\":false}")

echo "$START_RAW" | jq . >/dev/null
JOB_ID=$(echo "$START_RAW" | jq -r '.job_id // empty')
if [[ -z "$JOB_ID" ]]; then
  echo "[smoke] failed: no job_id in startCrawl response" >&2
  echo "$START_RAW" >&2
  exit 1
fi

echo "[smoke] listResults job_id=$JOB_ID"
RESULTS_RAW=$(curl -fsS -m 120 -X POST "http://127.0.0.1:$CRAWLER_LOCAL_PORT/api/grpc/etzhayyim.crawler.v1.CrawlerQueryService/ListResults" \
  -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' \
  -d "{\"job_id\":\"$JOB_ID\",\"offset\":0,\"limit\":1}")

echo "$RESULTS_RAW" | jq . >/dev/null
RESULT_ID=$(echo "$RESULTS_RAW" | jq -r '.results[0].result_id // empty')
if [[ -z "$RESULT_ID" ]]; then
  echo "[smoke] failed: no result_id for job=$JOB_ID" >&2
  echo "$RESULTS_RAW" >&2
  exit 1
fi

echo "[smoke] verify LanceDB doc_id=$RESULT_ID"
DOC_RAW=$(curl -fsS -m 60 -X POST "http://127.0.0.1:$LANCEDB_LOCAL_PORT/nata/query" \
  -H 'Content-Type: application/json' \
  -d "{\"table\":\"crawler_pages\",\"filter\":\"doc_id = \\\"$RESULT_ID\\\"\",\"limit\":1}")

echo "$DOC_RAW" | jq . >/dev/null
DOC_COUNT=$(echo "$DOC_RAW" | jq '.rows | length')
if [[ "$DOC_COUNT" -lt 1 ]]; then
  echo "[smoke] failed: result_id=$RESULT_ID not found in crawler_pages" >&2
  echo "$DOC_RAW" >&2
  exit 1
fi

echo "[smoke] ok job_id=$JOB_ID result_id=$RESULT_ID"
