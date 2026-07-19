use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::{env, net::SocketAddr};

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use crawler_control_rs::{
    CancelJobInput, ControlError, ControlService, FetchGateway, FetchedPage, GetJobInput,
    GetStatsInput, IndexGateway, IndexedDocument, ListResultsInput, SearchResultsInput,
    StartJobInput,
};
use crawler_indexer_rs::{embedding_for_document, IndexDocument, ProjectionIndex};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
struct PersistentState {
    service: ControlService,
    index: ProjectionIndex,
}

#[derive(Clone)]
struct AppState {
    data: Arc<Mutex<PersistentState>>,
    state_path: Arc<PathBuf>,
    graph_sync: Arc<GraphSync>,
    search_sync: Arc<SearchSync>,
}

struct FetchProviderAdapter;

impl FetchGateway for FetchProviderAdapter {
    fn fetch(&self, url: &str, _render_javascript: bool) -> Result<FetchedPage, String> {
        let url = url.to_string();
        let response = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|err| err.to_string())?;
            runtime.block_on(async move {
                let mut headers = HeaderMap::new();
                headers.insert(
                    USER_AGENT,
                    HeaderValue::from_static("etzhayyim-crawler-control-http-rs/0.1.0"),
                );
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(10))
                    .default_headers(headers)
                    .redirect(reqwest::redirect::Policy::limited(10))
                    .danger_accept_invalid_certs(true)
                    .build()
                    .map_err(|err| err.to_string())?;
                let response = client
                    .get(&url)
                    .send()
                    .await
                    .map_err(|err| err.to_string())?;
                let final_url = response.url().to_string();
                let status = response.status().as_u16();
                let content_type = response
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(ToOwned::to_owned);
                let body = response.bytes().await.map_err(|err| err.to_string())?;
                Ok::<FetchedPage, String>(FetchedPage {
                    url,
                    final_url,
                    status_code: status,
                    content_type,
                    body: body.to_vec(),
                })
            })
        })
        .join()
        .map_err(|_| "fetch worker panicked".to_string())?
        .map_err(|err| err.to_string())?;
        Ok(response)
    }
}

struct GraphSync {
    sql_exec_url: String,
    internal_token: String,
    app_id: String,
    org_id: String,
}

struct SearchSync {
    index_url: String,
}

impl SearchSync {
    fn new(index_url: String) -> Self {
        Self { index_url }
    }

    fn upsert_page(&self, doc: &IndexDocument) -> Result<(), String> {
        let index_url = self.index_url.clone();
        let payload = serde_json::json!({
            "url": doc.url,
            "title": doc.title,
            "snippet": doc.snippet,
            "text_content": doc.content,
            "source": "crawler",
        });
        thread::spawn(move || {
            let body = serde_json::to_vec(&payload).map_err(|err| err.to_string())?;
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .danger_accept_invalid_certs(true)
                .build()
                .map_err(|err| err.to_string())?;
            let response = client
                .post(index_url)
                .header(CONTENT_TYPE, "application/json")
                .body(body)
                .send()
                .map_err(|err| err.to_string())?;
            if !response.status().is_success() {
                return Err(format!("search index status={}", response.status()));
            }
            Ok(())
        })
        .join()
        .map_err(|_| "search sync worker panicked".to_string())?
    }
}

impl GraphSync {
    fn new(
        sql_exec_url: String,
        internal_token: String,
        app_id: String,
        org_id: String,
    ) -> Self {
        Self {
            sql_exec_url,
            internal_token,
            app_id,
            org_id,
        }
    }

