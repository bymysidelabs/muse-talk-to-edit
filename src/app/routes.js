// HTTP routes for generated apps. Everything a person, their agent, or an
// invited person's agent does goes through these, with a bearer token that
// maps to one member and one role.

import { createHash } from 'node:crypto';
import { load, getApp, putApp, newId, memberFor, save } from './store.js';
import { validateSpec } from './spec.js';
import { renderShell } from './render.js';
import { addEntry, updateEntry, deleteEntry, query, summaries, can } from './ops.js';
import { propose, assist } from './agentops.js';
import { editOnce } from '../agent.js';
import { mcpHandle } from './mcp.js';
import { recentActivity, payments, mapToSpec, sms } from '../demo/household.js';
import { runMcpAgent } from '../demo/mcpclient.js';

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const pendingLayouts = new Map(); // appId -> Map(hash -> { html, by })

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function activityLine(app) {
  const last = app.log[app.log.length - 1];
  if (!last) return '';
  if (last.via === 'import') return `${last.who}: ${last.values && last.values.note ? last.values.note : '기록 가져옴'}`;
  const verb = { add: '추가', update: '변경', delete: '삭제', layout: '화면 수정', join: '참여', refused: '권한 없음' }[last.action] || last.action;
  const what = last.values ? Object.values(last.values).filter((v) => typeof v === 'string').slice(0, 1).join('') : '';
  const via = last.via === 'agent' ? ' (에이전트)' : last.via === 'mcp' ? ' (외부 에이전트)' : '';
  return `${last.who}: ${what ? `${what} ` : ''}${verb}${via}`;
}

export function publicState(app, member) {
  return {
    ok: true,
    me: { name: member.name, role: member.role },
    entries: [...app.entries].slice(-200),
    total: app.entries.length,
    summaries: summaries(app),
    activity: activityLine(app),
    log: app.log.slice(-12),
    members: Object.values(app.members).map((m) => ({ name: m.name, role: m.role })),
  };
}

