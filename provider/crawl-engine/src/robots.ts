import type { RobotsResult } from "./types.js";

const RE_ROBOTS_UA = /^user-agent:\s*(.+)$/i;
const RE_ROBOTS_ALLOW = /^allow:\s*(.+)$/i;
const RE_ROBOTS_DISALLOW = /^disallow:\s*(.+)$/i;
const RE_ROBOTS_DELAY = /^crawl-delay:\s*(\d+)$/i;

interface RobotsRule {
  path: string;
  allow: boolean;
}

interface RobotsBlock {
  ua: string;
  rules: RobotsRule[];
  delay: number;
  score: number;
}

const DEFAULT_USER_AGENT = "etzhayyim-crawler/1.0";
const MAX_ROBOTS_BODY = 1024 * 1024;

/** Fetches and parses robots.txt from a host. */
export async function fetchRobotsPolicy(
  host: string,
  userAgent: string,
): Promise<RobotsResult> {
  const result: RobotsResult = {
    loaded: true,
    'allowAll': false,
    'disallowAll': false,
    'rulesJson': "[]",
    'crawlDelaySec': 0,
  };

  if (!host) return result;

  let scheme = "https";
  let hostname = host;
  if (host.startsWith("http://") || host.startsWith("https://")) {
    const idx = host.indexOf("://");
    scheme = host.slice(0, idx);
    hostname = host.slice(idx + 3);
  }

  const robotsURL = `${scheme}://${hostname}/robots.txt`;
  const ua = userAgent || DEFAULT_USER_AGENT;

  try {
    const resp = await fetch(robotsURL, {
      headers: { "User-Agent": ua },
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.status < 200 || resp.status >= 300) {
      return result;
    }

    const bodyBuf = await resp.arrayBuffer();
    const body = new TextDecoder().decode(bodyBuf.slice(0, MAX_ROBOTS_BODY));
    parseRobotsBody(result, body, ua);
  } catch {
    // Network error — return default result.
  }

  return result;
}

function parseRobotsBody(result: RobotsResult, body: string, userAgent: string): void {
  const lines = body.split("\n");

  const blocks: RobotsBlock[] = [];
  let current: RobotsBlock | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const uaMatch = RE_ROBOTS_UA.exec(line);
    if (uaMatch) {
      const ua = uaMatch[1].trim();
      const block: RobotsBlock = { ua, rules: [], delay: 0, score: 0 };
      blocks.push(block);
      current = block;
      continue;
    }

    if (!current) continue;

    const allowMatch = RE_ROBOTS_ALLOW.exec(line);
    if (allowMatch) {
      current.rules.push({ path: allowMatch[1].trim(), allow: true });
      continue;
    }

    const disallowMatch = RE_ROBOTS_DISALLOW.exec(line);
    if (disallowMatch) {
      current.rules.push({ path: disallowMatch[1].trim(), allow: false });
      continue;
    }

    const delayMatch = RE_ROBOTS_DELAY.exec(line);
    if (delayMatch) {
      current.delay = parseInt(delayMatch[1], 10) || 0;
    }
  }

  // Score blocks by user-agent match.
  const uaLower = userAgent.toLowerCase();
  let bestBlock: RobotsBlock | null = null;
  let bestScore = -1;

  for (const block of blocks) {
    block.score = robotsMatchScore(block.ua, uaLower);
    if (block.score > bestScore) {
      bestScore = block.score;
      bestBlock = block;
    }
  }

  if (!bestBlock || bestBlock.rules.length === 0) {
    result.allowAll = true;
    return;
  }

  let allDisallow = true;
  let allAllow = true;
  for (const rule of bestBlock.rules) {
    if (rule.allow) allDisallow = false;
    else allAllow = false;
  }

  // Special case: single "Disallow: /" means disallow all.
  if (
    bestBlock.rules.length === 1 &&
    !bestBlock.rules[0].allow &&
    bestBlock.rules[0].path === "/"
  ) {
    result.disallowAll = true;
  } else {
    result.allowAll = allAllow;
    result.disallowAll = allDisallow && !allAllow;
  }

  result.crawlDelaySec = bestBlock.delay;

  try {
    result.rulesJson = JSON.stringify(bestBlock.rules);
  } catch {
    // keep default
  }
}

function robotsMatchScore(ua: string, targetUA: string): number {
  const uaLower = ua.toLowerCase().trim();
  if (uaLower === "*") return 1;
  if (uaLower === targetUA) return 100;
  if (targetUA.includes(uaLower)) return 50 + uaLower.length;
  if (uaLower.includes(targetUA)) return 10;
  return 0;
}
