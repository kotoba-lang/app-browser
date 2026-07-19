wit_bindgen::generate!({
    world: "w-extension",
    path: "wit",
});

use crawler_control_rs::{
    extension_kinds, route_extension, ControlCommand, ControlQuery, ControlRoute, ControlService,
    FetchGateway, FetchedPage, IndexGateway, IndexedDocument,
};
use crawler_fetch_rs::{FetchProvider, FetchRequest};
use crawler_indexer_rs::{IndexDocument, ProjectionIndex};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;

struct CrawlerControlExtension;

static CONTROL_SERVICE: Lazy<Mutex<ControlService>> =
    Lazy::new(|| Mutex::new(ControlService::default()));
static FETCH_PROVIDER: Lazy<FetchProvider> = Lazy::new(FetchProvider::new);
static PROJECTION_INDEX: Lazy<Mutex<ProjectionIndex>> =
    Lazy::new(|| Mutex::new(ProjectionIndex::default()));

struct FetchProviderAdapter;

impl FetchGateway for FetchProviderAdapter {
    fn fetch(&self, url: &str, _render_javascript: bool) -> Result<FetchedPage, String> {
        let response = FETCH_PROVIDER
            .fetch(FetchRequest {
                url: url.to_string(),
                method: None,
                user_agent: None,
                timeout_ms: Some(10_000),
                headers: Vec::new(),
            })
            .map_err(|err| err.to_string())?;
        Ok(FetchedPage {
            url: response.url,
            final_url: response.final_url,
            status_code: response.status,
            content_type: response.content_type,
            body: response.body,
        })
    }
}

struct ProjectionIndexAdapter<'a> {
    index: &'a mut ProjectionIndex,
}

impl IndexGateway for ProjectionIndexAdapter<'_> {
    fn upsert(&mut self, doc: IndexedDocument) -> Result<(), String> {
        self.index.upsert(IndexDocument {
            doc_id: doc.doc_id,
            job_id: doc.job_id,
            url: doc.url,
            title: doc.title,
            snippet: doc.snippet,
            content: doc.content,
        });
        Ok(())
    }
}

impl exports::etzhayyim::w::extension_meta::Guest for CrawlerControlExtension {
    fn name() -> String {
        "etzhayyim:crawler-control@0.1.0".to_string()
    }

    fn kinds() -> Vec<String> {
        extension_kinds().iter().map(|kind| (*kind).to_string()).collect()
    }

    fn description() -> String {
        "Crawler control extension facade for W Protocol and kotodama host.".to_string()
    }
}

impl exports::etzhayyim::w::extension_handler::Guest for CrawlerControlExtension {
    fn handle(envelope_json: Vec<u8>) -> Result<Option<Vec<u8>>, String> {
        let mut service = CONTROL_SERVICE
            .lock()
            .map_err(|err| format!("control service lock poisoned: {err}"))?;
        let mut index = PROJECTION_INDEX
            .lock()
            .map_err(|err| format!("projection index lock poisoned: {err}"))?;
        let mut index_adapter = ProjectionIndexAdapter { index: &mut index };
        let response = dispatch_with_gateways(
            &mut service,
            &envelope_json,
            &FetchProviderAdapter,
            &mut index_adapter,
        )?;
        Ok(Some(response))
    }

    fn init() -> Result<(), String> {
        Ok(())
    }
}

fn serialize_response<T: Serialize>(op: &'static str, payload: T) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&serde_json::json!({
        "op": op,
        "payload": payload,
    }))
    .map_err(|err| err.to_string())
}

fn dispatch_with_gateways<F, I>(
    service: &mut ControlService,
    envelope_json: &[u8],
    fetcher: &F,
    indexer: &mut I,
) -> Result<Vec<u8>, String>
where
    F: FetchGateway,
    I: IndexGateway,
{
    let routed = route_extension(envelope_json).map_err(|err| err.to_string())?;
    match routed {
        ControlRoute::Command(command) => match command {
            ControlCommand::StartJob(input) => {
                let output = service.start_job(None, input).map_err(|err| err.to_string())?;
                let job_id = output.job.job_id.clone();
                let _ = service.process_next(&job_id, fetcher, indexer);
                let output = service
                    .get_job(crawler_control_rs::GetJobInput { job_id })
                    .map_err(|err| err.to_string())?;
                serialize_response("crawler.job.start", output)
            }
            ControlCommand::CancelJob(input) => {
                let output = service.cancel_job(input).map_err(|err| err.to_string())?;
                serialize_response("crawler.job.cancel", output)
            }
        },
        ControlRoute::Query(query) => match query {
            ControlQuery::GetJob(input) => {
                let output = service.get_job(input).map_err(|err| err.to_string())?;
                serialize_response("crawler.job.status", output)
            }
            ControlQuery::ListResults(input) => {
                let output = service.list_results(input).map_err(|err| err.to_string())?;
                serialize_response("crawler.result.list", output)
            }
            ControlQuery::SearchResults(input) => {
                let output = service.search_results(input);
                serialize_response("crawler.result.search", output)
            }
            ControlQuery::GetStats(_) => {
                let output = service.get_stats();
                serialize_response("crawler.stats.get", output)
            }
        },
    }
}

