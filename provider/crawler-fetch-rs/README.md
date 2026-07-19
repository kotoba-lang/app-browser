# crawler-fetch-rs

Rust-native fetch provider core for crawler v2 / split crawler architecture.

Responsibilities:

- perform outbound HTTP fetch with timeout and user-agent normalization
- stay independent from kotodama guest constraints
- serve as the implementation core for a later native provider wrapper

This crate intentionally starts as a library-first core. The provider-facing
transport shell can wrap this without changing crawl orchestration contracts.
