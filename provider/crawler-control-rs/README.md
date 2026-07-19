# crawler-control-rs

Rust control-plane core for crawler split v2.

## Responsibility

- Connect facade command/query mapping
- W Protocol extension kind routing
- canonical command/query payloads for downstream frontier/fetch/index components

## Notes

- This crate is intentionally pure Rust domain logic first.
- The next step is to wrap it with:
  - a `etzhayyim:w/w-extension` export for W Protocol
  - a `kotodama` HTTP facade for Connect routes
