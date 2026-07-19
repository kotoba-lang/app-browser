import { readFileSync, writeFileSync } from 'node:fs';

const workerPath = '.svelte-kit/cloudflare/_worker.js';
const marker = 'class DarkwebProxy';
const compatExport = `

export class DarkwebProxy {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return new Response(
      JSON.stringify({
        error: 'DarkwebProxy has moved behind the agentgateway MCP router',
        router: this.env?.AGENTGATEWAY_MCP_ROUTER_URL ?? null
      }),
      {
        status: 410,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store'
        }
      }
    );
  }

  async alarm() {}
}
`;

const worker = readFileSync(workerPath, 'utf8');
if (!worker.includes(marker)) {
  writeFileSync(workerPath, `${worker.trimEnd()}${compatExport}`);
}