    fn upsert_page(&self, doc: &IndexDocument) -> Result<(), String> {
        let embedding = embedding_for_document(doc);
        let sql_exec_url = self.sql_exec_url.clone();
        let internal_token = self.internal_token.clone();
        let app_id = self.app_id.clone();
        let org_id = self.org_id.clone();
        let params = serde_json::json!({
            "doc_id": doc.doc_id,
            "job_id": doc.job_id,
            "url": doc.url,
            "title": doc.title,
            "snippet": doc.snippet,
            "text": doc.content,
            "source": "crawler",
            "visibility": "public",
            "classification": "public",
            "clearance_level": 0,
            "owner_user_id": "",
            "allowed_actor_ids_json": "[]",
            "policy_tags_json": "[\"crawler\"]",
            "user_id": "",
            "actor_id": "cr4wl3r0-v2",
            "org_id": org_id,
            "embedding": embedding,
        });
        let payload = serde_json::json!({
            "statement": r#"MERGE (p:Page:graph_vertices {url: $url})
SET p.doc_id = $doc_id,
    p.job_id = $job_id,
    p.title = $title,
    p.snippet = $snippet,
    p.text_content = $text,
    p.source = $source,
    p.visibility = $visibility,
    p.classification = $classification,
    p.clearance_level = $clearance_level,
    p.owner_user_id = $owner_user_id,
    p.allowed_actor_ids_json = $allowed_actor_ids_json,
    p.policy_tags_json = $policy_tags_json,
    p.user_id = $user_id,
    p.actor_id = $actor_id,
    p.org_id = $org_id,
    p.embedding = $embedding"#,
            "parameters": params,
        });
        thread::spawn(move || {
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .danger_accept_invalid_certs(true)
                .build()
                .map_err(|err| err.to_string())?;
            let response = client
                .post(sql_exec_url)
                .header(CONTENT_TYPE, "application/json")
                .header("X-Kotodama-Internal-Token", internal_token)
                .header("X-Kotodama-App-Id", app_id)
                .header("X-Kotodama-Org-Id", org_id)
                .body(serde_json::to_vec(&payload).map_err(|err| err.to_string())?)
                .send()
                .map_err(|err| err.to_string())?;
            if !response.status().is_success() {
                return Err(format!("graph sync status={}", response.status()));
            }
            Ok(())
        })
        .join()
        .map_err(|_| "graph sync worker panicked".to_string())?
    }
}

struct ProjectionIndexAdapter<'a> {
    index: &'a mut ProjectionIndex,
    graph_sync: &'a GraphSync,
    search_sync: &'a SearchSync,
}

