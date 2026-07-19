use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontierConfig {
    pub max_depth: u32,
    pub max_pages: u32,
    pub max_domains: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontierItem {
    pub url: String,
    pub host: String,
    pub depth: u32,
    pub parent_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct FrontierStats {
    pub pages_found: u32,
    pub frontier_enqueued: u32,
    pub frontier_done: u32,
    pub frontier_failed: u32,
    pub domains_seen: u32,
}

#[derive(Debug, Error)]
pub enum FrontierError {
    #[error("max domains exceeded")]
    MaxDomainsExceeded,
    #[error("max pages exceeded")]
    MaxPagesExceeded,
    #[error("depth limit exceeded")]
    DepthLimitExceeded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontierState {
    cfg: FrontierConfig,
    queue: VecDeque<FrontierItem>,
    seen_urls: HashSet<String>,
    seen_hosts: HashSet<String>,
    host_inflight: HashMap<String, u32>,
    stats: FrontierStats,
}

impl FrontierState {
    pub fn new(seed_url: String, seed_host: String, cfg: FrontierConfig) -> Self {
        let mut queue = VecDeque::new();
        queue.push_back(FrontierItem {
            url: seed_url.clone(),
            host: seed_host.clone(),
            depth: 0,
            parent_url: None,
        });

        let mut seen_urls = HashSet::new();
        seen_urls.insert(seed_url);
        let mut seen_hosts = HashSet::new();
        seen_hosts.insert(seed_host);

        Self {
            cfg,
            queue,
            seen_urls,
            seen_hosts,
            host_inflight: HashMap::new(),
            stats: FrontierStats {
                frontier_enqueued: 1,
                domains_seen: 1,
                ..FrontierStats::default()
            },
        }
    }

    pub fn enqueue(&mut self, item: FrontierItem) -> Result<bool, FrontierError> {
        if item.depth > self.cfg.max_depth {
            return Err(FrontierError::DepthLimitExceeded);
        }
        if self.stats.pages_found + self.stats.frontier_enqueued >= self.cfg.max_pages {
            return Err(FrontierError::MaxPagesExceeded);
        }
        if self.seen_urls.contains(&item.url) {
            return Ok(false);
        }
        if !self.seen_hosts.contains(&item.host) && self.seen_hosts.len() as u32 >= self.cfg.max_domains {
            return Err(FrontierError::MaxDomainsExceeded);
        }

        self.seen_urls.insert(item.url.clone());
        if self.seen_hosts.insert(item.host.clone()) {
            self.stats.domains_seen += 1;
        }
        self.queue.push_back(item);
        self.stats.frontier_enqueued += 1;
        Ok(true)
    }

    pub fn dequeue_batch(&mut self, limit: usize) -> Vec<FrontierItem> {
        let mut out = Vec::new();
        while out.len() < limit {
            let Some(item) = self.queue.pop_front() else {
                break;
            };
            *self.host_inflight.entry(item.host.clone()).or_default() += 1;
            out.push(item);
        }
        out
    }

    pub fn enqueue_discovered(
        &mut self,
        parent: &FrontierItem,
        urls: &[String],
    ) -> Vec<Result<bool, FrontierError>> {
        let next_depth = parent.depth.saturating_add(1);
        urls.iter()
            .map(|url| {
                let host = host_from_url(url).unwrap_or_default();
                self.enqueue(FrontierItem {
                    url: url.clone(),
                    host,
                    depth: next_depth,
                    parent_url: Some(parent.url.clone()),
                })
            })
            .collect()
    }

    pub fn mark_success(&mut self, item: &FrontierItem) {
        self.stats.pages_found += 1;
        self.stats.frontier_done += 1;
        decrement_host(&mut self.host_inflight, &item.host);
    }

    pub fn mark_failure(&mut self, item: &FrontierItem) {
        self.stats.frontier_done += 1;
        self.stats.frontier_failed += 1;
        decrement_host(&mut self.host_inflight, &item.host);
    }

    pub fn stats(&self) -> &FrontierStats {
        &self.stats
    }

    pub fn queued_len(&self) -> usize {
        self.queue.len()
    }
}

fn decrement_host(inflight: &mut HashMap<String, u32>, host: &str) {
    if let Some(entry) = inflight.get_mut(host) {
        *entry = entry.saturating_sub(1);
        if *entry == 0 {
            inflight.remove(host);
        }
    }
}

fn host_from_url(raw: &str) -> Option<String> {
    let (_, rest) = raw.split_once("://")?;
    let host = rest.split('/').next()?;
    Some(host.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedupes_url_and_tracks_stats() {
        let mut frontier = FrontierState::new(
            "https://example.com".to_string(),
            "example.com".to_string(),
            FrontierConfig {
                max_depth: 2,
                max_pages: 10,
                max_domains: 1,
            },
        );

        let first = frontier.dequeue_batch(1);
        assert_eq!(first.len(), 1);
        frontier.mark_success(&first[0]);
        assert_eq!(frontier.stats().pages_found, 1);

        let inserted = frontier
            .enqueue(FrontierItem {
                url: "https://example.com/about".to_string(),
                host: "example.com".to_string(),
                depth: 1,
                parent_url: Some("https://example.com".to_string()),
            })
            .expect("enqueue");
        assert!(inserted);

        let duplicate = frontier
            .enqueue(FrontierItem {
                url: "https://example.com/about".to_string(),
                host: "example.com".to_string(),
                depth: 1,
                parent_url: None,
            })
            .expect("enqueue duplicate");
        assert!(!duplicate);
    }

    #[test]
    fn enqueues_discovered_links_with_parent_depth() {
        let mut frontier = FrontierState::new(
            "https://example.com".to_string(),
            "example.com".to_string(),
            FrontierConfig {
                max_depth: 2,
                max_pages: 10,
                max_domains: 1,
            },
        );

        let batch = frontier.dequeue_batch(1);
        let parent = &batch[0];
        let results = frontier.enqueue_discovered(
            parent,
            &[
                "https://example.com/about".to_string(),
                "https://example.com/contact".to_string(),
            ],
        );

        assert_eq!(results.len(), 2);
        assert!(matches!(results[0], Ok(true)));
        assert_eq!(frontier.queued_len(), 2);
    }
}
