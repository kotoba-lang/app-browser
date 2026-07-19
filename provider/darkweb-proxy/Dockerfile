FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tor \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    fonts-liberation fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production=false && npx playwright install chromium --with-deps

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Tor config: SOCKS5 on 9050, no relay (client-only)
RUN echo "SocksPort 9050\nRunAsDaemon 0\nDataDirectory /tmp/tor\nLog notice stderr" > /etc/tor/torrc-darkweb

ENV PORT=8080
ENV TOR_PROXY=socks5://127.0.0.1:9050
ENV MAX_CONCURRENCY=2
ENV NAV_TIMEOUT_MS=45000
ENV SCREENSHOT=0
EXPOSE 8080

# Start Tor in background, then launch proxy server
CMD ["sh", "-c", "tor -f /etc/tor/torrc-darkweb & sleep 5 && node --enable-source-maps dist/server.js"]
