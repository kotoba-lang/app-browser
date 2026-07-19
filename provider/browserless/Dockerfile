FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    fonts-liberation fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production=false && npx playwright install chromium --with-deps
RUN npm run build || true

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

ENV PORT=8080
ENV MAX_CONCURRENCY=3
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--enable-source-maps", "dist/server.js"]
