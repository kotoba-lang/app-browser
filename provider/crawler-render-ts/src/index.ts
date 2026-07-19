export type RenderRequest = {
  url: string;
  timeoutMs?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  userAgent?: string;
};

export type RenderResult = {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  html: string;
};

export type BrowserRenderingClient = {
  render(req: RenderRequest): Promise<RenderResult>;
};

export class BrowserRenderingAdapter {
  constructor(private readonly client: BrowserRenderingClient) {}

  async render(req: RenderRequest): Promise<RenderResult> {
    return this.client.render({
      waitUntil: "networkidle",
      timeoutMs: 30_000,
      ...req,
    });
  }
}

export class StubBrowserRenderingClient implements BrowserRenderingClient {
  async render(req: RenderRequest): Promise<RenderResult> {
    return {
      url: req.url,
      finalUrl: req.url,
      status: 200,
      title: "stub render",
      html: "<html><head><title>stub render</title></head><body></body></html>",
    };
  }
}
