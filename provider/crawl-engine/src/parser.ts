const MAX_PARSER_BODY_BYTES = 64 * 1024;
const MAX_PARSE_LINKS = 800;
const MAX_PARSE_IMAGES = 24;
const MAX_PARSED_TEXT_LENGTH = 2500;

const RE_SCRIPT = /(<script[^>]*>[\s\S]*?<\/script>)/gi;
const RE_STYLE = /(<style[^>]*>[\s\S]*?<\/style>)/gi;
const RE_COMMENT = /(<!--[\s\S]*?-->)/g;
const RE_TAG_STRIP = /<[^>]+>/g;
const RE_MULTI_WS = /\s+/g;

export interface ParseResult {
  title: string;
  links: string[];
  textContent: string;
  ogp: Record<string, string>;
  metadata: Record<string, string>;
  images: string[];
}

/** Extracts structured data from HTML body. */
export function parseHTML(pageURL: string, body: Buffer | string): ParseResult {
  const raw = typeof body === "string" ? body : body.toString("utf8");
  if (!raw) {
    return {
      title: "",
      links: [],
      textContent: "",
      ogp: {},
      metadata: {},
      images: [],
    };
  }

  const s = raw.length > MAX_PARSER_BODY_BYTES ? raw.slice(0, MAX_PARSER_BODY_BYTES) : raw;
  const lower = s.toLowerCase();

  const title = extractTitle(s, lower);
  const rawLinks = extractHrefLinks(s, lower, MAX_PARSE_LINKS);
  const ogp = extractMetaByPrefix(s, lower, "og:");
  const metadata = extractMetaGeneric(s, lower);
  const images = extractImageLinks(pageURL, s, lower, MAX_PARSE_IMAGES);
  const textContent = extractTextContent(s, MAX_PARSED_TEXT_LENGTH);

  // Normalize and deduplicate links.
  const seen = new Set<string>();
  const links: string[] = [];
  for (const l of rawLinks) {
    const abs = normalizeAndResolveLink(pageURL, l);
    if (!abs) continue;
    if (!seen.has(abs)) {
      seen.add(abs);
      links.push(abs);
    }
  }

  return { title, links, textContent, ogp, metadata, images };
}

function extractTitle(html: string, lower: string): string {
  const i = lower.indexOf("<title");
  if (i < 0) return "";
  const j = lower.indexOf(">", i);
  if (j < 0) return "";
  const start = j + 1;
  const k = lower.indexOf("</title>", start);
  if (k < 0) return "";
  return html.slice(start, k).trim();
}

function extractHrefLinks(html: string, lower: string, limit: number): string[] {
  const out: string[] = [];
  let pos = 0;
  while (out.length < limit && pos < lower.length) {
    const i = lower.indexOf("<a", pos);
    if (i < 0) break;
    const end = lower.indexOf(">", i);
    if (end < 0) break;
    const tag = html.slice(i, end + 1);
    pos = end + 1;
    const href = getAttr(tag, "href").trim();
    if (href) {
      out.push(href);
    }
  }
  return out;
}

function extractMetaByPrefix(
  htmlText: string,
  lower: string,
  prefix: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const pfx = prefix.toLowerCase().trim();
  if (!pfx) return out;

  let pos = 0;
  while (true) {
    const i = lower.indexOf("<meta", pos);
    if (i < 0) break;
    const end = lower.indexOf(">", i);
    if (end < 0) break;
    const tag = htmlText.slice(i, end + 1);
    pos = end + 1;

    let prop = getAttr(tag, "property").trim();
    if (!prop) {
      prop = getAttr(tag, "name").trim();
    }
    if (!prop || !prop.toLowerCase().startsWith(pfx)) continue;

    const content = getAttr(tag, "content").trim();
    if (content) {
      out[prop] = content;
    }
  }
  return out;
}

