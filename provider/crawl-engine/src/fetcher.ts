const DEFAULT_USER_AGENT = "etzhayyim-crawler/1.0";

/** Performs a standard HTTP GET with body limit. */
export async function fetchStatic(
  rawURL: string,
  userAgent: string,
  maxBodyBytes: number,
  timeoutMs: number,
): Promise<{
  body: Buffer;
  finalURL: string;
  httpStatus: number;
  headers: Record<string, string>;
}> {
  const resp = await fetch(rawURL, {
    method: "GET",
    headers: {
      "User-Agent": userAgent || DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });

  const httpStatus = resp.status;
  const finalURL = resp.url || rawURL;

  // Collect headers.
  const headers: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Read body with limit.
  const arrayBuf = await resp.arrayBuffer();
  let body = Buffer.from(arrayBuf);
  if (body.length > maxBodyBytes) {
    body = body.subarray(0, maxBodyBytes);
  }

  return { body, finalURL, httpStatus, headers };
}
