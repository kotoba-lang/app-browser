use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

const EMBEDDING_DIM: usize = 64;
pub const fn embedding_dim() -> usize {
    EMBEDDING_DIM
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexDocument {
    pub doc_id: String,
    pub job_id: String,
    pub url: String,
    pub title: String,
    pub snippet: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchHit {
    pub doc_id: String,
    pub url: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectionIndex {
    docs: Vec<IndexDocument>,
}

impl std::fmt::Debug for ProjectionIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProjectionIndex").field("docs", &self.docs).finish()
    }
}

impl Default for ProjectionIndex {
    fn default() -> Self {
        Self { docs: Vec::new() }
    }
}

impl ProjectionIndex {
    pub fn rebuild_runtime(&mut self) {}

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn upsert(&mut self, doc: IndexDocument) {
        if let Some(existing) = self.docs.iter_mut().find(|existing| existing.doc_id == doc.doc_id) {
            *existing = doc;
        } else {
            self.docs.push(doc);
        }
    }

    pub fn search(&self, query: &str, limit: usize, offset: usize) -> Vec<SearchHit> {
        if query.trim().is_empty() || limit == 0 {
            return Vec::new();
        }

        let mut ranked: Vec<(i32, SearchHit)> = Vec::new();
        let query_embedding = embed_text(query);

        for doc in &self.docs {
            let lexical_boost = lexical_boost(doc, query);
            let semantic_score = semantic_boost(&query_embedding, &embedding_for_document(doc));
            let rank_score = lexical_boost + semantic_score;
            if rank_score <= 0 {
                continue;
            }
            ranked.push((rank_score, to_hit(doc)));
        }

        ranked.sort_by(|left, right| right.0.cmp(&left.0));
        ranked
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|(_, hit)| hit)
            .collect()
    }
}

fn to_hit(doc: &IndexDocument) -> SearchHit {
    SearchHit {
        doc_id: doc.doc_id.clone(),
        url: doc.url.clone(),
        title: doc.title.clone(),
        snippet: doc.snippet.clone(),
    }
}

fn stable_vid(value: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

pub fn embedding_for_document(doc: &IndexDocument) -> Vec<f32> {
    embed_text(&format!("{} {} {} {}", doc.title, doc.snippet, doc.content, doc.url))
}

fn embed_text(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0_f32; EMBEDDING_DIM];
    for token in tokenize(text) {
        let bucket = stable_vid(&token) as usize % EMBEDDING_DIM;
        vec[bucket] += 1.0;
    }
    normalize(&mut vec);
    vec
}

fn tokenize(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn normalize(vec: &mut [f32]) {
    let norm = vec.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm == 0.0 {
        return;
    }
    for value in vec {
        *value /= norm;
    }
}

fn lexical_boost(doc: &IndexDocument, query: &str) -> i32 {
    let needle = query.to_ascii_lowercase();
    if needle.is_empty() {
        return 0;
    }
    let title = doc.title.to_ascii_lowercase();
    let snippet = doc.snippet.to_ascii_lowercase();
    let content = doc.content.to_ascii_lowercase();
    let url = doc.url.to_ascii_lowercase();

    let mut score = 0;
    if title.contains(&needle) {
        score += 400;
    }
    if snippet.contains(&needle) {
        score += 250;
    }
    if content.contains(&needle) {
        score += 150;
    }
    if url.contains(&needle) {
        score += 100;
    }
    score
}

fn semantic_boost(left: &[f32], right: &[f32]) -> i32 {
    let similarity = left
        .iter()
        .zip(right.iter())
        .map(|(lhs, rhs)| lhs * rhs)
        .sum::<f32>();
    (similarity * 1000.0) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upserts_and_searches_projection() {
        let mut index = ProjectionIndex::default();
        index.upsert(IndexDocument {
            doc_id: "doc-1".into(),
            job_id: "job-1".into(),
            url: "https://example.com".into(),
            title: "Example Domain".into(),
            snippet: "Illustrative example".into(),
            content: "This domain is for use in illustrative examples in documents.".into(),
        });

        let hits = index.search("illustrative", 10, 0);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc_id, "doc-1");
    }

    #[test]
    fn rebuilds_runtime_after_serde_roundtrip() {
        let mut index = ProjectionIndex::default();
        index.upsert(IndexDocument {
            doc_id: "doc-1".into(),
            job_id: "job-1".into(),
            url: "https://example.com".into(),
            title: "Example Domain".into(),
            snippet: "Illustrative example".into(),
            content: "Example body".into(),
        });

        let raw = serde_json::to_vec(&index).expect("serialize");
        let mut restored: ProjectionIndex = serde_json::from_slice(&raw).expect("deserialize");
        restored.rebuild_runtime();

        let hits = restored.search("Example Domain", 10, 0);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc_id, "doc-1");
    }
}