/** Returns true when the request was handled. */
export async function appRoutes(req, res, url, readBody, json) {
  await load();
  const p = url.pathname;

  if (req.method === 'POST' && p === '/api/propose') {
    const body = await readBody(req);
    const history = String(body.history || '').slice(0, 20000);
    if (!history) return json(res, 400, { error: 'history is required' }), true;
    json(res, 200, await propose({ history }));
    return true;
  }

  if (req.method === 'GET' && p === '/api/demo/history') {
    json(res, 200, { ok: true, history: recentActivity() });
    return true;
  }
  if (req.method === 'GET' && p === '/api/demo/texts') {
    // a few fresh card texts for the live demo (dated after the imported history)
    json(res, 200, { ok: true, texts: payments('2026-11-04', '2026-11-04', 99).map(sms) });
    return true;
  }

  // Demo only: run an outside agent that reaches the app purely over MCP with the caller's token.
  if (req.method === 'POST' && p === '/api/demo/mcp-agent') {
    const body = await readBody(req);
    const port = req.socket.localPort;
    const r = await runMcpAgent({ url: `http://127.0.0.1:${port}/mcp/${encodeURIComponent(String(body.appId || ''))}`, token: bearer(req), message: String(body.message || '').slice(0, 2000) });
    json(res, 200, r);
    return true;
  }

  if (req.method === 'POST' && p === '/api/apps') {
    const body = await readBody(req);
    const v = validateSpec(body.spec);
    if (v.ok && body.seedDemo) body.seed = mapToSpec(v.spec, payments('2026-08-01', '2026-11-03'));
    if (!v.ok) return json(res, 400, { error: v.errors.join('; ') }), true;
    const ownerToken = newId(18);
    const app = {
      id: newId(6), spec: v.spec, html: renderShell(v.spec), entries: [], log: [], created: new Date().toISOString(),
      members: { [ownerToken]: { name: String(body.ownerName || '나').slice(0, 16), role: 'owner' } },
    };
    if (Array.isArray(body.seed)) {
      const owner = { name: app.members[ownerToken].name, role: 'owner' };
      for (const values of body.seed.slice(0, 2000)) addEntry(app, owner, values, 'import');
      await save();
      app.log.push({ at: new Date().toISOString(), who: owner.name, via: 'import', action: 'add', values: { note: `기록 ${app.entries.length}건 가져옴` } });
    }
    await putApp(app);
    json(res, 200, { ok: true, id: app.id, ownerToken });
    return true;
  }

  // Serve an app to a member. The token rides in the URL only for this local demo.
  let m = p.match(/^\/a\/([\w-]+)$/);
  if (req.method === 'GET' && m) {
    const app = getApp(m[1]);
    const member = memberFor(app, url.searchParams.get('t'));
    if (!member) return json(res, 403, { error: 'invalid link' }), true;
    const cfg = `<script>window.__BVE=${JSON.stringify({ appId: app.id, token: member.token })}</script>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(app.html.replace('</head>', `${cfg}</head>`));
    return true;
  }

  m = p.match(/^\/api\/apps\/([\w-]+)\/([a-z_-]+)$/);
  if (!m) return false;
  const app = getApp(m[1]);
  const member = memberFor(app, bearer(req));
  if (!app || !member) return json(res, 403, { error: 'not a member of this app' }), true;
  const action = m[2];

  if (req.method === 'GET' && action === 'state') return json(res, 200, publicState(app, member)), true;
  if (req.method === 'GET' && action === 'html') {
    if (!can(member, 'edit_layout')) return json(res, 403, { error: 'only the owner can edit the layout' }), true;
    return json(res, 200, { ok: true, html: app.html }), true;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' }), true;
  const body = await readBody(req);

  switch (action) {
    case 'add': return json(res, 200, addEntry(app, member, body.values, 'app')), true;
    case 'update': return json(res, 200, updateEntry(app, member, String(body.id), body.values, 'app')), true;
    case 'delete': return json(res, 200, deleteEntry(app, member, String(body.id), 'app')), true;
    case 'query': return json(res, 200, query(app, member, body)), true;
    case 'assist': {
      const msg = String(body.message || '').slice(0, 2000);
      return json(res, 200, await assist({ app, member, message: msg })), true;
    }
    case 'invite': {
      if (!can(member, 'invite')) return json(res, 403, { error: 'only the owner can invite' }), true;
      const token = newId(18);
      const name = String(body.name || '초대한 사람').slice(0, 16);
      app.members[token] = { name, role: body.role === 'owner' ? 'owner' : 'member' };
      app.log.push({ at: new Date().toISOString(), who: name, via: 'app', action: 'join' });
      await save();
      return json(res, 200, { ok: true, token, name, role: app.members[token].role, link: `/a/${app.id}?t=${token}`, mcp: `/mcp/${app.id}` }), true;
    }
    case 'edit': {
      // Talk-to-edit on the app's own layout, through the verified editor.
      if (!can(member, 'edit_layout')) return json(res, 403, { ok: false, status: 'refused', message: `${member.name} cannot change how the app looks. Only the owner can.` }), true;
      const result = await editOnce({ html: app.html, request: String(body.request || '').slice(0, 500), computed: body.computed || {} });
      const proposed = result.status === 'done' ? result.html : result.proposedHtml;
      if (proposed && proposed !== app.html) {
        const h = hash(proposed);
        if (!pendingLayouts.has(app.id)) pendingLayouts.set(app.id, new Map());
        pendingLayouts.get(app.id).set(h, { html: proposed, by: member.name, request: body.request });
        result.layoutHash = h;
      }
      return json(res, 200, result), true;
    }
    case 'commit-layout': {
      // Only a layout this server produced and verified can be committed.
      if (!can(member, 'edit_layout')) return json(res, 403, { error: 'only the owner can edit the layout' }), true;
      const pend = pendingLayouts.get(app.id);
      const item = pend && pend.get(String(body.hash));
      if (!item) return json(res, 400, { error: 'unknown or expired layout' }), true;
      app.html = item.html;
      pend.clear();
      app.log.push({ at: new Date().toISOString(), who: member.name, via: 'agent', action: 'layout', values: { request: String(item.request || '') } });
      await save();
      return json(res, 200, { ok: true }), true;
    }
    default:
      return json(res, 404, { error: 'unknown action' }), true;
  }
}

export async function mcpRoute(req, res, url, readBody, json) {
  const m = url.pathname.match(/^\/mcp\/([\w-]+)$/);
  if (!m) return false;
  await load();
  const app = getApp(m[1]);
  const member = memberFor(app, bearer(req));
  if (!app || !member) return json(res, 401, { error: 'unauthorized' }), true;
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true;
  const body = await readBody(req);
  const out = await mcpHandle(app, member, body);
  if (out === null) { res.writeHead(202); res.end(); return true; }
  json(res, 200, out);
  return true;
}
