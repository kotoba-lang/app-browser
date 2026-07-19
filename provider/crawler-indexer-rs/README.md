# crawler-indexer-rs

Rust index/projection core for crawler split architecture.

Responsibilities:

- accept normalized crawl documents
- materialize search-friendly projection records
- provide in-process search for command/query facade tests

This crate is the domain core. A later component wrapper can expose it through
kotodama host or a dedicated query facade.
