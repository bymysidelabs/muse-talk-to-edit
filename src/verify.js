// Deterministic post-conditions for every edit. This runs inside the apply step,
// so the model cannot skip it: an edit that fails here is rolled back and the
// reason goes back to the model as the tool result.

import { parse, childrenOf, openTagWithoutStyle } from './dom.js';

function check(label, ok, detail) {
  return { label, ok: Boolean(ok), detail };
}

// Colour contrast (WCAG relative luminance). Unknown colour words are skipped, not guessed.
const NAMED = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  gray: [128, 128, 128], grey: [128, 128, 128], orange: [255, 165, 0], yellow: [255, 255, 0], purple: [128, 0, 128],
  pink: [255, 192, 203], brown: [165, 42, 42], navy: [0, 0, 128], teal: [0, 128, 128], darkgreen: [0, 100, 0],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211], darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
};
export function parseColor(v) {
  const s = String(v || '').trim().toLowerCase();
  if (NAMED[s]) return { rgb: NAMED[s], a: 1 };
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return { rgb: [...m[1]].map((c) => parseInt(c + c, 16)), a: 1 };
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return { rgb: [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)), a: 1 };
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(c1, c2) {
  const [hi, lo] = [luminance(c1), luminance(c2)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** The colour behind an element: its own background, or the nearest parent that has one. */
function backgroundOf(id, byId, computed) {
  let cur = id;
  for (let i = 0; i < 30 && cur != null; i++) {
    const c = computed && computed[cur] && parseColor(computed[cur].backgroundColor);
    if (c && c.a > 0.5) return c.rgb;
    cur = byId.get(cur) ? byId.get(cur).parentId : null;
  }
  return [253, 252, 249];
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
        // A colour change must leave the element's text readable.
        if ((a.property === 'color' || a.property === 'backgroundColor') && b.text && ctx.computed && ctx.computed[target]) {
          const fg = a.property === 'color' ? parseColor(want) : parseColor(ctx.computed[target].color);
          const bg = a.property === 'backgroundColor' ? parseColor(want) : { rgb: backgroundOf(target, before.byId, ctx.computed) };
          if (fg && bg) {
            const ratio = contrast(fg.rgb, bg.rgb);
            checks.push(check('Text stays readable', ratio >= 3, `contrast ${ratio.toFixed(1)}:1, needs 3:1`));
          }
        }
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
