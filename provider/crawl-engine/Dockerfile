FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ src/

RUN npx tsc

RUN npm prune --production

FROM node:22-alpine

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json .

ENTRYPOINT ["node", "--enable-source-maps", "dist/index.js"]
