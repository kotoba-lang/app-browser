# crawler-control-extension-rs

Thin Rust WIT component that exports `etzhayyim:w/w-extension` for crawler control.

Responsibilities:

- expose extension metadata (`crawler.job.*`, `crawler.result.*`)
- accept inbound W Protocol envelopes as JSON
- delegate kind routing and payload decoding to `crawler-control-rs`
- return a small JSON response for the host/runtime integration layer

This crate is intentionally thin. Actual orchestration logic belongs in
`crawler-control-rs` and later component/provider wrappers.
