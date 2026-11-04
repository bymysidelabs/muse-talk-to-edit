// Deterministic post-conditions for every edit. This runs inside the apply step,
// so the model cannot skip it: an edit that fails here is rolled back and the
// reason goes back to the model as the tool result.

import { parse, childrenOf, openTagWithoutStyle } from './dom.js';

function check(label, ok, detail) {
  return { label, ok: Boolean(ok), detail };
}

function fontPx(style, computed, id) {
  if (style.fontSize) return parseFloat(style.fontSize);
  const c = computed && computed[id] && computed[id].fontSize;
  return c ? parseFloat(c) : 16;
}

/**
 * @returns {{pass: boolean, checks: Array, reason: string, changed: string[], untouched: number}}
 */
export function verifyEdit(beforeHtml, afterHtml, call, ctx = {}) {
  const before = parse(beforeHtml);
  const after = parse(afterHtml);
  const a = call.args || {};
  const target = a.id;
  const checks = [];

  // 1. Nothing appeared or vanished.
  const sameIds = before.elements.length === after.elements.length
    && before.elements.every((e) => after.byId.has(e.id));
  checks.push(check('Every element is still there', sameIds,
    `${before.elements.length} before, ${after.elements.length} after`));

  const b = before.byId.get(target);
  const t = after.byId.get(target);
  checks.push(check(`Target #${target} exists`, Boolean(b && t), b ? `${b.tag} "${b.text.slice(0, 30)}"` : 'not found'));

  // 2. The requested change actually landed.
  if (b && t) {
    switch (call.name) {
      case 'set_text':
        checks.push(check('Text changed as asked', t.text === String(a.text).replace(/\s+/g, ' ').trim(),
          `"${b.text}" -> "${t.text}"`));
        break;
      case 'set_style': {
        const want = String(a.value).trim();
        const got = t.style[a.property];
        checks.push(check(`${a.property} set`, got === want, `${b.style[a.property] || 'stylesheet'} -> ${got}`));
        break;
      }
      case 'scale_font': {
        const from = fontPx(b.style, ctx.computed, target);
        const to = parseFloat(t.style.fontSize || '0');
        const expected = Math.round(from * Number(a.factor));
        checks.push(check('Font size scaled', Math.abs(to - expected) <= 1 && to !== from,
          `${from}px -> ${to}px (x${a.factor})`));
        break;
      }
      case 'set_visibility': {
        const hidden = t.style.display === 'none';
        checks.push(check(a.hidden ? 'Element hidden' : 'Element shown', hidden === Boolean(a.hidden),
          `display: ${b.style.display || 'default'} -> ${t.style.display || 'default'}`));
        break;
      }
      case 'replace_color': {
        const block = afterHtml.slice(afterHtml.indexOf(t.openTag));
        const ok = block.includes(a.to);
        checks.push(check('Colour replaced', ok, `${a.from} -> ${a.to}`));
        break;
      }
      case 'move_element': {
        const sibsBefore = childrenOf(before, b.parentId);
        const sibsAfter = childrenOf(after, t.parentId);
        const sameParent = b.parentId === t.parentId;
        const sameSet = sibsBefore.length === sibsAfter.length && sibsBefore.every((id) => sibsAfter.includes(id));
        const iBefore = sibsBefore.indexOf(target);
        const iAfter = sibsAfter.indexOf(target);
        const wanted = { first: 0, last: sibsAfter.length - 1, up: iBefore - 1, down: iBefore + 1 }[a.direction];
        checks.push(check('Moved within the same list', sameParent && sameSet, `parent #${b.parentId}`));
        checks.push(check(`Moved ${a.direction}`, iAfter === wanted, `position ${iBefore + 1} -> ${iAfter + 1} of ${sibsAfter.length}`));
        break;
      }
      default:
        checks.push(check('Known tool', false, call.name));
    }
  }

  // 3. Nothing else changed. Every other element keeps its tag, attributes,
  //    inline style and own text. For moves, descendants of the target and its
  //    siblings may change position but not content.
  const changed = [];
  let untouched = 0;
  for (const e of before.elements) {
    if (e.id === target) continue;
    const n = after.byId.get(e.id);
    if (!n) { changed.push(e.id); continue; }
    const same = openTagWithoutStyle(n.openTag) === openTagWithoutStyle(e.openTag)
      && JSON.stringify(n.style) === JSON.stringify(e.style)
      && n.text === e.text
      && (call.name === 'move_element' || n.parentId === e.parentId);
    if (same) untouched += 1; else changed.push(e.id);
  }
  checks.push(check('No other element changed', changed.length === 0,
    changed.length ? `also changed: #${changed.join(', #')}` : `${untouched} other elements identical`));

  const failed = checks.filter((c) => !c.ok);
  return {
    pass: failed.length === 0,
    checks,
    reason: failed.map((c) => `${c.label} failed (${c.detail})`).join('; '),
    changed,
    untouched,
  };
}
