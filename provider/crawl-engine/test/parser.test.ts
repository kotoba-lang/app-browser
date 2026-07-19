/**
 * crawl-engine parser tests (coverage loop iteration 5).
 *
 * parseHTML + normalizeAndResolveLink are pure extraction logic (285 LoC)
 * with zero tests. These pin the link-normalization safety rules (no
 * javascript:/mailto:/fragment leakage, absolute-only output) and the
 * structured-data extraction the crawler depends on.
 */
import { describe, it, expect } from "vitest";
import { parseHTML, normalizeAndResolveLink } from "../src/parser.js";

const BASE = "https://example.com/dir/page.html";

describe("normalizeAndResolveLink", () => {
  it("resolves relative paths against the base and strips fragments", () => {
    expect(normalizeAndResolveLink(BASE, "../other")).toBe("https://example.com/other");
    expect(normalizeAndResolveLink(BASE, "/abs?q=1#frag")).toBe("https://example.com/abs?q=1");
    expect(normalizeAndResolveLink(BASE, "https://x.test/p")).toBe("https://x.test/p");
  });

  it("rejects non-navigational and non-http schemes", () => {
    for (const bad of ["", "#top", "javascript:alert(1)", "mailto:a@b.c", "tel:123", "ftp://x/y"]) {
      expect(normalizeAndResolveLink(BASE, bad)).toBeNull();
    }
  });

  it("returns null on an unparseable href", () => {
    expect(normalizeAndResolveLink("not a base", "also not")).toBeNull();
  });
});

describe("parseHTML", () => {
  it("returns empty result for empty body", () => {
    const r = parseHTML(BASE, "");
    expect(r).toEqual({ title: "", links: [], textContent: "", ogp: {}, metadata: {}, images: [] });
  });

  it("extracts title, dedupes + absolutizes links, and drops unsafe hrefs", () => {
    const html = `
      <title>  Hello World  </title>
      <a href="/a">A</a>
      <a href="/a">A again (dup)</a>
      <a href="../b">B</a>
      <a href="javascript:void(0)">bad</a>
      <a href="https://ext.test/c">C</a>`;
    const r = parseHTML(BASE, html);
    expect(r.title).toBe("Hello World");
    expect(r.links).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://ext.test/c",
    ]);
  });

  it("extracts OGP, generic metadata, and ignores non-allowlisted meta names", () => {
    const html = `
      <meta property="og:title" content="OG Title">
      <meta property="og:image" content="https://example.com/og.png">
      <meta name="description" content="a description">
      <meta name="author" content="alice">
      <meta name="totally-custom" content="ignored">`;
    const r = parseHTML(BASE, html);
    expect(r.ogp["og:title"]).toBe("OG Title");
    expect(r.metadata).toEqual({ description: "a description", author: "alice" });
    expect(r.metadata["totally-custom"]).toBeUndefined();
  });

  it("collects image URLs from og:image, twitter:image, src/srcset; skips data: URIs", () => {
    const html = `
      <meta property="og:image" content="/hero.jpg">
      <meta name="twitter:image" content="https://cdn.test/t.png">
      <img src="/photo.webp">
      <img src="data:image/png;base64,AAAA">
      <img srcset="/small.jpg 1x, /large.jpg 2x">
      <img src="/not-an-image.html">`;
    const r = parseHTML(BASE, html);
    expect(r.images).toContain("https://example.com/hero.jpg");
    expect(r.images).toContain("https://cdn.test/t.png");
    expect(r.images).toContain("https://example.com/photo.webp");
    expect(r.images).toContain("https://example.com/small.jpg");
    expect(r.images).toContain("https://example.com/large.jpg");
    expect(r.images.some((u) => u.startsWith("data:"))).toBe(false);
    expect(r.images).not.toContain("https://example.com/not-an-image.html");
  });

  it("strips scripts/styles/comments/tags from textContent", () => {
    const html = `
      <style>.x{color:red}</style>
      <script>alert('no')</script>
      <!-- a comment -->
      <p>Visible <b>text</b> here</p>`;
    const r = parseHTML(BASE, html);
    expect(r.textContent).toContain("Visible");
    expect(r.textContent).toContain("text");
    expect(r.textContent).not.toContain("color:red");
    expect(r.textContent).not.toContain("alert");
    expect(r.textContent).not.toContain("a comment");
    expect(r.textContent).not.toMatch(/[<>]/);
  });

  it("accepts a Buffer body and handles single-quoted attributes", () => {
    const r = parseHTML(BASE, Buffer.from("<title>Buf</title><a href='/q'>q</a>", "utf8"));
    expect(r.title).toBe("Buf");
    expect(r.links).toEqual(["https://example.com/q"]);
  });
});
