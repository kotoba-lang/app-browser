# Migration TODO — etzhayyim-project-browser

**Status**: 🔄 TRANSFORM (partial-merge) — net-new files merged from etzhayyimcojp archive 2026-06-02.
Existing etzhayyim files were NOT overwritten (additive merge).

**Codemod pending** (substrate-boundary ADR-2605172000 / 2605172100):
- Reconcile archive-origin code with the etzhayyim kotoba/on-chain version where they overlap.
- Strip any RisingWave / fiat → AT MST + IPFS + Base L2 + USDC/ERC-4337.


## Rust → cljc (ADR-2607072000)

`provider/` carries six Rust crates. They are not one kind of thing, and the
rule only reaches one of them: implementations that would reach for Rust are
written in `.cljc`; decision-free mechanism is the documented exception.

| crate | lines | what it is | status |
|---|---|---|---|
| `crawler-frontier-rs` | 237 | the crawl policy: depth, page and domain budgets, dedup, FIFO order | **ported** → `provider/crawler-frontier` (`.cljc`), parity transcript in `frontier_test.cljc` |
| `crawler-indexer-rs` | 210 | in-memory index + 64-dim embedding + search | **ported** → `provider/crawler-indexer` (`.cljc`). Parity holds for everything specified; the embedding deliberately does NOT match — see below |
| `crawler-fetch-rs` | 139 | reqwest HTTP client | mechanism (transport). `capability-http-fetch` is the shape a port would take, not a `.cljc` rewrite of reqwest |
| `crawler-control-rs` | 724 | orchestrator | unexamined; expect a decision core inside a mechanism shell |
| `crawler-control-http-rs` | 537 | HTTP server around the above | mechanism |
| `crawler-control-extension-rs` | 310 | browser-extension bridge | mechanism |

**How the parity was established, and how it must be extended.** The frontier's
expectations were produced by RUNNING the crate — its core needs nothing but
std once the derives are stripped, so it was driven through a scripted
sequence and its stats printed after every step. `frontier_test.cljc` replays
that script. Reading the source instead would have missed the one thing the
test now pins: the page budget is checked BEFORE dedup, so a duplicate offered
after the budget is spent is an error, not a free no-op. Moving that check to
where it "obviously" belongs turns the suite red.

The Rust crates stay for now: they are wired into the running crawler. What has
changed is that the frontier's policy is no longer only expressible in Rust.


### The indexer's embedding is where parity legitimately stops

`crawler-indexer-rs` buckets a token with `std::collections::hash_map::
DefaultHasher`. Rust does not specify that algorithm and does not promise it
across releases, so which of the 64 buckets a token lands in is a property of
the toolchain rather than of the token. Two builds of the same crate are not
guaranteed to produce comparable embeddings.

That is a latent defect, not a detail to reproduce. Measured: over two
documents with identical lexical scores the crate returned `["2", "1"]`, an
order decided entirely by that hash.

So the port uses FNV-1a 32 — written out, a function of the bytes, the same on
every runtime and version. 32 rather than 64 because ClojureScript has no
64-bit integer, and a `.cljc` FNV-1a 64 would silently degrade into doubles on
one of the two hosts.

The consequence is stated rather than hidden: **the port's ranking among
documents with equal lexical scores differs from the crate's.** Everything
specified is identical and pinned — the 400/250/150/100 weights,
case-insensitivity, Unicode tokenization, empty-query and zero-limit answers,
upsert-by-id-in-place, and paging over matches rather than the corpus. The
tests assert the matching SET, not that order, because asserting the order
would pin this port to a number `rustup update` may change.
