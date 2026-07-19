import type {
  CrawlPageRequest,
  CrawlPageResult,
  CrawlEngineError,
  RobotsRequest,
  RobotsResult,
  ImageBinary,
} from "./types.js";
import { FetchMode } from "./types.js";
import { parseHTML } from "./parser.js";
import { isAntiBotHTTPStatus, isAntiBotTitle, isAntiBotContent } from "./antibot.js";
import { contentFingerprints } from "./fingerprint.js";
import { fetchStatic } from "./fetcher.js";
import { fetchRendered } from "./renderer.js";
import { fetchImageBinary } from "./images.js";
import { fetchRobotsPolicy } from "./robots.js";
import { classifyWithLaser } from "./laser.js";

const DEFAULT_USER_AGENT = "etzhayyim-crawler/1.0";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_MAX_IMAGES = 12;

export class Engine {
  browserlessURL: string;
  laserBaseURL: string;

  constructor() {
    this.browserlessURL =
      "http://etzhayyim-browserless.spinkube.svc.cluster.local:8080";
    this.laserBaseURL =
      "http://laser.ml-inference.svc.cluster.local:8080";
  }

  /** Applies configuration from environment. */
  configure(config: Record<string, string>): void {
    if (config["BROWSERLESS_URL"]) {
      this.browserlessURL = config["BROWSERLESS_URL"];
    }
    if (config["LASER_BASE_URL"]) {
      this.laserBaseURL = config["LASER_BASE_URL"];
    }
    console.log(
      `engine configured browserlessUrl=${this.browserlessURL} laserBaseUrl=${this.laserBaseURL}`,
    );
  }

  /** Returns the provider health status string. */
  health(): string {
    return "crawl-engine healthy";
  }

  /**
   * CrawlPage executes the unified crawl pipeline:
   * 1. Fetch page (static or render, with auto anti-bot fallback)
   * 2. Parse HTML (title, links, OGP, metadata, images, text)
   * 3. Fetch image binaries (if requested)
   * 4. Compute content fingerprints (if requested)
   * 5. LASER topic classification (if requested)
   */
  async crawlPage(
    req: CrawlPageRequest,
  ): Promise<{ result?: CrawlPageResult; error?: CrawlEngineError }> {
    const start = Date.now();

    const ua = req.userAgent || DEFAULT_USER_AGENT;
    const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.'timeoutMs': DEFAULT_TIMEOUT_MS;
    const maxBody =
      req.maxBodyBytes && req.maxBodyBytes > 0
        ? req.'maxBodyBytes': DEFAULT_MAX_BODY_BYTES;

    // Step 1: Fetch page.
    const mode = req.fetchMode;
    let body: Buffer;
    let finalURL: string;
    let httpStatus: number;
    let headers: Record<string, string>;
    let wasRendered = false;

    try {
      if (mode === FetchMode.Render) {
        const r = await fetchRendered(this.browserlessURL, req.url, ua, timeoutMs);
        body = r.body;
        finalURL = r.finalURL;
        httpStatus = r.httpStatus;
        headers = r.headers;
        wasRendered = true;
      } else if (mode === FetchMode.Auto) {
        // Auto mode: try static first.
        const r = await fetchStatic(req.url, ua, maxBody, timeoutMs);
        body = r.body;
        finalURL = r.finalURL;
        httpStatus = r.httpStatus;
        headers = r.headers;

        // Check for anti-bot — fallback to render.
        if (
          isAntiBotHTTPStatus(httpStatus) ||
          isAntiBotContent(body.toString("utf8"))
        ) {
          console.warn(
            `anti-bot detected, falling back to render url=${req.url} status=${httpStatus}`,
          );
          try {
            const rr = await fetchRendered(this.browserlessURL, req.url, ua, timeoutMs);
            body = rr.body;
            finalURL = rr.finalURL;
            httpStatus = rr.httpStatus;
            headers = rr.headers;
            wasRendered = true;
          } catch {
            // If render also fails, use static result.
          }
        }
      } else {
        // Standard/static mode.
        const r = await fetchStatic(req.url, ua, maxBody, timeoutMs);
        body = r.body;
        finalURL = r.finalURL;
        httpStatus = r.httpStatus;
        headers = r.headers;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = mode === FetchMode.Render ? "renderFailed" : "fetchFailed";
      return {
        error: { url: req.url, code, message: msg },
      };
    }

    // Step 2: Parse HTML.
    const parsed = parseHTML(req.url, body);

    // Step 3: Anti-bot detection on parsed content.
    const antiBotDetected =
      isAntiBotHTTPStatus(httpStatus) ||
      isAntiBotTitle(parsed.title) ||
      isAntiBotContent(parsed.textContent);

    // Step 4: Fetch image binaries.
    const imageBinaries: ImageBinary[] = [];
    if (req.fetchImages && parsed.images.length > 0) {
      const maxImg =
        req.maxImages && req.maxImages > 0 ? req.'maxImages': DEFAULT_MAX_IMAGES;
      const limit = Math.min(maxImg, parsed.images.length);
      for (let i = 0; i < limit; i++) {
        try {
          const img = await fetchImageBinary(parsed.images[i], ua, timeoutMs);
          imageBinaries.push(img);
        } catch {
          // skip failed images
        }
      }
    }

    // Step 5: Content fingerprints.
    let contentHash: string | undefined;
    let simHash: string | undefined;
    if (req.computeFingerprints) {
      const [hash, sim] = contentFingerprints(parsed.title, parsed.textContent);
      if (hash) {
        contentHash = hash;
        simHash = sim;
      }
    }

    // Step 6: LASER topic classification.
    let classificationsJSON: string | undefined;
    if (req.classifyTopics) {
      try {
        const cls = await classifyWithLaser(
          this.laserBaseURL,
          parsed.textContent,
          req.laserLabelsJson,
          req.laserTopK,
        );
        if (cls) {
          classificationsJSON = cls;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`laser classification failed url=${req.url} error=${msg}`);
      }
    }

    const elapsed = Date.now() - start;

    return {
      result: {
        url: req.url,
        'finalUrl': finalURL,
        'httpStatus': httpStatus,
        title: parsed.title || undefined,
        'textContent': parsed.textContent || undefined,
        links: parsed.links,
        'linkCount': parsed.links.length,
        'sizeBytes': body.length,
        'headersJson': JSON.stringify(headers || {}),
        'ogpJson': JSON.stringify(parsed.ogp || {}),
        'metadataJson': JSON.stringify(parsed.metadata || {}),
        'imageUrls': parsed.images,
        'imageBinaries': imageBinaries,
        'contentHash': contentHash,
        'simHash': simHash,
        'antiBotDetected': antiBotDetected,
        'classificationsJson': classificationsJSON,
        'wasRendered': wasRendered,
        'elapsedMs': elapsed,
      },
    };
  }

  /** Fetches and parses robots.txt for a host. */
  async fetchRobots(req: RobotsRequest): Promise<RobotsResult> {
    return fetchRobotsPolicy(req.host, req.userAgent);
  }

  /** Fetches a single image binary. */
  async fetchImage(
    url: string,
    userAgent: string,
  ): Promise<{ result?: ImageBinary; error?: CrawlEngineError }> {
    const ua = userAgent || DEFAULT_USER_AGENT;
    try {
      const img = await fetchImageBinary(url, ua);
      return { result: img };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        error: { url, code: "fetchImageFailed", message: msg },
      };
    }
  }
}
