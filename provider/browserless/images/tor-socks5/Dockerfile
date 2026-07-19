FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends tor ca-certificates \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 9050

ENTRYPOINT ["tor"]
CMD ["--SocksPort", "0.0.0.0:9050", "--DataDirectory", "/tmp/tor", "--RunAsDaemon", "0"]
