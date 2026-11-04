// Spec -> app. The output is a static shell (every element carries data-bve-id,
// so the verified editor can change its look) plus one shared runtime that
// fills in records, summaries and the activity line, and wires every button to
// the same operations the agent uses.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ACCENTS = ['#2f6b4f', '#2b4fd8', '#8a4b2a', '#6a3fb5', '#b03a5b', '#1f6f8b'];

export function renderShell(spec) {
  let n = 0;
  const id = () => `data-bve-id="${++n}"`;
  const accent = ACCENTS[[...spec.title].reduce((s, c) => s + c.codePointAt(0), 0) % ACCENTS.length];
  const fields = spec.entity.fields;

  const header = `<header ${id()}>
    <h1 ${id()}>${esc(spec.title)}</h1>
    <p class="sub" ${id()}>${esc(spec.subtitle || '')}</p>
  </header>`;

  const cards = spec.summaries.map((s, i) => `<div class="card" ${id()}>
      <div class="clabel" ${id()}>${esc(s.label)}</div>
      <div class="cvalue" data-summary="${i}" ${id()}>-</div>
    </div>`).join('\n    ');
  const summaryRow = spec.summaries.length ? `<section class="cards" ${id()}>
    ${cards}
  </section>` : '';

  const quick = spec.quick.length ? `<section class="quick" ${id()}>
    ${spec.quick.map((q, i) => `<button class="qbtn" data-action="quick" data-quick="${i}" ${id()}>${esc(q.label)}</button>`).join('\n    ')}
  </section>` : '';

  const inputs = fields.filter((f) => f.type !== 'bool').map((f) => {
    if (f.type === 'enum') {
      return `<select data-field="${f.key}" aria-label="${esc(f.label)}" ${id()}>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
    }
    const type = f.type === 'date' ? 'date' : 'text';
    const mode = ['money', 'number'].includes(f.type) ? ' inputmode="numeric"' : '';
    return `<input data-field="${f.key}" type="${type}"${mode} placeholder="${esc(f.label)}" aria-label="${esc(f.label)}" ${id()}>`;
  }).join('\n      ');
  const form = `<section class="form" ${id()}>
    <div class="row" ${id()}>
      ${inputs}
    </div>
    <button class="add" data-action="add" ${id()}>${esc(spec.entity.name)} 추가</button>
  </section>`;

  const list = `<ul class="list" data-role="list" ${id()}></ul>`;
  const activity = `<p class="activity" data-role="activity" ${id()}></p>`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; background: #f5f4f0; color: #1b1c1f; }
  .app { max-width: 390px; margin: 0 auto; min-height: 100vh; background: #fdfcf9; padding-bottom: 24px; }
  header { padding: 22px 18px 8px; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }
  .sub { margin: 4px 0 0; color: #6b6f78; font-size: 13px; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 10px 14px 4px; }
  .card { background: #fff; border: 1px solid #ebe8e1; border-radius: 14px; padding: 10px 12px; }
  .clabel { font-size: 12px; color: #6b6f78; }
  .cvalue { font-size: 18px; font-weight: 700; margin-top: 2px; color: ${accent}; white-space: nowrap; letter-spacing: -0.01em; }
  .quick { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 14px 0; }
  .qbtn { border: 1px solid #e3e0d8; background: #fff; border-radius: 999px; padding: 7px 12px; font-size: 13px; }
  .form { padding: 10px 14px 0; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .row input, .row select { font: inherit; font-size: 14px; padding: 9px 10px; border: 1px solid #e3e0d8; border-radius: 10px; background: #fff; min-width: 0; }
  .add { margin-top: 8px; width: 100%; border: 0; border-radius: 12px; padding: 11px; font-size: 15px; background: ${accent}; color: #fff; }
  .list { list-style: none; margin: 12px 0 0; padding: 0 14px; }
  .list li { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-top: 1px solid #efece6; font-size: 14px; }
  .list .main { flex: 1; min-width: 0; }
  .list .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list .side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
  .list .m { font-size: 12px; color: #6b6f78; }
  .list .amt { font-weight: 700; white-space: nowrap; }
  .list .tog { border: 1px solid #e3e0d8; background: #fff; border-radius: 999px; padding: 4px 9px; font-size: 12px; }
  .list .tog.on { background: #1b1c1f; color: #fff; border-color: #1b1c1f; }
  .list .who { font-size: 11px; color: #8a8f99; }
  .activity { margin: 10px 16px 0; font-size: 12px; color: #6b6f78; min-height: 16px; }
</style>
</head>
<body>
<div class="app">
  ${header}
  ${summaryRow}
  ${quick}
  ${form}
  ${list}
  ${activity}
</div>
<script type="application/json" id="bve-spec">${JSON.stringify(spec).replace(/</g, '\\u003c')}</script>
<script>${RUNTIME}</script>
</body>
</html>`;
}

// Shared runtime. Kept as a string so the shell is a single self-contained file.
const RUNTIME = String.raw`
(() => {
  const spec = JSON.parse(document.getElementById('bve-spec').textContent);
  const cfg = window.__BVE || {};
  const F = Object.fromEntries(spec.entity.fields.map((f) => [f.key, f]));
  const dateKey = (spec.entity.fields.find((f) => f.type === 'date') || {}).key;
  const textKey = (spec.entity.fields.find((f) => f.type === 'text') || {}).key;
  const moneyKey = (spec.entity.fields.find((f) => f.type === 'money' || f.type === 'number') || {}).key;
  const boolFields = spec.entity.fields.filter((f) => f.type === 'bool');
  const enumKeys = spec.entity.fields.filter((f) => f.type === 'enum').map((f) => f.key);
  let state = { entries: [], summaries: [], activity: '' };
  let offline = !cfg.appId;
  const $ = (s) => document.querySelector(s);
  const won = (n) => (F[moneyKey] && F[moneyKey].type === 'money') ? Number(n).toLocaleString('ko-KR') + '원' : String(n);
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = () => ymd(new Date());

  function localSummaries() {
    const t = new Date();
    return spec.summaries.map((s) => {
      let rows = state.entries.filter((r) => Object.entries(s.where || {}).every(([k, v]) => String(r[k]) === String(v)));
      if (dateKey && s.period !== 'all') {
        const to = today(); let from = to;
        if (s.period === 'month') from = to.slice(0, 8) + '01';
        if (s.period === 'week') { from = ymd(new Date(Date.now() - 6 * 86400000)); }
        rows = rows.filter((r) => String(r[dateKey]) >= from && String(r[dateKey]) <= to);
      }
      return { value: s.op === 'sum' ? rows.reduce((a, r) => a + (Number(r[s.field]) || 0), 0) : rows.length, op: s.op, field: s.field };
    });
  }

  function render() {
    state.summaries.forEach((s, i) => {
      const el = document.querySelector('[data-summary="' + i + '"]');
      if (el) el.textContent = s.value == null ? '-' : (s.op === 'sum' ? won(s.value) : s.value + '건');
    });
    const list = $('[data-role="list"]');
    if (list) {
      const rows = [...state.entries].sort((a, b) => dateKey ? String(b[dateKey]).localeCompare(String(a[dateKey])) : 0).slice(0, 30);
      list.innerHTML = '';
      for (const r of rows) {
        const li = document.createElement('li');
        const main = document.createElement('div'); main.className = 'main';
        const t = document.createElement('div'); t.className = 't'; t.textContent = textKey ? r[textKey] : r.id;
        const m = document.createElement('div'); m.className = 'm';
        const d = dateKey && r[dateKey] ? String(r[dateKey]).slice(5).replace('-', '/') : '';
        m.textContent = [d, ...enumKeys.map((k) => r[k]), r._by].filter(Boolean).join('   ');
        main.append(t, m);
        li.append(main);
        const side = document.createElement('div'); side.className = 'side';
        if (moneyKey) { const a = document.createElement('div'); a.className = 'amt'; a.textContent = r[moneyKey] != null ? won(r[moneyKey]) : ''; side.append(a); }
        for (const f of boolFields) {
          const b = document.createElement('button'); b.className = 'tog' + (r[f.key] ? ' on' : '');
          b.dataset.action = 'toggle'; b.dataset.id = r.id; b.dataset.field = f.key; b.textContent = f.label;
          side.append(b);
        }
        li.append(side);
        li.dataset.id = r.id;
        list.append(li);
      }
    }
    const act = $('[data-role="activity"]');
    if (act) act.textContent = state.activity || '';
  }

  async function call(path, body) {
    const res = await fetch('/api/apps/' + cfg.appId + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  async function refresh() {
    if (offline) { state.summaries = localSummaries(); render(); return; }
    try { const s = await call('/state'); if (s.ok) { state = s; render(); } } catch (e) {}
  }

  function readForm() {
    const v = {};
    document.querySelectorAll('[data-field]').forEach((el) => { if (el.value !== '') v[el.dataset.field] = el.value; });
    if (dateKey && !v[dateKey]) v[dateKey] = today();
    return v;
  }

  function coerce(values) {
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      const f = F[k]; if (!f) continue;
      if (f.type === 'money' || f.type === 'number') { const n = Number(String(v).replace(/[^0-9.-]/g, '')); if (!Number.isFinite(n)) return null; out[k] = n; }
      else if (f.type === 'bool') out[k] = Boolean(v);
      else if (f.type === 'enum') { if (!f.options.includes(String(v))) return null; out[k] = String(v); }
      else out[k] = String(v);
    }
    if (textKey && !out[textKey]) return null;
    return out;
  }

  async function add(values) {
    if (offline) {
      const c = coerce(values); if (!c) return false;
      state.entries.push({ id: 'l' + Math.random().toString(36).slice(2, 8), ...c, _by: 'test' });
      state.activity = 'added'; await refresh(); return true;
    }
    const r = await call('/add', { values });
    if (r.ok) await refresh(); else state.activity = r.error, render();
    return r.ok;
  }

  async function toggle(id, field) {
    const rec = state.entries.find((e) => e.id === id); if (!rec) return false;
    if (offline) { rec[field] = !rec[field]; await refresh(); return true; }
    const r = await call('/update', { id, values: { [field]: !rec[field] } });
    if (r.ok) await refresh(); else state.activity = r.error, render();
    return r.ok;
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    if (b.dataset.action === 'add') { if (await add(readForm())) document.querySelectorAll('input[data-field]').forEach((el) => { if (el.type !== 'date') el.value = ''; }); }
    if (b.dataset.action === 'quick') { const q = spec.quick[Number(b.dataset.quick)]; const v = { ...readForm(), ...q.preset }; if (textKey && !v[textKey]) v[textKey] = q.label; await add(v); }
    if (b.dataset.action === 'toggle') await toggle(b.dataset.id, b.dataset.field);
  });

  document.querySelectorAll('input[type="date"][data-field]').forEach((el) => { el.value = today(); });

  // Behaviour checks for the verified editor. They switch the runtime to a
  // local copy first, so checking never writes to the real records.
  window.__smoke = [
    { name: 'Add form saves a record', run: async () => {
      offline = true;
      const before = state.entries.length;
      const v = {};
      for (const f of spec.entity.fields) {
        if (f.type === 'bool') continue;
        const el = document.querySelector('[data-field="' + f.key + '"]');
        if (!el || el.offsetParent === null) return false;
        if (f.type === 'text') el.value = 'test'; if (f.type === 'money' || f.type === 'number') el.value = '1000';
        if (f.type === 'date') el.value = today(); if (f.type === 'enum') el.value = f.options[0];
      }
      const btn = document.querySelector('[data-action="add"]');
      if (!btn || btn.offsetParent === null) return false;
      btn.click(); await new Promise((r) => setTimeout(r, 50));
      return state.entries.length === before + 1;
    } },
    { name: 'Summary cards update', run: async () => {
      offline = true;
      if (!spec.summaries.length) return true;
      const el = document.querySelector('[data-summary="0"]');
      if (!el) return false;
      const before = el.textContent;
      const v = { [textKey]: 'test' }; if (moneyKey) v[moneyKey] = 1000; if (dateKey) v[dateKey] = today();
      for (const k of enumKeys) v[k] = (spec.summaries[0].where && spec.summaries[0].where[k]) || F[k].options[0];
      await add(v);
      return el.textContent !== before;
    } },
    ...(boolFields.length ? [{ name: 'On/off switch works', run: async () => {
      offline = true;
      const b = document.querySelector('[data-action="toggle"]');
      if (!b) return true;
      const id = b.dataset.id, f = b.dataset.field; const rec = state.entries.find((e) => e.id === id);
      const before = rec && rec[f]; b.click(); await new Promise((r) => setTimeout(r, 50));
      return Boolean(rec) && rec[f] !== before;
    } }] : []),
  ];

  window.__bveSeed = (entries) => { state.entries = entries.map((e) => ({ ...e })); refresh(); };
  refresh();
  if (!offline) setInterval(refresh, 1500);
})();
`;
