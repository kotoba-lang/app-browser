/**
 * darkweb-proxy — CF Container companion Worker
 *
 * Exposes darkweb-proxy.etzhayyim.com/* routing to the Container instance.
 * The Container runs Tor + Playwright (Fastify on :8080).
 *
 * Usage from onion Worker:
 *   fetch("https://darkweb-proxy.etzhayyim.com/fetch", { method: "POST", ... })
 *   fetch("https://darkweb-proxy.etzhayyim.com/health")
 */

import { Container } from "@cloudflare/containers";

export class DarkwebProxy extends Container {
  // Port the container process listens on
  defaultPort = 8080;
  // Keep the container warm for 24h to avoid cold-start Tor bootstrap (~40s)
  sleepAfter = "24h";
}

interface Env {
  DARKWEB_PROXY: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single singleton instance — Tor circuit is shared across requests
    const instance = (env.DARKWEB_PROXY as any).getByName("singleton");
    return instance.fetch(request);
  },
} satisfies ExportedHandler<Env>;
