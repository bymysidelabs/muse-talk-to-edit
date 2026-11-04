// The app's own operations. These are what the buttons in the app call, what
// the agent calls as tools, and what an external agent calls over MCP. Same
// code path for everyone, so a person and an agent can never disagree about
// what "add an expense" means.

import { newId, save } from './store.js';

export const ROLES = {
  owner: new Set(['add', 'update', 'delete', 'query', 'edit_layout', 'invite']),
  // Members can add records and flip on/off fields (e.g. sold out), but not
  // change prices, delete history or reshape the app.
  member: new Set(['add', 'update_bool', 'query']),
};

/** Today's date in the server's own time zone, YYYY-MM-DD. */
export function localDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function can(member, action) {
  return Boolean(member && ROLES[member.role] && ROLES[member.role].has(action));
}

function fieldsOf(app) {
  return Object.fromEntries(app.spec.entity.fields.map((f) => [f.key, f]));
}

function dateField(app) {
  const f = app.spec.entity.fields.find((x) => x.type === 'date');
  return f ? f.key : null;
}

/** Coerce and check one record's values against the spec. */
export function checkValues(app, values, { partial = false } = {}) {
  const byKey = fieldsOf(app);
  const out = {};
  const errors = [];
  for (const [k, v] of Object.entries(values || {})) {
    const f = byKey[k];
    if (!f) { errors.push(`unknown field ${k}`); continue; }
    if (v === null || v === '') continue;
    switch (f.type) {
      case 'money':
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
        if (!Number.isFinite(n)) errors.push(`${k} must be a number`); else out[k] = n;
        break;
      }
      case 'date': {
        const s = String(v).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) errors.push(`${k} must be YYYY-MM-DD`); else out[k] = s;
        break;
      }
      case 'enum':
        if (!f.options.includes(String(v))) errors.push(`${k} must be one of ${f.options.join(', ')}`); else out[k] = String(v);
        break;
      case 'bool':
        out[k] = v === true || v === 'true' || v === 1;
        break;
      default:
        out[k] = String(v).slice(0, 80);
    }
  }
  if (!partial) {
    const firstText = app.spec.entity.fields.find((f) => f.type === 'text');
    if (firstText && out[firstText.key] == null) errors.push(`${firstText.key} is required`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, values: out };
}

function log(app, entry) {
  app.log.push({ at: new Date().toISOString(), ...entry });
  if (app.log.length > 500) app.log.splice(0, app.log.length - 500);
}

export function addEntry(app, member, values, via = 'app') {
  if (!can(member, 'add')) return { ok: false, error: 'your role cannot add records' };
  const v = checkValues(app, values);
  if (!v.ok) return { ok: false, error: v.errors.join('; ') };
  const df = dateField(app);
  if (df && !v.values[df]) v.values[df] = localDate();
  const rec = { id: newId(5), ...v.values, _by: member.name, _at: new Date().toISOString() };
  app.entries.push(rec);
  if (via !== 'import') { log(app, { who: member.name, via, action: 'add', id: rec.id, values: v.values }); save(); }
  return { ok: true, record: rec };
}

export function updateEntry(app, member, id, values, via = 'app') {
  const rec = app.entries.find((e) => e.id === id);
  if (!rec) return { ok: false, error: `no record ${id}` };
  const v = checkValues(app, values, { partial: true });
  if (!v.ok) return { ok: false, error: v.errors.join('; ') };
  const byKey = fieldsOf(app);
  const onlyBool = Object.keys(v.values).every((k) => byKey[k].type === 'bool');
  if (!can(member, 'update') && !(onlyBool && can(member, 'update_bool'))) {
    log(app, { who: member.name, via, action: 'refused', id, values: { tried: `change ${Object.keys(v.values).join(', ')}` } });
    save();
    return { ok: false, error: onlyBool ? 'your role cannot change records' : 'your role can only switch on/off fields' };
  }
  Object.assign(rec, v.values, { _by: member.name, _at: new Date().toISOString() });
  log(app, { who: member.name, via, action: 'update', id, values: v.values });
  save();
  return { ok: true, record: rec };
}

