interface BrowserlessRequest {
  url: string;
  waitUntil?: string;
  timeout?: number;
  bestAttempt?: boolean;
}

/**
 * Uses the browserless service to render a page with a headless browser.
 * Returns the rendered HTML body and metadata.
 */
export async function fetchRendered(
  browserlessURL: string,
  rawURL: string,
  userAgent: string,
  timeoutMs: number,
): Promise<{
  body: Buffer;
  finalURL: string;
  httpStatus: number;
  headers: Record<string, string>;
}> {
  if (!browserlessURL) {
    throw new Error("browserless URL not configured");
  }

  const reqBody: BrowserlessRequest = {
    url: rawURL,
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
    bestAttempt: true,
  };

  const endpoint = browserlessURL + "/content";
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userAgent ? { "User-Agent": userAgent } : {}),
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(timeoutMs + 5000),
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`browserless returned status ${resp.status}`);
  }

  const MAX_RENDERED_BODY = 4 * 1024 * 1024;
  const arrayBuf = await resp.arrayBuffer();
  let body = Buffer.from(arrayBuf);
  if (body.length > MAX_RENDERED_BODY) {
    body = body.subarray(0, MAX_RENDERED_BODY);
  }

  return {
    body,
    finalURL: rawURL,
    httpStatus: 200,
    headers: {
      "Content-Type": "text/html",
      "X-Rendered-By": "browserless",
      "X-Original-URL": rawURL,
    },
  };
}
