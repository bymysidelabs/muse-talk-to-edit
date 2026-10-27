import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTool, elementIndex } from '../src/tools.js';

const HTML = `<ul data-bve-id="1">
  <li data-bve-id="2"><span data-bve-id="3">하나</span></li>
  <li data-bve-id="4"><span data-bve-id="5">둘</span></li>
</ul>`;

test('elementIndex lists every marked element in order', () => {
  const ids = elementIndex(HTML).map((e) => e.id);
  assert.deepEqual(ids, ['1', '2', '3', '4', '5']);
});

test('set_text replaces only that element text', () => {
  const out = applyTool(HTML, 'set_text', { id: '3', text: '첫째' });
  assert.equal(out.ok, true);
  assert.match(out.html, /첫째/);
  assert.match(out.html, /둘/);
});

test('set_text refuses an element that has children', () => {
  const out = applyTool(HTML, 'set_text', { id: '2', text: 'x' });
  assert.equal(out.ok, false);
});

test('set_style writes a whitelisted property', () => {
  const out = applyTool(HTML, 'set_style', { id: '3', property: 'fontSize', value: '22px' });
  assert.equal(out.ok, true);
  assert.match(out.html, /style="font-size: 22px"/);
});

test('set_style rejects a property outside the whitelist', () => {
  const out = applyTool(HTML, 'set_style', { id: '3', property: 'position', value: 'fixed' });
  assert.equal(out.ok, false);
});

test('scale_font multiplies the current size', () => {
  const styled = applyTool(HTML, 'set_style', { id: '3', property: 'fontSize', value: '10px' });
  const out = applyTool(styled.html, 'scale_font', { id: '3', factor: 2 });
  assert.equal(out.ok, true);
  assert.match(out.html, /font-size: 20px/);
});

test('move_element swaps a sibling order', () => {
  const out = applyTool(HTML, 'move_element', { id: '4', direction: 'up' });
  assert.equal(out.ok, true);
  const ids = elementIndex(out.html).map((e) => e.id);
  assert.deepEqual(ids, ['1', '4', '5', '2', '3']);
});

test('move_element refuses to go past the first sibling', () => {
  const out = applyTool(HTML, 'move_element', { id: '2', direction: 'up' });
  assert.equal(out.ok, false);
});

test('swap_elements exchanges two blocks', () => {
  const out = applyTool(HTML, 'swap_elements', { id_a: '3', id_b: '5' });
  assert.equal(out.ok, true);
  const ids = elementIndex(out.html).map((e) => e.id);
  assert.deepEqual(ids, ['1', '2', '5', '4', '3']);
});

test('set_visibility hides an element', () => {
  const out = applyTool(HTML, 'set_visibility', { id: '4', hidden: true });
  assert.equal(out.ok, true);
  assert.match(out.html, /display: none/);
});

test('replace_color only touches the named element', () => {
  const html = '<p data-bve-id="1" style="color: #111">a</p><p data-bve-id="2" style="color: #111">b</p>';
  const out = applyTool(html, 'replace_color', { id: '1', from: '#111', to: '#c00' });
  assert.equal(out.ok, true);
  assert.match(out.html, /color: #c00">a/);
  assert.match(out.html, /color: #111">b/);
});

test('unknown ids are reported, not guessed', () => {
  const out = applyTool(HTML, 'set_text', { id: '99', text: 'x' });
  assert.equal(out.ok, false);
  assert.match(out.error, /no element/);
});