export!(CrawlerControlExtension);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exports::etzhayyim::w::extension_handler::Guest;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[derive(Default)]
    struct FakeIndex {
        docs: Vec<IndexedDocument>,
    }

    impl IndexGateway for FakeIndex {
        fn upsert(&mut self, doc: IndexedDocument) -> Result<(), String> {
            self.docs.push(doc);
            Ok(())
        }
    }

    struct FakeFetch;

    impl FetchGateway for FakeFetch {
        fn fetch(&self, url: &str, _render_javascript: bool) -> Result<FetchedPage, String> {
            static COUNT: AtomicU64 = AtomicU64::new(0);
            let n = COUNT.fetch_add(1, Ordering::Relaxed);
            Ok(FetchedPage {
                url: url.to_string(),
                final_url: url.to_string(),
                status_code: 200,
                content_type: Some("text/html".into()),
                body: format!(
                    "<html><head><title>Example Domain {n}</title></head><body>This domain is for use in illustrative examples in documents.</body></html>"
                )
                .into_bytes(),
            })
        }
    }

    #[test]
    fn handles_start_job_envelope() {
        let mut service = ControlService::default();
        let mut index = FakeIndex::default();
        let envelope = json!({
            "kind": "crawler.job.start",
            "body": {
                "url": "https://example.com",
                "max_depth": 2,
                "max_pages": 10,
                "max_domains": 1,
                "render_javascript": false
            }
        });

        let bytes = serde_json::to_vec(&envelope).expect("envelope json");
        let response = dispatch_with_gateways(&mut service, &bytes, &FakeFetch, &mut index)
            .expect("dispatch");
        let value: serde_json::Value = serde_json::from_slice(&response).expect("response json");

        assert_eq!(value["op"], "crawler.job.start");
        assert_eq!(value["payload"]["job"]["url"], "https://example.com");
        assert_eq!(value["payload"]["job"]["max_depth"], 2);
        assert_eq!(value["payload"]["job"]["status"], "completed");
    }

    #[test]
    fn handles_start_then_search_envelope() {
        let mut service = ControlService::default();
        let mut index = FakeIndex::default();
        let start = json!({
            "kind": "crawler.job.start",
            "body": {
                "url": "https://example.com",
                "max_depth": 1,
                "max_pages": 1,
                "max_domains": 1,
                "render_javascript": false
            }
        });
        let start_bytes = serde_json::to_vec(&start).expect("start json");
        let _ = dispatch_with_gateways(&mut service, &start_bytes, &FakeFetch, &mut index)
            .expect("start dispatch");

        let search = json!({
            "kind": "crawler.result.search",
            "body": {
                "query": "example domain",
                "offset": 0,
                "limit": 10
            }
        });
        let search_bytes = serde_json::to_vec(&search).expect("search json");
        let response = dispatch_with_gateways(&mut service, &search_bytes, &FakeFetch, &mut index)
            .expect("search dispatch");
        let value: serde_json::Value = serde_json::from_slice(&response).expect("search response json");

        assert_eq!(value["op"], "crawler.result.search");
        assert!(value["payload"]["total"].as_u64().unwrap_or(0) >= 1);
    }

    #[test]
    fn handles_stats_envelope() {
        let mut service = ControlService::default();
        let mut index = FakeIndex::default();
        let start = json!({
            "kind": "crawler.job.start",
            "body": {
                "url": "https://example.com",
                "max_depth": 1,
                "max_pages": 1,
                "max_domains": 1,
                "render_javascript": false
            }
        });
        let start_bytes = serde_json::to_vec(&start).expect("start json");
        let _ = dispatch_with_gateways(&mut service, &start_bytes, &FakeFetch, &mut index)
            .expect("start dispatch");

        let stats = json!({
            "kind": "crawler.stats.get",
            "body": {}
        });
        let stats_bytes = serde_json::to_vec(&stats).expect("stats json");
        let response = dispatch_with_gateways(&mut service, &stats_bytes, &FakeFetch, &mut index)
            .expect("stats dispatch");
        let value: serde_json::Value = serde_json::from_slice(&response).expect("stats response json");

        assert_eq!(value["op"], "crawler.stats.get");
        assert_eq!(value["payload"]["total_jobs"], 1);
        assert_eq!(value["payload"]["total_results"], 1);
    }

    #[test]
    fn exported_handle_still_works() {
        let envelope = json!({
            "kind": "crawler.job.start",
            "body": {
                "url": "https://example.com",
                "max_depth": 1,
                "max_pages": 1,
                "max_domains": 1,
                "render_javascript": false
            }
        });
        let bytes = serde_json::to_vec(&envelope).expect("envelope json");
        let response = CrawlerControlExtension::handle(bytes)
            .expect("extension handle")
            .expect("response bytes");
        let value: serde_json::Value = serde_json::from_slice(&response).expect("response json");
        assert_eq!(value["op"], "crawler.job.start");
    }
}
