import Fastify from "fastify";
import { chromium, type Browser } from "playwright";

type WaitUntil = "load" | "domcontentloaded" | "networkidle";

type ContentRequest = {
  url: string;
  waitUntil?: WaitUntil;
  timeoutMs?: number;
  userAgent?: string;
  useTor?: boolean;
};

type ContentResponse = {
  status: number;
  url: string;
  'finalUrl': string;
  title: string;
  content: string;
};

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseAllowHosts(): Set<string> | null {
  const raw = (process.env.ALLOW_HOSTS ?? "").trim();
  if (!raw) return null;
  const s = new Set<string>();
  for (const part of raw.split(",")) {
    const host = part.trim().toLowerCase();
    if (host) s.add(host);
  }
  return s.size > 0 ? s : null;
}

function hostnameFromURL(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

class Semaphore {
  private readonly max: number;
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    this.max = Math.max(1, Math.trunc(max));
  }

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.current++;
    return () => this.release();
  }

  private release() {
    this.current = Math.max(0, this.current - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const PORT = envInt("PORT", 8080);
const MAX_CONCURRENCY = envInt("MAX_CONCURRENCY", 2);
const CHROME_LAUNCH_TIMEOUT_MS = envInt("CHROME_LAUNCH_TIMEOUT_MS", 30_000);
const NAV_TIMEOUT_MS = envInt("NAV_TIMEOUT_MS", 15_000);
const allowHosts = parseAllowHosts();
const sem = new Semaphore(MAX_CONCURRENCY);
const TOR_PROXY = (process.env.TOR_PROXY ?? "").trim();

let browserPromise: Promise<Browser> | null = null;
let torBrowserPromise: Promise<Browser> | null = null;

const STEALTH_ARGS = [
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
];

async function getBrowser(useTor: boolean): Promise<Browser> {
  if (!useTor) {
    if (!browserPromise) {
      browserPromise = chromium.launch({
        headless: true,
        timeout: CHROME_LAUNCH_TIMEOUT_MS,
        args: STEALTH_ARGS,
      });
    }
    return browserPromise;
  }

  if (!TOR_PROXY) {
    throw new Error("TOR_PROXY is not set");
  }
  if (!torBrowserPromise) {
    torBrowserPromise = chromium.launch({
      headless: true,
      timeout: CHROME_LAUNCH_TIMEOUT_MS,
      proxy: { server: TOR_PROXY },
      args: STEALTH_ARGS,
    });
  }
  return torBrowserPromise;
}

const app = Fastify({
  logger: true,
  bodyLimit: 2 * 1024 * 1024
});

app.get("/health", async () => ({ status: "ok" }));

app.post<{ Body: ContentRequest; Reply: ContentResponse | { error: string } }>("/content", async (req, reply) => {
  const body = req.body ?? ({} as ContentRequest);
  const target = (body.url ?? "").trim();
  if (!target) {
    reply.code(400);
    return { error: "url is required" };
  }
  const host = hostnameFromURL(target);
  if (!host) {
    reply.code(400);
    return { error: "invalid url" };
  }
  const isOnion = host.endsWith(".onion");
  if (isOnion && !allowHosts) {
    reply.code(403);
    return { error: "onion requires ALLOW_HOSTS allowlist" };
  }
  if (allowHosts && !allowHosts.has(host)) {
    reply.code(403);
    return { error: "host not allowed" };
  }

  const release = await sem.acquire();
  try {
    const useTor = Boolean(body.useTor) || isOnion;
    const b = await getBrowser(useTor);
    const ctx = await b.newContext({
      userAgent: body.userAgent?.trim() || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(body.timeoutMs ?? NAV_TIMEOUT_MS);

    // Stealth patches — hide automation signals from anti-bot systems.
    await page.addInitScript(() => {
      // Hide webdriver flag
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // Fake plugins array
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      // Fake languages
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      // Remove Playwright-injected cdc_ properties
      const origDesc = Object.getOwnPropertyDescriptor;
      if (origDesc) {
        // @ts-ignore
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
      }
      // Notification permission
      const origQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (params: any) =>
        params.name === "notifications"
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : origQuery(params);
    });

    const waitUntil: WaitUntil = body.waitUntil ?? "networkidle";
    const navResp = await page.goto(target, { waitUntil });

    const content = await page.content();
    const title = await page.title();
    const finalUrl = page.url();
    const status = navResp?.status() ?? 0;

    await page.close();
    await ctx.close();

    return {
      status,
      url: target,
      'finalUrl': finalUrl,
      title,
      content
    };
  } catch (e: any) {
    req.log.error({ err: e }, "render failed");
    reply.code(502);
    return { error: "render failed" };
  } finally {
    release();
  }
});

await app.listen({ port: PORT, host: "0.0.0.0" });
