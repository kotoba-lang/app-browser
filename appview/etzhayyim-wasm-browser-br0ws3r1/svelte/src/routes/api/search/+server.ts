import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env as Record<string, string> | undefined;
  const agentUrl = env?.BROWSER_AGENT_URL ?? 'https://browser-agent.etzhayyim.ai';

  const body = await request.json();

  const upstream = await fetch(`${agentUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `upstream ${upstream.status}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
};
