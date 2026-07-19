import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Engine } from "./engine.js";
import type { CrawlPageRequest, RobotsRequest } from "./types.js";

const GRPC_PREFIX = "/xrpc/etzhayyim.crawlEngine.v1.CrawlEngineService/";

function loadConfigFromEnv(): Record<string, string> {
  const cfg: Record<string, string> = {};
  if (process.env["BROWSERLESS_URL"]) {
    cfg["BROWSERLESS_URL"] = process.env["BROWSERLESS_URL"];
  }
  if (process.env["LASER_BASE_URL"]) {
    cfg["LASER_BASE_URL"] = process.env["LASER_BASE_URL"];
  }
  return cfg;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJSON(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function writeErrorJSON(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  writeJSON(res, status, { code, message });
}

function writeCORS(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Connect-Protocol-Version",
  );
}

async function handleCrawlPage(
  eng: Engine,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  let parsed: CrawlPageRequest;
  try {
    parsed = JSON.parse(body) as CrawlPageRequest;
  } catch {
    writeErrorJSON(res, 400, "decodeError", "invalid JSON body");
    return;
  }
  if (!parsed.url) {
    writeErrorJSON(res, 400, "invalidRequest", "url is required");
    return;
  }
  const { result, error } = await eng.crawlPage(parsed);
  if (error) {
    writeJSON(res, 200, { error });
    return;
  }
  writeJSON(res, 200, result);
}

async function handleFetchRobots(
  eng: Engine,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  let parsed: RobotsRequest;
  try {
    parsed = JSON.parse(body) as RobotsRequest;
  } catch {
    writeErrorJSON(res, 400, "decodeError", "invalid JSON body");
    return;
  }
  if (!parsed.host) {
    writeErrorJSON(res, 400, "invalidRequest", "host is required");
    return;
  }
  const result = await eng.fetchRobots(parsed);
  writeJSON(res, 200, result);
}

async function handleFetchImage(
  eng: Engine,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  let parsed: { url: string; 'userAgent': string };
  try {
    parsed = JSON.parse(body) as { url: string; 'userAgent': string };
  } catch {
    writeErrorJSON(res, 400, "decodeError", "invalid JSON body");
    return;
  }
  if (!parsed.url) {
    writeErrorJSON(res, 400, "invalidRequest", "url is required");
    return;
  }
  const { result, error } = await eng.fetchImage(parsed.url, parsed.userAgent);
  if (error) {
    writeJSON(res, 200, { error });
    return;
  }
  writeJSON(res, 200, result);
}

function main(): void {
  const eng = new Engine();
  eng.configure(loadConfigFromEnv());

  const listenAddr = process.env["LISTEN_ADDR"] || "0.0.0.0:18240";
  const [host, portStr] = listenAddr.includes(":")
    ? [listenAddr.slice(0, listenAddr.lastIndexOf(":")), listenAddr.slice(listenAddr.lastIndexOf(":") + 1)]
    : ["0.0.0.0", listenAddr];
  const port = parseInt(portStr, 10) || 18240;

  const server = createServer(async (req, res) => {
    const url = req.url || "/";

    // Health endpoint.
    if (url === "/health") {
      res.setHeader("Content-Type", "application/json");
      writeJSON(res, 200, { status: eng.health() });
      return;
    }

    // XRPC-style endpoint.
    if (url.startsWith(GRPC_PREFIX)) {
      if (req.method === "OPTIONS") {
        writeCORS(res);
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end("method not allowed");
        return;
      }
      writeCORS(res);

      const method = url.slice(GRPC_PREFIX.length);
      try {
        switch (method) {
          case "CrawlPage":
            await handleCrawlPage(eng, req, res);
            break;
          case "FetchRobots":
            await handleFetchRobots(eng, req, res);
            break;
          case "FetchImage":
            await handleFetchImage(eng, req, res);
            break;
          case "Health":
            writeJSON(res, 200, { status: eng.health() });
            break;
          default:
            writeErrorJSON(res, 404, "unknownMethod", `unknown method: ${method}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`handler error method=${method}: ${msg}`);
        writeErrorJSON(res, 500, "internalError", msg);
      }
      return;
    }

    // 404 fallback.
    res.writeHead(404);
    res.end("not found");
  });

  server.keepAliveTimeout = 60_000;
  server.headersTimeout = 65_000;

  server.listen(port, host, () => {
    console.log(`starting crawl-engine HTTP server addr=${host}:${port}`);
  });

  // Graceful shutdown.
  const shutdown = (signal: string) => {
    console.log(`received signal ${signal}, shutting down`);
    server.close(() => {
      console.log("crawl-engine stopped");
      process.exit(0);
    });
    // Force exit after 10s.
    setTimeout(() => {
      console.error("forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
