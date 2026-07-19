/**
 * crawl-engine robots.txt tests (coverage loop iteration 5).
 *
 * robots compliance is the crawler's politeness/ethics core. fetchRobotsPolicy
 * parses robots.txt and picks the best-matching user-agent block. These drive
 * the full parse path through a stubbed global fetch — no network.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchRobotsPolicy } from "../src/robots.js";

const UA = "etzhayyim-crawler/1.0";

function stubRobots(body: string, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(body, { status }),
  ));
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchRobotsPolicy", () => {
  it("treats an empty host as allow-nothing-known (default result, no fetch)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchRobotsPolicy("", UA);
    expect(spy).not.toHaveBeenCalled();
    expect(r.loaded).toBe(true);
    expect(r.allowAll).toBe(false);
  });

  it("requests https://<host>/robots.txt with the user-agent header", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchRobotsPolicy("example.com", UA);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://example.com/robots.txt");
    expect((init as RequestInit).headers).toMatchObject({ "User-Agent": UA });
  });

  it("preserves an explicit scheme on the host", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchRobotsPolicy("http://insecure.test", UA);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://insecure.test/robots.txt");
  });

  it("fails open (allowAll false default) on a non-2xx response", async () => {
    stubRobots("Disallow: /", 404);
    const r = await fetchRobotsPolicy("example.com", UA);
    expect(r.disallowAll).toBe(false);
    expect(r.allowAll).toBe(false);
  });

  it("fails open on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const r = await fetchRobotsPolicy("example.com", UA);
    expect(r.loaded).toBe(true);
    expect(r.disallowAll).toBe(false);
  });

  it("a lone 'Disallow: /' for * means disallowAll", async () => {
    stubRobots("User-agent: *\nDisallow: /");
    const r = await fetchRobotsPolicy("example.com", UA);
    expect(r.disallowAll).toBe(true);
    expect(r.allowAll).toBe(false);
  });

  it("an empty/rules-less block means allowAll", async () => {
    stubRobots("User-agent: *\nCrawl-delay: 5");
    const r = await fetchRobotsPolicy("example.com", UA);
    expect(r.allowAll).toBe(true);
  });

  it("captures crawl-delay and the matched block's rules JSON", async () => {
    stubRobots([
      "User-agent: *",
      "Disallow: /private",
      "Allow: /private/public",
      "Crawl-delay: 7",
    ].join("\n"));
    const r = await fetchRobotsPolicy("example.com", UA);
    expect(r.crawlDelaySec).toBe(7);
    const rules = JSON.parse(r.rulesJson) as { path: string; allow: boolean }[];
    expect(rules).toEqual([
      { path: "/private", allow: false },
      { path: "/private/public", allow: true },
    ]);
    expect(r.disallowAll).toBe(false);
    expect(r.allowAll).toBe(false);
  });

  it("prefers a UA-specific block over the wildcard block", async () => {
    stubRobots([
      "User-agent: *",
      "Disallow: /",
      "User-agent: etzhayyim-crawler/1.0",
      "Allow: /",
      "Crawl-delay: 2",
    ].join("\n"));
    const r = await fetchRobotsPolicy("example.com", UA);
    // the specific block (Allow: /) wins over the wildcard Disallow: /
    expect(r.disallowAll).toBe(false);
    expect(r.crawlDelaySec).toBe(2);
  });

  it("ignores comments and blank lines, and rules before any user-agent", async () => {
    stubRobots([
      "# a comment",
      "Disallow: /orphan",      // no current block — ignored
      "",
      "User-agent: *",
      "Disallow: /real",
    ].join("\n"));
    const r = await fetchRobotsPolicy("example.com", UA);
    const rules = JSON.parse(r.rulesJson) as { path: string }[];
    expect(rules.map((x) => x.path)).toEqual(["/real"]);
  });
});