export function deleteEntry(app, member, id, via = 'app') {
  if (!can(member, 'delete')) {
    log(app, { who: member.name, via, action: 'refused', id, values: { tried: 'delete' } });
    save();
    return { ok: false, error: 'your role cannot delete records' };
  }
  const i = app.entries.findIndex((e) => e.id === id);
  if (i < 0) return { ok: false, error: `no record ${id}` };
  app.entries.splice(i, 1);
  log(app, { who: member.name, via, action: 'delete', id });
  save();
  return { ok: true };
}

function matches(rec, where, byKey) {
  for (const [k, cond] of Object.entries(where || {})) {
    const f = byKey[k];
    if (!f) return false;
    const v = rec[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if (cond.contains != null && !String(v ?? '').toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
      if (cond.in && !cond.in.map(String).includes(String(v))) return false;
      if (cond.gte != null && !(Number(v) >= Number(cond.gte))) return false;
      if (cond.lte != null && !(Number(v) <= Number(cond.lte))) return false;
    } else if (String(v) !== String(cond)) {
      return false;
    }
  }
  return true;
}

/**
 * Read the app's records. Returns small, exact answers so the model never has
 * to add up numbers itself.
 * q: { op: 'sum'|'count'|'list', field?, where?, from?, to?, group_by?, limit? }
 */
export function query(app, member, q = {}) {
  if (!can(member, 'query')) return { ok: false, error: 'your role cannot read records' };
  const byKey = fieldsOf(app);
  const df = dateField(app);
  let rows = app.entries.filter((r) => matches(r, q.where, byKey));
  if (df && q.from) rows = rows.filter((r) => String(r[df]) >= q.from);
  if (df && q.to) rows = rows.filter((r) => String(r[df]) <= q.to);
  const op = q.op || 'list';
  if (op === 'sum' && !(byKey[q.field] && ['money', 'number'].includes(byKey[q.field].type))) {
    return { ok: false, error: 'sum needs a money or number field' };
  }
  const agg = (list) => (op === 'sum' ? list.reduce((s, r) => s + (Number(r[q.field]) || 0), 0) : list.length);

  if (q.group_by && op !== 'list') {
    if (!byKey[q.group_by]) return { ok: false, error: `unknown field ${q.group_by}` };
    const groups = {};
    for (const r of rows) (groups[r[q.group_by]] ||= []).push(r);
    const result = Object.entries(groups).map(([k, list]) => ({ [q.group_by]: k, value: agg(list), count: list.length }))
      .sort((a, b) => b.value - a.value);
    return { ok: true, op, field: q.field, group_by: q.group_by, matched: rows.length, groups: result };
  }
  if (op === 'list') {
    const limit = Math.min(Number(q.limit) || 10, 30);
    const sorted = df ? [...rows].sort((a, b) => String(b[df]).localeCompare(String(a[df]))) : rows;
    return { ok: true, op, matched: rows.length, records: sorted.slice(0, limit).map(({ _at, ...r }) => r) };
  }
  return { ok: true, op, field: q.field, matched: rows.length, value: agg(rows) };
}

/** Values for the summary cards, computed the same way query() does. */
export function summaries(app, today = new Date()) {
  const df = dateField(app);
  const iso = localDate;
  const range = (period) => {
    if (period === 'today') return { from: iso(today), to: iso(today) };
    if (period === 'week') { const d = new Date(today.getTime() - 6 * 86400000); return { from: iso(d), to: iso(today) }; }
    if (period === 'month') return { from: iso(today).slice(0, 8) + '01', to: iso(today) };
    return {};
  };
  const owner = { role: 'owner', name: 'system' };
  return app.spec.summaries.map((s) => {
    const r = query(app, owner, { op: s.op, field: s.field, where: s.where, ...(df ? range(s.period) : {}) });
    return { label: s.label, op: s.op, field: s.field, value: r.ok ? r.value : null };
  });
}
