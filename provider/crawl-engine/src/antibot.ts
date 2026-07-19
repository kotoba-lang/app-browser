/** Anti-bot title markers. */
const ANTI_BOT_TITLE_MARKERS = [
  "just a moment",
  "attention required",
  "cloudflare",
  "ddos-guard",
  "access denied",
  "are you a robot",
  "captcha",
  "bot detection",
  "security check",
  "verify you are human",
];

/** Anti-bot body markers. */
const ANTI_BOT_BODY_MARKERS = [
  "cf-browser-verification",
  "challenge-platform",
  "turnstile",
];

/** Checks if the HTTP status code indicates anti-bot protection. */
export function isAntiBotHTTPStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 503;
}

/** Checks if the page title indicates anti-bot protection. */
export function isAntiBotTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return ANTI_BOT_TITLE_MARKERS.some((marker) => lower.includes(marker));
}

/** Checks if the page content indicates anti-bot protection. */
export function isAntiBotContent(text: string): boolean {
  const lower = text.toLowerCase();
  return ANTI_BOT_BODY_MARKERS.some((marker) => lower.includes(marker));
}
