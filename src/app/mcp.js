// Minimal MCP server (JSON-RPC over HTTP POST, JSON responses) for one app.
// An invited person's agent, for example a Muse custom connector or Muse Code,
// connects with that person's token and gets exactly that person's role:
// the same operations, the same checks, the same activity log.

import { addEntry, updateEntry, query } from './ops.js';

const PROTOCOL = '2025-06-18';

function tools(app) {
  const fields = Object.fromEntries(app.spec.entity.fields.map((f) => [f.key, {
    type: f.type === 'money' || f.type === 'number' ? 'number' : f.type === 'bool' ? 'boolean' : 'string',
    description: f.label + (f.type === 'date' ? ' (YYYY-MM-DD)' : ''),
    ...(f.type === 'enum' ? { enum: f.options } : {}),
  }]));
  return [
    { name: 'describe_app', description: 'What this app keeps and what you are allowed to do.', inputSchema: { type: 'object', properties: {} } },
    { name: 'add_record', description: `Add one ${app.spec.entity.name}.`, inputSchema: { type: 'object', properties: { values: { type: 'object', properties: fields } }, required: ['values'] } },
    { name: 'update_record', description: 'Change fields of one record by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, values: { type: 'object', properties: fields } }, required: ['id', 'values'] } },
    {
      name: 'query_records',
      description: 'Exact totals, counts and lists. Use it instead of adding numbers up.',
      inputSchema: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['sum', 'count', 'list'] }, field: { type: 'string' }, where: { type: 'object', description: 'exact {field: value}, or {field: {contains|gte|lte|in}}' },
          from: { type: 'string' }, to: { type: 'string' }, group_by: { type: 'string' }, limit: { type: 'number' },
        },
        required: ['op'],
      },
    },
  ];
}

function ok(id, result) { return { jsonrpc: '2.0', id, result }; }
function err(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

async function one(app, member, msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg && msg.id, -32600, 'invalid request');
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: `bve-app-${app.id}`, version: '0.1.0' },
        instructions: `"${app.spec.title}" shared app. You act as ${member.name} (${member.role}).`,
      });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: tools(app) });
    case 'tools/call': {
      const name = msg.params && msg.params.name;
      const a = (msg.params && msg.params.arguments) || {};
      let r;
      if (name === 'describe_app') {
        r = { ok: true, title: app.spec.title, entity: app.spec.entity, you: { name: member.name, role: member.role } };
      } else if (name === 'add_record') r = addEntry(app, member, a.values, 'mcp');
      else if (name === 'update_record') r = updateEntry(app, member, String(a.id), a.values, 'mcp');
      else if (name === 'query_records') r = query(app, member, a);
      else return err(msg.id, -32602, `unknown tool ${name}`);
      return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(r) }], isError: !r.ok });
    }
    default:
      return isNotification ? null : err(msg.id, -32601, `method ${msg.method} not found`);
  }
}

export async function mcpHandle(app, member, body) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => one(app, member, m)))).filter(Boolean);
    return out.length ? out : null;
  }
  return one(app, member, body);
}
