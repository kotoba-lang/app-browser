import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env as Record<string, string> | undefined;
  const browserlessUrl = env?.BROWSERLESS_URL ?? 'https://browserless.etzhayyim.ai';

  const { url, waitUntil = 'domcontentloaded' } = await request.json<{ url: string; waitUntil?: string }>();
  if (!url) {
    return new Response(JSON.stringify({ error: 'url required' }), { status: 400 });
  }

  const upstream = await fetch(`${browserlessUrl}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, waitUntil, timeoutMs: 15000 })
  });

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' }
  });
};
