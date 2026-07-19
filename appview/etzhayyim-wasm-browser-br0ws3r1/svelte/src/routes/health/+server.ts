import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
  new Response(JSON.stringify({ ok: true, app: 'etzhayyim-wasm-browser-br0ws3r1' }), {
    headers: { 'Content-Type': 'application/json' }
  });
