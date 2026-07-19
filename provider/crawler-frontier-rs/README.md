# crawler-frontier-rs

Rust frontier core for crawler split v2.

## Responsibility

- dedupe
- per-host domain budget
- enqueue/dequeue
- completion/failure accounting

This is the logic that will later be wrapped by a `kotodama` component/provider.
