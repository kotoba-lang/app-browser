use std::collections::HashMap;

use crawler_frontier_rs::{FrontierConfig, FrontierState};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const KIND_JOB_START: &str = "crawler.job.start";
pub const KIND_JOB_CANCEL: &str = "crawler.job.cancel";
pub const KIND_JOB_STATUS: &str = "crawler.job.status";
pub const KIND_RESULT_LIST: &str = "crawler.result.list";
pub const KIND_RESULT_SEARCH: &str = "crawler.result.search";
pub const KIND_STATS_GET: &str = "crawler.stats.get";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandContext {
    pub org_id: String,
    pub clerk_user_id: String,
    pub actor_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryContext {
    pub org_id: String,
    pub clerk_user_id: String,
    pub actor_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartJobInput {
    pub url: String,
    pub max_depth: u32,
    pub max_pages: u32,
    pub max_domains: u32,
    pub render_javascript: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelJobInput {
    pub job_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GetJobInput {
    pub job_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListResultsInput {
    pub job_id: String,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchResultsInput {
    pub query: String,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct GetStatsInput {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Accepted,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrawlJob {
    pub job_id: String,
    pub org_id: Option<String>,
    pub url: String,
    pub status: JobStatus,
    pub max_depth: u32,
    pub max_pages: u32,
    pub max_domains: u32,
    pub render_javascript: bool,
    pub pages_found: u32,
    pub frontier_enqueued: u32,
    pub frontier_done: u32,
    pub frontier_failed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrawlResult {
    pub result_id: String,
    pub job_id: String,
    pub url: String,
    pub title: String,
    pub snippet: String,
    pub text_content: String,
    pub status_code: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexedDocument {
    pub doc_id: String,
    pub job_id: String,
    pub url: String,
    pub title: String,
    pub snippet: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FetchedPage {
    pub url: String,
    pub final_url: String,
    pub status_code: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartJobOutput {
    pub job: CrawlJob,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelJobOutput {
    pub job: CrawlJob,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GetJobOutput {
    pub job: CrawlJob,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListResultsOutput {
    pub total: u32,
    pub results: Vec<CrawlResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchResultsOutput {
    pub total: u32,
    pub results: Vec<CrawlResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GetStatsOutput {
    pub total_jobs: u32,
    pub total_results: u32,
    pub total_indexed_docs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", content = "input")]
pub enum ControlCommand {
    StartJob(StartJobInput),
    CancelJob(CancelJobInput),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", content = "input")]
pub enum ControlQuery {
    GetJob(GetJobInput),
    ListResults(ListResultsInput),
    SearchResults(SearchResultsInput),
    GetStats(GetStatsInput),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtensionEnvelope {
    pub kind: String,
    pub body: serde_json::Value,
}

#[derive(Debug, Error)]
pub enum ControlError {
    #[error("unsupported kind: {0}")]
    UnsupportedKind(String),
    #[error("invalid payload: {0}")]
    InvalidPayload(String),
    #[error("job not found: {0}")]
    JobNotFound(String),
    #[error("frontier error: {0}")]
    Frontier(String),
    #[error("fetch error: {0}")]
    Fetch(String),
    #[error("index error: {0}")]
    Index(String),
}

pub fn extension_kinds() -> [&'static str; 6] {
    [
        KIND_JOB_START,
        KIND_JOB_CANCEL,
        KIND_JOB_STATUS,
        KIND_RESULT_LIST,
        KIND_RESULT_SEARCH,
        KIND_STATS_GET,
    ]
}

pub fn route_extension(envelope_json: &[u8]) -> Result<ControlRoute, ControlError> {
    let env: ExtensionEnvelope = serde_json::from_slice(envelope_json)
        .map_err(|err| ControlError::InvalidPayload(err.to_string()))?;

    match env.kind.as_str() {
        KIND_JOB_START => Ok(ControlRoute::Command(ControlCommand::StartJob(
            serde_json::from_value(env.body)
                .map_err(|err| ControlError::InvalidPayload(err.to_string()))?,
        ))),
        KIND_JOB_CANCEL => Ok(ControlRoute::Command(ControlCommand::CancelJob(
            serde_json::from_value(env.body)
                .map_err(|err| ControlError::InvalidPayload(err.to_string()))?,
        ))),
        KIND_JOB_STATUS => Ok(ControlRoute::Query(ControlQuery::GetJob(
            serde_json::from_value(env.body)
                .map_err(|err| ControlError::InvalidPayload(err.to_string()))?,
        ))),
        KIND_RESULT_LIST => Ok(ControlRoute::Query(ControlQuery::ListResults(
            serde_json::from_value(env.body)
                .map_err(|err| ControlError::InvalidPayload(err.to_string()))?,
        ))),
        KIND_RESULT_SEARCH => Ok(ControlRoute::Query(ControlQuery::SearchResults(
            serde_json::from_value(env.body)
                .map_err(|err| ControlError::InvalidPayload(err.to_string()))?,
        ))),
        KIND_STATS_GET => Ok(ControlRoute::Query(ControlQuery::GetStats(
            serde_json::from_value(env.body)
                .map_err(|err| ControlError::InvalidPayload(err.to_string()))?,
        ))),
        other => Err(ControlError::UnsupportedKind(other.to_string())),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlRoute {
    Command(ControlCommand),
    Query(ControlQuery),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct JobRecord {
    job: CrawlJob,
    frontier: FrontierState,
    results: Vec<CrawlResult>,
    indexed: Vec<IndexedDocument>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ControlService {
    jobs: HashMap<String, JobRecord>,
    next_job_seq: u64,
    next_result_seq: u64,
}

impl ControlService {
    pub fn start_job(
        &mut self,
        ctx: Option<CommandContext>,
        input: StartJobInput,
    ) -> Result<StartJobOutput, ControlError> {
        let job_id = self.next_job_id();
        let host = url_host(&input.url).unwrap_or_default();
        let frontier = FrontierState::new(
            input.url.clone(),
            host,
            FrontierConfig {
                max_depth: input.max_depth,
                max_pages: input.max_pages,
                max_domains: input.max_domains,
            },
        );

        let job = CrawlJob {
            job_id: job_id.clone(),
            org_id: ctx.map(|item| item.org_id),
            url: input.url.clone(),
            status: JobStatus::Accepted,
            max_depth: input.max_depth,
            max_pages: input.max_pages,
            max_domains: input.max_domains,
            render_javascript: input.render_javascript,
            pages_found: 0,
            frontier_enqueued: frontier.stats().frontier_enqueued,
            frontier_done: frontier.stats().frontier_done,
            frontier_failed: frontier.stats().frontier_failed,
        };

        self.jobs.insert(
            job_id,
            JobRecord {
                job: job.clone(),
                frontier,
                results: Vec::new(),
                indexed: Vec::new(),
            },
        );

        Ok(StartJobOutput { job })
    }

    pub fn cancel_job(&mut self, input: CancelJobInput) -> Result<CancelJobOutput, ControlError> {
        let record = self
            .jobs
            .get_mut(&input.job_id)
            .ok_or_else(|| ControlError::JobNotFound(input.job_id.clone()))?;
        record.job.status = JobStatus::Cancelled;
        Ok(CancelJobOutput {
            job: record.job.clone(),
        })
    }

    pub fn get_job(&self, input: GetJobInput) -> Result<GetJobOutput, ControlError> {
        let record = self
            .jobs
            .get(&input.job_id)
            .ok_or_else(|| ControlError::JobNotFound(input.job_id.clone()))?;
        Ok(GetJobOutput {
            job: record.job.clone(),
        })
    }

    pub fn list_results(&self, input: ListResultsInput) -> Result<ListResultsOutput, ControlError> {
        let record = self
            .jobs
            .get(&input.job_id)
            .ok_or_else(|| ControlError::JobNotFound(input.job_id.clone()))?;
        let slice = paginate(&record.results, input.offset, input.limit);
        Ok(ListResultsOutput {
            total: record.results.len() as u32,
            results: slice.to_vec(),
        })
    }

    pub fn search_results(&self, input: SearchResultsInput) -> SearchResultsOutput {
        let needle = input.query.to_ascii_lowercase();
        let mut matches = Vec::new();
        for record in self.jobs.values() {
            for doc in &record.indexed {
                if doc.title.to_ascii_lowercase().contains(&needle)
                    || doc.snippet.to_ascii_lowercase().contains(&needle)
                    || doc.content.to_ascii_lowercase().contains(&needle)
                    || doc.url.to_ascii_lowercase().contains(&needle)
                {
                    matches.push(CrawlResult {
                        result_id: doc.doc_id.clone(),
                        job_id: doc.job_id.clone(),
                        url: doc.url.clone(),
                        title: doc.title.clone(),
                        snippet: doc.snippet.clone(),
                        text_content: doc.content.clone(),
                        status_code: 200,
                    });
                }
            }
        }
        let total = matches.len() as u32;
        let results = paginate(&matches, input.offset, input.limit).to_vec();
        SearchResultsOutput { total, results }
    }

    pub fn ingest_result(
        &mut self,
        job_id: &str,
        url: String,
        title: String,
        snippet: String,
        status_code: u16,
    ) -> Result<CrawlResult, ControlError> {
        let result_id = self.next_result_id(job_id);
        let record = self
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| ControlError::JobNotFound(job_id.to_string()))?;

        let result = CrawlResult {
            result_id,
            job_id: job_id.to_string(),
            url,
            title,
            snippet: snippet.clone(),
            text_content: snippet.clone(),
            status_code,
        };
        record.results.push(result.clone());
        record.job.status = JobStatus::Running;
        record.frontier_done_success();
        Ok(result)
    }

    pub fn process_next<F, I>(
        &mut self,
        job_id: &str,
        fetcher: &F,
        indexer: &mut I,
    ) -> Result<Option<CrawlResult>, ControlError>
    where
        F: FetchGateway,
        I: IndexGateway,
    {
        let result_id = self.next_result_id(job_id);
        let record = self
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| ControlError::JobNotFound(job_id.to_string()))?;

        if matches!(record.job.status, JobStatus::Cancelled | JobStatus::Completed) {
            return Ok(None);
        }

        let batch = record.frontier.dequeue_batch(1);
        let Some(item) = batch.into_iter().next() else {
            record.job.status = JobStatus::Completed;
            return Ok(None);
        };

        record.job.status = JobStatus::Running;
        let fetched = match fetcher.fetch(&item.url, record.job.render_javascript) {
            Ok(page) => page,
            Err(err) => {
                record.frontier.mark_failure(&item);
                record.sync_stats();
                record.job.status = JobStatus::Failed;
                return Err(ControlError::Fetch(err));
            }
        };

        let content = String::from_utf8_lossy(&fetched.body).into_owned();
        let title = extract_title(&content).unwrap_or_else(|| fetched.final_url.clone());
        let snippet = summarize_text(&content);
        let discovered = extract_links(&fetched.final_url, &content);
        let result = CrawlResult {
            result_id,
            job_id: job_id.to_string(),
            url: fetched.final_url.clone(),
            title: title.clone(),
            snippet: snippet.clone(),
            text_content: content.clone(),
            status_code: fetched.status_code,
        };
        let document = IndexedDocument {
            doc_id: result.result_id.clone(),
            job_id: result.job_id.clone(),
            url: result.url.clone(),
            title,
            snippet,
            content,
        };

        indexer
            .upsert(document.clone())
            .map_err(ControlError::Index)?;

        let _ = record.frontier.enqueue_discovered(&item, &discovered);

        record.results.push(result.clone());
        record.indexed.push(document);
        record.frontier.mark_success(&item);
        record.sync_stats();
        if record.frontier.queued_len() == 0 {
            record.job.status = JobStatus::Completed;
        }
        Ok(Some(result))
    }

    pub fn get_stats(&self) -> GetStatsOutput {
        let total_jobs = self.jobs.len() as u32;
        let total_results = self
            .jobs
            .values()
            .map(|record| record.results.len() as u32)
            .sum();
        let total_indexed_docs = self
            .jobs
            .values()
            .map(|record| record.indexed.len() as u32)
            .sum();
        GetStatsOutput {
            total_jobs,
            total_results,
            total_indexed_docs,
        }
    }

    fn next_job_id(&mut self) -> String {
        self.next_job_seq += 1;
        format!("job-{:06}", self.next_job_seq)
    }

    fn next_result_id(&mut self, job_id: &str) -> String {
        self.next_result_seq += 1;
        format!("res-{job_id}-{:06}", self.next_result_seq)
    }
}

impl JobRecord {
    fn frontier_done_success(&mut self) {
        let batch = self.frontier.dequeue_batch(1);
        if let Some(item) = batch.first() {
            self.frontier.mark_success(item);
        }
        let stats = self.frontier.stats();
        self.job.pages_found = stats.pages_found;
        self.job.frontier_enqueued = stats.frontier_enqueued;
        self.job.frontier_done = stats.frontier_done;
        self.job.frontier_failed = stats.frontier_failed;
        if self.frontier.queued_len() == 0 {
            self.job.status = JobStatus::Completed;
        }
    }

    fn sync_stats(&mut self) {
        let stats = self.frontier.stats();
        self.job.pages_found = stats.pages_found;
        self.job.frontier_enqueued = stats.frontier_enqueued;
        self.job.frontier_done = stats.frontier_done;
        self.job.frontier_failed = stats.frontier_failed;
    }
}

pub trait FetchGateway {
    fn fetch(&self, url: &str, render_javascript: bool) -> Result<FetchedPage, String>;
}

pub trait IndexGateway {
    fn upsert(&mut self, doc: IndexedDocument) -> Result<(), String>;
}

fn paginate<T>(items: &[T], offset: u32, limit: u32) -> &[T] {
    let start = offset as usize;
    if start >= items.len() {
        return &items[0..0];
    }
    let end = if limit == 0 {
        items.len()
    } else {
        usize::min(items.len(), start + limit as usize)
    };
    &items[start..end]
}

fn url_host(raw: &str) -> Option<String> {
    let (_, rest) = raw.split_once("://")?;
    let host = rest.split('/').next()?;
    Some(host.to_string())
}

fn extract_title(content: &str) -> Option<String> {
    let lower = content.to_ascii_lowercase();
    let start = lower.find("<title>")?;
    let end = lower[start + 7..].find("</title>")?;
    Some(content[start + 7..start + 7 + end].trim().to_string())
}

fn summarize_text(content: &str) -> String {
    let mut out = String::with_capacity(160);
    let mut in_tag = false;
    for ch in content.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => {
                if !ch.is_control() {
                    out.push(ch);
                }
                if out.len() >= 160 {
                    break;
                }
            }
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_links(base_url: &str, content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = content.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel_idx) = lower[cursor..].find("href=") {
        let idx = cursor + rel_idx + 5;
        let bytes = content.as_bytes();
        if idx >= bytes.len() {
            break;
        }
        let quote = bytes[idx] as char;
        if quote != '"' && quote != '\'' {
            cursor = idx;
            continue;
        }
        let start = idx + 1;
        let Some(end_rel) = content[start..].find(quote) else {
            break;
        };
        let raw = &content[start..start + end_rel];
        if let Some(url) = absolutize_url(base_url, raw) {
            out.push(url);
        }
        cursor = start + end_rel + 1;
    }
    out
}

fn absolutize_url(base_url: &str, raw: &str) -> Option<String> {
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Some(raw.to_string());
    }
    if !raw.starts_with('/') {
        return None;
    }
    let (scheme, rest) = base_url.split_once("://")?;
    let host = rest.split('/').next()?;
    Some(format!("{scheme}://{host}{raw}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeFetcher {
        page: FetchedPage,
    }

    impl FetchGateway for FakeFetcher {
        fn fetch(&self, _url: &str, _render_javascript: bool) -> Result<FetchedPage, String> {
            Ok(self.page.clone())
        }
    }

    #[derive(Default)]
    struct FakeIndexer {
        docs: Vec<IndexedDocument>,
    }

    impl IndexGateway for FakeIndexer {
        fn upsert(&mut self, doc: IndexedDocument) -> Result<(), String> {
            self.docs.push(doc);
            Ok(())
        }
    }

    #[test]
    fn routes_start_job_extension() {
        let route = route_extension(
            br#"{"kind":"crawler.job.start","body":{"url":"https://example.com","max_depth":1,"max_pages":10,"max_domains":1,"render_javascript":false}}"#,
        )
        .expect("route");

        assert!(matches!(
            route,
            ControlRoute::Command(ControlCommand::StartJob(StartJobInput { .. }))
        ));
    }

    #[test]
    fn orchestrates_job_lifecycle() {
        let mut svc = ControlService::default();
        let started = svc
            .start_job(
                Some(CommandContext {
                    org_id: "org_123".into(),
                    clerk_user_id: "user_123".into(),
                    actor_id: "actor_123".into(),
                    correlation_id: "corr_123".into(),
                }),
                StartJobInput {
                    url: "https://example.com".into(),
                    max_depth: 1,
                    max_pages: 5,
                    max_domains: 1,
                    render_javascript: false,
                },
            )
            .expect("start job");

        let job_id = started.job.job_id.clone();
        let fetcher = FakeFetcher {
            page: FetchedPage {
                url: "https://example.com".into(),
                final_url: "https://example.com".into(),
                status_code: 200,
                content_type: Some("text/html".into()),
                body: br#"<html><head><title>Example Domain</title></head><body>This domain is for use in illustrative examples in documents. <a href="/about">About</a></body></html>"#.to_vec(),
            },
        };
        let mut indexer = FakeIndexer::default();

        let result = svc
            .process_next(&job_id, &fetcher, &mut indexer)
            .expect("process next")
            .expect("result");
        assert_eq!(result.status_code, 200);
        assert!(result.text_content.contains("illustrative examples"));
        assert_eq!(indexer.docs.len(), 1);

        let job = svc
            .get_job(GetJobInput { job_id: job_id.clone() })
            .expect("get job");
        assert_eq!(job.job.status, JobStatus::Running);
        assert_eq!(job.job.frontier_enqueued, 2);

        let listed = svc
            .list_results(ListResultsInput {
                job_id,
                offset: 0,
                limit: 10,
            })
            .expect("list results");
        assert_eq!(listed.total, 1);

        let searched = svc.search_results(SearchResultsInput {
            query: "illustrative".into(),
            offset: 0,
            limit: 10,
        });
        assert_eq!(searched.total, 1);

        let stats = svc.get_stats();
        assert_eq!(stats.total_jobs, 1);
        assert_eq!(stats.total_results, 1);
    }
}
