import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../src/app/spec.js';
import { addEntry, updateEntry, deleteEntry, query, summaries, can } from '../src/app/ops.js';
import { mcpHandle } from '../src/app/mcp.js';
import { renderShell } from '../src/app/render.js';
import { LEDGER_SPEC } from '../src/demo/household.js';

const owner = { name: 'owner', role: 'owner' };
const member = { name: 'member', role: 'member' };

function makeApp() {
  const { spec } = validateSpec(LEDGER_SPEC);
  return { id: 't1', spec, html: '', entries: [], log: [], members: {} };
}

test('validateSpec accepts the ledger spec and rejects broken ones', () => {
  assert.equal(validateSpec(LEDGER_SPEC).ok, true);
  const noFields = validateSpec({ ...LEDGER_SPEC, entity: { name: 'x', fields: [] } });
  assert.equal(noFields.ok, false);
  const badSummary = validateSpec({ ...LEDGER_SPEC, summaries: [{ label: 's', op: 'sum', field: 'nope', period: 'month' }] });
  assert.equal(badSummary.ok, false);
});

test('roles: members add and query, only owners change amounts, delete or reshape', () => {
  assert.equal(can(owner, 'edit_layout'), true);
  assert.equal(can(member, 'edit_layout'), false);
  assert.equal(can(member, 'invite'), false);
  const app = makeApp();
  const added = addEntry(app, member, { merchant: '동네마트', amount: '22,500', category: '식비', date: '2026-11-04' });
  assert.equal(added.ok, true);
  assert.equal(added.record.amount, 22500);
  const id = added.record.id;
  assert.equal(updateEntry(app, member, id, { amount: 1 }).ok, false);
  assert.equal(deleteEntry(app, member, id).ok, false);
  assert.equal(app.entries[0].amount, 22500);
  assert.equal(app.log.filter((l) => l.action === 'refused').length, 2);
  assert.equal(updateEntry(app, owner, id, { amount: 20000 }).ok, true);
  assert.equal(deleteEntry(app, owner, id).ok, true);
  assert.equal(app.entries.length, 0);
});

test('records are checked against the spec', () => {
  const app = makeApp();
  assert.equal(addEntry(app, owner, { merchant: 'x', amount: 100, category: '없는분류' }).ok, false);
  assert.equal(addEntry(app, owner, { amount: 100, category: '식비' }).ok, false);
});

test('query gives exact sums, counts, groups and filters', () => {
  const app = makeApp();
  const rows = [
    ['A', 10000, '외식', '2026-10-02'], ['B', 25000, '외식', '2026-10-15'], ['C', 4500, '카페', '2026-10-15'],
    ['D', 31000, '외식', '2026-09-30'], ['E', 52000, '식비', '2026-10-20'],
  ];
  for (const [merchant, amount, category, date] of rows) addEntry(app, owner, { merchant, amount, category, date });
  const oct = { from: '2026-10-01', to: '2026-10-31' };
  assert.equal(query(app, member, { op: 'sum', field: 'amount', where: { category: '외식' }, ...oct }).value, 35000);
  assert.equal(query(app, member, { op: 'count', where: { category: '카페' }, ...oct }).value, 1);
  assert.equal(query(app, member, { op: 'count', where: { amount: { gte: 30000 } } }).value, 2);
  assert.equal(query(app, member, { op: 'count', where: { category: { in: ['카페', '식비'] } } }).value, 2);
  const g = query(app, member, { op: 'sum', field: 'amount', group_by: 'category', ...oct });
  assert.deepEqual(g.groups.map((x) => [x.category, x.value]), [['식비', 52000], ['외식', 35000], ['카페', 4500]]);
  assert.equal(query(app, member, { op: 'sum', field: 'merchant' }).ok, false);
});

test('summary cards use the same query path', () => {
  const app = makeApp();
  addEntry(app, owner, { merchant: 'A', amount: 1000, category: '외식', date: '2026-11-02' });
  addEntry(app, owner, { merchant: 'B', amount: 2000, category: '카페', date: '2026-10-30' });
  const s = summaries(app, new Date('2026-11-04T12:00:00'));
  assert.ok(s.length >= 1);
  const monthTotal = s.find((x) => x.op === 'sum' && !LEDGER_SPEC.summaries.find((y) => y.label === x.label).where);
  if (monthTotal) assert.equal(monthTotal.value, 1000);
});

test('MCP: initialize, list tools, call with the caller role', async () => {
  const app = makeApp();
  const init = await mcpHandle(app, member, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.match(init.result.instructions, /member/);
  const list = await mcpHandle(app, member, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['describe_app', 'add_record', 'update_record', 'query_records']);
  const add = await mcpHandle(app, member, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_record', arguments: { values: { merchant: '김밥', amount: 9800, category: '외식', date: '2026-11-04' } } } });
  assert.equal(add.result.isError, false);
  const id = JSON.parse(add.result.content[0].text).record.id;
  const upd = await mcpHandle(app, member, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'update_record', arguments: { id, values: { amount: 1 } } } });
  assert.equal(upd.result.isError, true);
  assert.equal(app.entries[0].amount, 9800);
  assert.equal(app.log.at(-1).via, 'mcp');
  const unknown = await mcpHandle(app, member, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } });
  assert.ok(unknown.error);
  assert.equal(await mcpHandle(app, member, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('renderer marks every element and ships its own smoke tests', () => {
  const { spec } = validateSpec(LEDGER_SPEC);
  const html = renderShell(spec);
  assert.match(html, /data-bve-id="1"/);
  assert.match(html, /window\.__smoke/);
  assert.doesNotMatch(html, /<script[^>]*src=/);
});
