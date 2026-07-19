/**
 * darkweb-proxy — Tor + Playwright HTTP fetch proxy for onion.etzhayyim.com
 *
 * POST /fetch   { url: string, timeout?: number }
 *   → { statusCode, html, title, outboundLinks[], screenshotBase64?, error?, reachable }
 * GET  /health  → { status: "ok" }
 *
 * Env:
 *   TOR_PROXY          SOCKS5 Tor address  (default: socks5://127.0.0.1:9050)
 *   PORT               HTTP listen port     (default: 8080)
 *   MAX_CONCURRENCY    parallel slots       (default: 2)
 *   NAV_TIMEOUT_MS     page navigation ms   (default: 45000)
 *   SCREENSHOT         "1" to capture PNG   (default: "0")
 *
 * Only .onion URLs are accepted — all other hosts are rejected with 403.
 */

import Fastify from "fastify";
import { chromium, type Browser } from "playwright";

// ─── Config ──────────────────────────────────────────────────────────────────

function envInt(name: string, def: number): number {
  const n = Number(process.env[name] ?? "");
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

const PORT = envInt("PORT", 8080);
const MAX_CONCURRENCY = envInt("MAX_CONCURRENCY", 2);
const NAV_TIMEOUT_MS = envInt("NAV_TIMEOUT_MS", 45_000);
const SCREENSHOT_ENABLED = (process.env.SCREENSHOT ?? "0") === "1";
const TOR_PROXY = (process.env.TOR_PROXY ?? "socks5://127.0.0.1:9050").trim();
const MAX_LINKS = 150;

// ─── Types ───────────────────────────────────────────────────────────────────

interface FetchRequest {
  url: string;
  timeout?: number;
}

interface FetchResponse {
  reachable: boolean;
  statusCode?: number;
  html?: string;
  title?: string;
  outboundLinks?: string[];
  screenshotBase64?: string;
  error?: string;
}

// ─── Semaphore ────────────────────────────────────────────────────────────────

class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return () => this.release();
    }
    await new Promise<void>(r => this.queue.push(r));
    this.current++;
    return () => this.release();
  }

  private release() {
    this.current = Math.max(0, this.current - 1);
    this.queue.shift()?.();
  }
}

// ─── Browser singleton (Tor-routed) ──────────────────────────────────────────

const STEALTH_ARGS = [
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
];

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      timeout: 60_000,
      proxy: { server: TOR_PROXY },
      args: STEALTH_ARGS,
    });
  }
  return browserPromise;
}

// ─── Link extraction helper ───────────────────────────────────────────────────

function extractOnionLinks(html: string, baseHost: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  // Match href attributes containing .onion
  const re = /href=["']([^"']*\.onion[^"']*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < MAX_LINKS) {
    const raw = m[1];
    try {
      const url = new URL(raw, `http://${baseHost}`);
      if (url.hostname.endsWith(".onion") && !seen.has(url.href)) {
        seen.add(url.href);
        results.push(url.href);
      }
    } catch {
      // ignore malformed
    }
  }
  return results;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const sem = new Semaphore(MAX_CONCURRENCY);
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });

app.get("/health", async () => ({ status: "ok", torProxy: TOR_PROXY }));

app.post<{ Body: FetchRequest; Reply: FetchResponse }>(
  "/fetch",
  async (req, reply) => {
    const target = (req.body?.url ?? "").trim();
    if (!target) {
      reply.code(400);
      return { reachable: false, error: "url required" };
    }

    // Security: only .onion URLs accepted
    let hostname: string;
    try {
      hostname = new URL(target).hostname;
    } catch {
      reply.code(400);
      return { reachable: false, error: "invalid url" };
    }
    if (!hostname.endsWith(".onion")) {
      reply.code(403);
      return { reachable: false, error: "only .onion URLs are accepted" };
    }

    const timeout = Math.min(
      Math.max(req.body?.timeout ?? NAV_TIMEOUT_MS, 5_000),
      120_000,
    );

    const release = await sem.acquire();
    let ctx = null;
    try {
      const browser = await getBrowser();
      ctx = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        timezoneId: "UTC",
        ignoreHTTPSErrors: true,
      });
      const page = await ctx.newPage();
      page.setDefaultNavigationTimeout(timeout);

      // Minimal stealth
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      let statusCode = 0;
      try {
        const resp = await page.goto(target, { waitUntil: "domcontentloaded" });
        statusCode = resp?.status() ?? 0;
      } catch (navErr) {
        return {
          reachable: false,
          error: `navigation failed: ${String(navErr).slice(0, 200)}`,
        };
      }

      const html = await page.content();
      const title = await page.title();
      const outboundLinks = extractOnionLinks(html, hostname);

      let screenshotBase64: string | undefined;
      if (SCREENSHOT_ENABLED) {
        const buf = await page.screenshot({ type: "png", fullPage: false });
        screenshotBase64 = buf.toString("base64");
      }

      return {
        reachable: true,
        statusCode,
        html,
        title,
        outboundLinks,
        ...(screenshotBase64 ? { screenshotBase64 } : {}),
      };
    } catch (e) {
      req.log.error({ err: e }, "fetch failed");
      reply.code(502);
      return { reachable: false, error: `fetch failed: ${String(e).slice(0, 200)}` };
    } finally {
      try { await ctx?.close(); } catch { /* ignore */ }
      release();
    }
  },
);

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`darkweb-proxy listening on :${PORT} tor=${TOR_PROXY}`);
