import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyTool } from '../src/tools.js';
import { verifyEdit } from '../src/verify.js';

const APP = await readFile(new URL('../demo/app.html', import.meta.url), 'utf8');

function run(name, args, ctx) {
  const out = applyTool(APP, name, args, ctx);
  assert.equal(out.ok, true, out.error);
  return verifyEdit(APP, out.html, { name, args }, ctx);
}

test('text change passes and touches nothing else', () => {
  const v = run('set_text', { id: '3', text: '영업시간 09:00 - 21:00' });
  assert.equal(v.pass, true, v.reason);
  assert.equal(v.changed.length, 0);
});

test('font scaling uses the measured size as the baseline', () => {
  const v = run('scale_font', { id: '22', factor: 1.5 }, { computed: { 22: { fontSize: '15px' } } });
  assert.equal(v.pass, true, v.reason);
  assert.match(v.checks.find((c) => c.label === 'Font size scaled').detail, /15px -> 23px/);
});

test('moving an item to the top keeps every other element intact', () => {
  const v = run('move_element', { id: '10', direction: 'first' });
  assert.equal(v.pass, true, v.reason);
});

test('hiding an item is verified', () => {
  const v = run('set_visibility', { id: '15', hidden: true });
  assert.equal(v.pass, true, v.reason);
});

test('an edit that also changes a neighbour is rejected', () => {
  const out = applyTool(APP, 'set_text', { id: '3', text: '영업시간 09:00 - 21:00' });
  const sneaky = out.html.replace('카페라떼', '카페 라떼');
  const v = verifyEdit(APP, sneaky, { name: 'set_text', args: { id: '3', text: '영업시간 09:00 - 21:00' } });
  assert.equal(v.pass, false);
  assert.deepEqual(v.changed, ['12']);
});

test('a text change that did not land is rejected', () => {
  const v = verifyEdit(APP, APP, { name: 'set_text', args: { id: '3', text: '영업시간 09:00 - 21:00' } });
  assert.equal(v.pass, false);
});

test('style values that could inject CSS are refused', () => {
  const out = applyTool(APP, 'set_style', { id: '22', property: 'color', value: 'red; position: fixed' });
  assert.equal(out.ok, false);
});

test('text is escaped, never inserted as markup', () => {
  const out = applyTool(APP, 'set_text', { id: '2', text: '<img src=x onerror=alert(1)>' });
  assert.equal(out.ok, true);
  assert.ok(!out.html.includes('<img src=x'));
});

test('a colour change that makes text unreadable fails', async () => {
  const { contrast, parseColor } = await import('../src/verify.js');
  assert.ok(contrast(parseColor('#2e7d32').rgb, parseColor('rgb(47, 107, 79)').rgb) < 3);
  assert.ok(contrast(parseColor('#ffffff').rgb, parseColor('#2e7d32').rgb) >= 3);
  assert.equal(parseColor('chartreuse-ish'), null);
});