impl IndexGateway for ProjectionIndexAdapter<'_> {
    fn upsert(&mut self, doc: IndexedDocument) -> Result<(), String> {
        let projection_doc = IndexDocument {
            doc_id: doc.doc_id,
            job_id: doc.job_id,
            url: doc.url,
            title: doc.title,
            snippet: doc.snippet,
            content: doc.content,
        };
        self.index.upsert(projection_doc.clone());
        self.graph_sync.upsert_page(&projection_doc)?;
        if let Err(err) = self.search_sync.upsert_page(&projection_doc) {
            eprintln!("search sync failed for {}: {}", projection_doc.url, err);
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StartJobResponseBody {
    job: crawler_control_rs::CrawlJob,
}

#[derive(Debug, Serialize, Deserialize)]
struct CancelJobResponseBody {
    job: crawler_control_rs::CrawlJob,
}

type JsonResponse = Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)>;

#[tokio::main]
async fn main() {
    let state_path = Arc::new(PathBuf::from(
        env::var("STATE_PATH").unwrap_or_else(|_| "/data/crawler-v2-state.json".to_string()),
    ));
    let graph_exec_url = env::var("YATA_SQL_EXEC_URL").unwrap_or_else(|_| {
        "https://yata.etzhayyim.com/etzhayyim.sql.v1.SqlQueryService/Execute".to_string()
    });
    let graph_internal_token = String::new(); // legacy KOTODAMA_INTERNAL_TOKEN removed
    let graph_app_id = env::var("YATA_GRAPH_APP_ID").unwrap_or_else(|_| "search".to_string());
    let graph_org_id = env::var("YATA_GRAPH_ORG_ID").unwrap_or_else(|_| "search".to_string());
    let search_index_url = env::var("SEARCH_INDEX_URL").unwrap_or_else(|_| {
        "https://search.etzhayyim.com/xrpc/etzhayyim.search.v1.SearchService/IndexDocument".to_string()
    });
    let app = app(AppState {
        data: Arc::new(Mutex::new(load_state(&state_path))),
        state_path,
        graph_sync: Arc::new(GraphSync::new(
            graph_exec_url,
            graph_internal_token,
            graph_app_id,
            graph_org_id,
        )),
        search_sync: Arc::new(SearchSync::new(search_index_url)),
    });

    let listen_addr = env::var("LISTEN_ADDR")
        .ok()
        .or_else(|| env::var("SPIN_HTTP_LISTEN_ADDR").ok())
        .unwrap_or_else(|| "0.0.0.0:8080".to_string());
    let socket_addr: SocketAddr = listen_addr.parse().expect("parse LISTEN_ADDR");
    let listener = tokio::net::TcpListener::bind(socket_addr)
        .await
        .expect("bind crawler-control-http");
    axum::serve(listener, app).await.expect("serve");
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route(
            "/xrpc/etzhayyim.crawler.v2.CrawlerCommandService/StartJob",
            post(start_job),
        )
        .route(
            "/xrpc/etzhayyim.crawler.v2.CrawlerCommandService/CancelJob",
            post(cancel_job),
        )
        .route(
            "/xrpc/etzhayyim.crawler.v2.CrawlerQueryService/GetJob",
            post(get_job),
        )
        .route(
            "/xrpc/etzhayyim.crawler.v2.CrawlerQueryService/ListResults",
            post(list_results),
        )
        .route(
            "/xrpc/etzhayyim.crawler.v2.CrawlerQueryService/SearchResults",
            post(search_results),
        )
        .route(
            "/xrpc/etzhayyim.crawler.v2.CrawlerQueryService/GetStats",
            post(get_stats),
        )
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status":"ok","app":"cr4wl3r0-v2"}))
}

async fn start_job(
    State(state): State<AppState>,
    Json(req): Json<StartJobInput>,
) -> Result<Json<StartJobResponseBody>, (StatusCode, Json<serde_json::Value>)> {
    let mut data = lock_state(&state)?;
    let output = data
        .service
        .start_job(None, req)
        .map_err(map_control_error)?;
    let job_id = output.job.job_id.clone();
    let PersistentState { service, index } = &mut *data;
    let mut index_adapter = ProjectionIndexAdapter {
        index,
        graph_sync: &state.graph_sync,
        search_sync: &state.search_sync,
    };
    if let Err(err) = service.process_next(&job_id, &FetchProviderAdapter, &mut index_adapter) {
        eprintln!("process_next failed for {job_id}: {err}");
    }
    let output = data
        .service
        .get_job(GetJobInput { job_id })
        .map_err(map_control_error)?;
    save_state(&state.state_path, &data)
        .map_err(|err| json_error(StatusCode::INTERNAL_SERVER_ERROR, err))?;
    Ok(Json(StartJobResponseBody { job: output.job }))
}

async fn cancel_job(
    State(state): State<AppState>,
    Json(req): Json<CancelJobInput>,
) -> Result<Json<CancelJobResponseBody>, (StatusCode, Json<serde_json::Value>)> {
    let mut data = lock_state(&state)?;
    let output = data.service.cancel_job(req).map_err(map_control_error)?;
    save_state(&state.state_path, &data)
        .map_err(|err| json_error(StatusCode::INTERNAL_SERVER_ERROR, err))?;
    Ok(Json(CancelJobResponseBody { job: output.job }))
}

async fn get_job(State(state): State<AppState>, Json(req): Json<GetJobInput>) -> JsonResponse {
    let data = lock_state(&state)?;
    let output = data.service.get_job(req).map_err(map_control_error)?;
    Ok(Json(serde_json::json!(output)))
}

async fn list_results(
    State(state): State<AppState>,
    Json(req): Json<ListResultsInput>,
) -> JsonResponse {
    let data = lock_state(&state)?;
    let output = data.service.list_results(req).map_err(map_control_error)?;
    Ok(Json(serde_json::json!(output)))
}

async fn search_results(
    State(state): State<AppState>,
    Json(req): Json<SearchResultsInput>,
) -> JsonResponse {
    let data = lock_state(&state)?;
    let total = data.index.len() as u32;
    let results = data
        .index
        .search(&req.query, req.limit as usize, req.offset as usize)
        .into_iter()
        .map(|hit| {
            serde_json::json!({
                "result_id": hit.doc_id,
                "job_id": "",
                "url": hit.url,
                "title": hit.title,
                "snippet": hit.snippet,
                "text_content": hit.snippet,
                "status_code": 200
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(serde_json::json!({
        "total": total,
        "results": results
    })))
}

async fn get_stats(State(state): State<AppState>, Json(_req): Json<GetStatsInput>) -> JsonResponse {
    let data = lock_state(&state)?;
    Ok(Json(serde_json::json!(data.service.get_stats())))
}

fn lock_state<'a>(
    state: &'a AppState,
) -> Result<std::sync::MutexGuard<'a, PersistentState>, (StatusCode, Json<serde_json::Value>)> {
    state
        .data
        .lock()
        .map_err(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "state lock poisoned"))
}

fn load_state(path: &Path) -> PersistentState {
    let Ok(raw) = fs::read(path) else {
        return PersistentState::default();
    };
    let mut state: PersistentState = serde_json::from_slice(&raw).unwrap_or_default();
    state.index.rebuild_runtime();
    state
}

fn save_state(path: &Path, state: &PersistentState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(state).map_err(|err| err.to_string())?;
    fs::write(&tmp_path, bytes).map_err(|err| err.to_string())?;
    fs::rename(&tmp_path, path).map_err(|err| err.to_string())
}

fn map_control_error(err: ControlError) -> (StatusCode, Json<serde_json::Value>) {
    match err {
        ControlError::JobNotFound(_) => json_error(StatusCode::NOT_FOUND, err.to_string()),
        ControlError::Fetch(_) | ControlError::Index(_) => {
            json_error(StatusCode::BAD_GATEWAY, err.to_string())
        }
    }
}

fn json_error(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(serde_json::json!({
            "error": message.into(),
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::util::ServiceExt;

    #[tokio::test]
    async fn serves_stats_route() {
        let app = app(AppState {
            data: Arc::new(Mutex::new(PersistentState::default())),
            state_path: Arc::new(PathBuf::from(
                "/tmp/crawler-control-http-rs-test-state.json",
            )),
            graph_sync: Arc::new(GraphSync::new(
                "http://127.0.0.1:0/etzhayyim.sql.v1.SqlQueryService/Execute".to_string(),
                "".to_string(),
                "search".to_string(),
                "search".to_string(),
            )),
            search_sync: Arc::new(SearchSync::new("http://127.0.0.1:0".to_string())),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/xrpc/etzhayyim.crawler.v2.CrawlerQueryService/GetStats")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn writes_pages_to_shared_graph_exec_endpoint() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("local addr");
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0_u8; 8192];
            let read = stream.read(&mut buf).expect("read");
            let request = String::from_utf8_lossy(&buf[..read]);
            assert!(request.contains("POST /etzhayyim.sql.v1.SqlQueryService/Execute"));
            let response = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 11\r\n\r\n{\"ok\":true}";
            stream.write_all(response.as_bytes()).expect("write");
        });

        let graph_sync = GraphSync::new(
            format!("http://{addr}/etzhayyim.sql.v1.SqlQueryService/Execute"),
            "token".to_string(),
            "search".to_string(),
            "search".to_string(),
        );
        let doc = IndexDocument {
            doc_id: "doc-1".to_string(),
            job_id: "job-1".to_string(),
            url: "http://example.com/".to_string(),
            title: "Example Domain".to_string(),
            snippet: "Illustrative example".to_string(),
            content: "This domain is for use in illustrative examples in documents.".to_string(),
        };

        graph_sync.upsert_page(&doc).expect("graph upsert");
    }
}
