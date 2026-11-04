// An outside agent that knows nothing about the app except its MCP address and
// one person's token. It discovers the tools over MCP, lets Muse Spark 1.3 pick
// calls, and sends every call back over MCP. This is how an invited person's
// own agent (a Muse custom connector, Muse Code, or any MCP client) works in
// the shared app.

import { respond, toolResultItems } from '../meta.js';

async function rpc(url, token, id, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  });
  if (res.status === 202) return null;
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result;
}

export async function runMcpAgent({ url, token, message, today = new Date().toISOString().slice(0, 10) }) {
  const started = Date.now();
  const wire = [];
  let n = 1;
  const call = async (method, params) => {
    const result = await rpc(url, token, n++, method, params);
    wire.push({ method, params: params || null, result: summarizeResult(method, result) });
    return result;
  };

  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'outside-agent', version: '0.1.0' } });
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  const { tools } = await call('tools/list');

  const fnTools = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
  const instructions = `You are a personal agent connected to a shared app over MCP. ${init.instructions || ''}
Today is ${today}.
- Use the tools for every change and every number. Never add numbers up yourself.
- Call describe_app first if you do not know the fields or category options.
- If a tool result says you are not allowed, say so plainly and stop.
- Reply in one or two short sentences in the user's language.`;

  const usage = { input: 0, output: 0 };
  let input = [{ role: 'user', content: [{ type: 'input_text', text: message }] }];
  let previousResponseId;
  for (let turn = 1; turn <= 6; turn++) {
    const res = await respond({ instructions, input, tools: fnTools, previousResponseId });
    const u = res.raw.usage || {};
    usage.input += u.input_tokens || 0;
    usage.output += u.output_tokens || 0;
    previousResponseId = res.id;
    if (!res.toolCalls.length) return { ok: true, message: res.text, wire, usage, ms: Date.now() - started, server: init.serverInfo };
    const results = [];
    for (const tc of res.toolCalls) {
      const r = await call('tools/call', { name: tc.name, arguments: tc.args || {} });
      const text = r && r.content && r.content[0] ? r.content[0].text : '{}';
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = { text }; }
      results.push(parsed);
    }
    input = toolResultItems(res.toolCalls, results);
  }
  return { ok: false, message: 'Stopped at the turn limit.', wire, usage, ms: Date.now() - started };
}

function summarizeResult(method, result) {
  if (!result) return null;
  if (method === 'initialize') return { serverInfo: result.serverInfo };
  if (method === 'tools/list') return { tools: result.tools.map((t) => t.name) };
  if (method === 'tools/call') {
    let r; try { r = JSON.parse(result.content[0].text); } catch { return { isError: result.isError }; }
    if (r.record) return { ok: true, id: r.record.id };
    if (!r.ok) return { ok: false, error: r.error };
    if (r.groups) return { ok: true, groups: r.groups.slice(0, 5) };
    if (r.entity) return { ok: true, fields: r.entity.fields.map((f) => f.key) };
    if (r.records) return { ok: true, matched: r.matched };
    return { ok: true, value: r.value, matched: r.matched };
  }
  return result;
}
