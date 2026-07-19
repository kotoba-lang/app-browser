FROM rust:1.90-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY vendor ./vendor

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/crawler-control-http-rs /app/crawler-control-http-rs

ENV LISTEN_ADDR=0.0.0.0:8080
ENV STATE_PATH=/data/crawler-v2-state.json

ENTRYPOINT ["/app/crawler-control-http-rs"]
