// Run an outside agent against a shared app over MCP.
// Usage: META_API_KEY=... node scripts/mcp_agent.mjs http://127.0.0.1:8787/mcp/<appId> <token> "message"

import { runMcpAgent } from '../src/demo/mcpclient.js';

const [url, token, ...rest] = process.argv.slice(2);
if (!url || !token || !rest.length) {
  console.error('usage: node scripts/mcp_agent.mjs <mcp url> <token> "message"');
  process.exit(2);
}
const r = await runMcpAgent({ url, token, message: rest.join(' ') });
for (const w of r.wire) console.log('→', w.method, w.params ? JSON.stringify(w.params) : '', '\n ', JSON.stringify(w.result));
console.log('\n' + r.message);
console.log(`(${(r.ms / 1000).toFixed(1)}s, ${r.usage.input + r.usage.output} tokens)`);