function extractMetaGeneric(htmlText: string, lower: string): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = new Set(["description", "keywords", "author", "viewport", "robots"]);

  let pos = 0;
  while (true) {
    const i = lower.indexOf("<meta", pos);
    if (i < 0) break;
    const end = lower.indexOf(">", i);
    if (end < 0) break;
    const tag = htmlText.slice(i, end + 1);
    pos = end + 1;

    const name = getAttr(tag, "name").trim().toLowerCase();
    if (!name || !keys.has(name)) continue;

    const content = getAttr(tag, "content").trim();
    if (content) {
      out[name] = content;
    }
  }
  return out;
}

function extractImageLinks(
  pageURL: string,
  htmlText: string,
  lower: string,
  limit: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    if (!raw || out.length >= limit) return;
    const abs = normalizeAndResolveLink(pageURL, raw);
    if (!abs || !looksLikeImageURL(abs)) return;
    if (!seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  };

  // OG images.
  for (const v of Object.values(extractMetaByPrefix(htmlText, lower, "og:image"))) {
    add(v);
  }
  for (const v of Object.values(extractMetaByPrefix(htmlText, lower, "twitter:image"))) {
    add(v);
  }

  // <img> tags.
  let pos = 0;
  while (out.length < limit) {
    const i = lower.indexOf("<img", pos);
    if (i < 0) break;
    const end = lower.indexOf(">", i);
    if (end < 0) break;
    const tag = htmlText.slice(i, end + 1);
    pos = end + 1;

    add(getAttr(tag, "src").trim());
    add(getAttr(tag, "data-src").trim());
    add(getAttr(tag, "data-original").trim());
    const srcset = getAttr(tag, "srcset").trim();
    for (const candidate of splitSrcset(srcset)) {
      add(candidate);
    }
  }

  return out;
}

function extractTextContent(html: string, maxLen: number): string {
  let s = html;
  s = s.replace(RE_SCRIPT, "");
  s = s.replace(RE_STYLE, "");
  s = s.replace(RE_COMMENT, "");
  s = s.replace(RE_TAG_STRIP, " ");
  s = s.replace(RE_MULTI_WS, " ");
  s = s.trim();
  if (s.length > maxLen) {
    s = s.slice(0, maxLen);
  }
  return s;
}

function getAttr(tag: string, attr: string): string {
  const lower = tag.toLowerCase();
  const key = attr.toLowerCase() + "=";
  const i = lower.indexOf(key);
  if (i < 0) return "";

  let j = i + key.length;
  // Skip whitespace.
  while (j < tag.length && (tag[j] === " " || tag[j] === "\n" || tag[j] === "\r" || tag[j] === "\t")) {
    j++;
  }
  if (j >= tag.length) return "";

  const quote = tag[j];
  if (quote === '"' || quote === "'") {
    j++;
    let k = j;
    while (k < tag.length && tag[k] !== quote) {
      k++;
    }
    return tag.slice(j, k);
  }

  // Unquoted value: read until space or >.
  let k = j;
  while (k < tag.length && tag[k] !== " " && tag[k] !== ">" && tag[k] !== "\t" && tag[k] !== "\n") {
    k++;
  }
  return tag.slice(j, k);
}

function splitSrcset(srcset: string): string[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function looksLikeImageURL(raw: string): boolean {
  const u = raw.toLowerCase().trim();
  if (!u || u.startsWith("data:")) return false;
  const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"];
  for (const ext of imageExts) {
    if (u.includes(ext)) return true;
  }
  return (
    u.includes("/image") ||
    u.includes("/img") ||
    u.includes("format=") ||
    u.includes("fm=")
  );
}

export function normalizeAndResolveLink(base: string, href: string): string | null {
  href = href.trim();
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("javascript:") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  ) {
    return null;
  }

  try {
    const resolved = new URL(href, base);
    resolved.hash = "";
    const s = resolved.toString();
    if (!s.startsWith("http://") && !s.startsWith("https://")) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}
