// Deterministic edit operations on a mini-app's HTML string.
// Every element carries data-bve-id="N". The model may only call these tools.

const ID_ATTR = 'data-bve-id';

const STYLE_WHITELIST = new Set([
  'fontSize', 'fontWeight', 'color', 'background', 'backgroundColor',
  'padding', 'margin', 'marginTop', 'borderRadius', 'width', 'height',
  'textAlign', 'opacity', 'gap', 'border', 'boxShadow',
]);

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function findTag(html, id) {
  const re = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*${ID_ATTR}="${escapeRe(id)}"[^>]*>`, 'g');
  const m = re.exec(html);
  if (!m) return null;
  const tag = m[1];
  const openStart = m.index;
  const openEnd = m.index + m[0].length;
  const tagRe = new RegExp(`<(/?)${escapeRe(tag)}\\b[^>]*>`, 'g');
  tagRe.lastIndex = openEnd;
  let depth = 1, t;
  while ((t = tagRe.exec(html))) {
    if (t[1] === '/') depth--;
    else if (!t[0].endsWith('/>')) depth++;
    if (depth === 0) {
      return { tag, openStart, openEnd, closeStart: t.index, closeEnd: t.index + t[0].length, openTag: m[0] };
    }
  }
  return { tag, openStart, openEnd, closeStart: html.length, closeEnd: html.length, openTag: m[0] };
}

// Keys are kept in camelCase inside this module and converted back to kebab-case on write.
function camelName(key) {
  if (key.startsWith('--')) return key;
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function readStyle(openTag) {
  const m = openTag.match(/style="([^"]*)"/);
  const out = {};
  if (!m) return out;
  for (const part of m[1].split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    out[camelName(part.slice(0, idx).trim())] = part.slice(idx + 1).trim();
  }
  return out;
}

// Inline CSS in an HTML attribute is kebab-case, so camelCase keys have to be converted.
function cssName(key) {
  if (key.startsWith('--')) return key;
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function writeStyle(openTag, style) {
  const body = Object.entries(style)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${cssName(k)}: ${v}`)
    .join('; ');
  if (/style="[^"]*"/.test(openTag)) return openTag.replace(/style="[^"]*"/, `style="${body}"`);
  return openTag.replace(/>$/, ` style="${body}">`);
}

function replaceOpenTag(html, found, newOpenTag) {
  return html.slice(0, found.openStart) + newOpenTag + html.slice(found.openEnd);
}

function elementHtml(html, id) {
  const f = findTag(html, id);
  if (!f) return null;
  return html.slice(f.openStart, f.closeEnd);
}

export const TOOL_DEFS = [
  {
    name: 'set_text',
    description: 'Replace the visible text of one element. Fails if the element has child elements.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, text: { type: 'string' } },
      required: ['id', 'text'],
    },
  },
  {
    name: 'set_style',
    description: 'Set one CSS property on one element. Properties outside the whitelist are rejected.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, property: { type: 'string' }, value: { type: 'string' } },
      required: ['id', 'property', 'value'],
    },
  },
  {
    name: 'scale_font',
    description: 'Multiply the element font size by a factor between 0.5 and 2.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, factor: { type: 'number' } },
      required: ['id', 'factor'],
    },
  },
  {
    name: 'move_element',
    description: 'Move an element among its siblings.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down', 'first', 'last'] } },
      required: ['id', 'direction'],
    },
  },
  {
    name: 'set_visibility',
    description: 'Show or hide an element.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, hidden: { type: 'boolean' } },
      required: ['id', 'hidden'],
    },
  },
  {
    name: 'swap_elements',
    description: 'Swap two elements in place.',
    parameters: {
      type: 'object',
      properties: { id_a: { type: 'string' }, id_b: { type: 'string' } },
      required: ['id_a', 'id_b'],
    },
  },
  {
    name: 'duplicate_element',
    description: 'Copy an element right after itself. The copy carries no id until the next load.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'replace_color',
    description: 'Replace one colour value with another inside a single element.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
      required: ['id', 'from', 'to'],
    },
  },
];

export function applyTool(html, name, args) {
  const a = args || {};
  const needsElement = ['set_text', 'set_style', 'scale_font', 'move_element', 'set_visibility', 'duplicate_element', 'replace_color'];
  const found = a.id != null ? findTag(html, a.id) : null;
  if (needsElement.includes(name) && !found) {
    return { ok: false, error: `no element with ${ID_ATTR}="${a.id}"` };
  }

  try {
    switch (name) {
      case 'set_text': {
        const inner = html.slice(found.openEnd, found.closeStart);
        if (/<[a-zA-Z]/.test(inner)) return { ok: false, error: 'element has child elements; set_text would delete them' };
        return { ok: true, html: html.slice(0, found.openEnd) + String(a.text) + html.slice(found.closeStart) };
      }
      case 'set_style': {
        if (!STYLE_WHITELIST.has(a.property)) return { ok: false, error: `property ${a.property} is not allowed` };
        const style = readStyle(found.openTag);
        style[a.property] = String(a.value);
        return { ok: true, html: replaceOpenTag(html, found, writeStyle(found.openTag, style)) };
      }
      case 'scale_font': {
        const factor = Number(a.factor);
        if (!(factor >= 0.5 && factor <= 2)) return { ok: false, error: 'factor must be between 0.5 and 2' };
        const style = readStyle(found.openTag);
        const current = parseFloat(style.fontSize || '16');
        style.fontSize = `${Math.round(current * factor)}px`;
        return { ok: true, html: replaceOpenTag(html, found, writeStyle(found.openTag, style)) };
      }
      case 'set_visibility': {
        const style = readStyle(found.openTag);
        style.display = a.hidden ? 'none' : '';
        return { ok: true, html: replaceOpenTag(html, found, writeStyle(found.openTag, style)) };
      }
      case 'replace_color': {
        const block = elementHtml(html, a.id);
        if (!block.includes(a.from)) return { ok: false, error: `${a.from} does not appear in that element` };
        const replaced = block.split(a.from).join(a.to);
        return { ok: true, html: html.slice(0, found.openStart) + replaced + html.slice(found.closeEnd) };
      }
      case 'duplicate_element': {
        const block = elementHtml(html, a.id);
        const copy = block.replace(new RegExp(`${ID_ATTR}="[^"]*"`), '');
        return { ok: true, html: html.slice(0, found.closeEnd) + copy + html.slice(found.closeEnd) };
      }
      case 'swap_elements': {
        const blockA = elementHtml(html, a.id_a);
        const blockB = elementHtml(html, a.id_b);
        if (blockA == null || blockB == null) return { ok: false, error: 'element not found' };
        const fa = findTag(html, a.id_a);
        const fb = findTag(html, a.id_b);
        if (fa.openStart >= fb.openStart && fa.openStart < fb.closeEnd) return { ok: false, error: 'elements are nested' };
        if (fb.openStart >= fa.openStart && fb.openStart < fa.closeEnd) return { ok: false, error: 'elements are nested' };
        if (fa.openStart < fb.openStart) {
          return { ok: true, html: html.slice(0, fa.openStart) + blockB + html.slice(fa.closeEnd, fb.openStart) + blockA + html.slice(fb.closeEnd) };
        }
        return { ok: true, html: html.slice(0, fb.openStart) + blockA + html.slice(fb.closeEnd, fa.openStart) + blockB + html.slice(fa.closeEnd) };
      }
      case 'move_element': {
        const parent = findParent(html, found.openStart);
        if (!parent) return { ok: false, error: 'cannot move a root element' };
        const sibs = siblingSpans(html, parent, found.tag);
        const idx = sibs.findIndex((s) => s.start <= found.openStart && found.openStart < s.end);
        if (idx < 0) return { ok: false, error: 'element is not a direct child of its container' };
        if (a.direction === 'up' && idx === 0) return { ok: false, error: 'already first' };
        if (a.direction === 'down' && idx === sibs.length - 1) return { ok: false, error: 'already last' };
        const block = elementHtml(html, a.id);
        const without = html.slice(0, sibs[idx].start) + html.slice(sibs[idx].end);
        let insertAt;
        if (a.direction === 'first') insertAt = sibs[0].start;
        else if (a.direction === 'last') insertAt = sibs[sibs.length - 1].end;
        else if (a.direction === 'up') insertAt = sibs[idx - 1].start;
        else insertAt = sibs[idx + 1].end;
        const at = insertAt > sibs[idx].start ? insertAt - block.length : insertAt;
        return { ok: true, html: without.slice(0, at) + block + without.slice(at) };
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function findParent(html, offset) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m.index >= offset) break;
    if (m[3] === '/') continue;
    if (m[1] === '/') { stack.pop(); continue; }
    stack.push({ tag: m[2], afterOpen: m.index + m[0].length });
  }
  const open = stack.filter((s) => !['br', 'img', 'input', 'meta', 'link', 'hr'].includes(s.tag));
  return open.length ? open[open.length - 1] : null;
}

function siblingSpans(html, parent, childTag) {
  const re = new RegExp(`<(/?)${escapeRe(childTag)}\\b[^>]*?(\\/?)>`, 'g');
  re.lastIndex = parent.afterOpen;
  const spans = [];
  let depth = 0, start = null, m;
  while ((m = re.exec(html))) {
    if (m[2] === '/') continue;
    if (m[1] === '/') {
      depth--;
      if (depth === 0 && start != null) {
        spans.push({ start, end: m.index + m[0].length });
        start = null;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return spans;
}

export function elementIndex(html) {
  const out = [];
  const re = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*${ID_ATTR}="([^"]+)"[^>]*>`, 'g');
  let m;
  while ((m = re.exec(html))) {
    const openEnd = m.index + m[0].length;
    const text = html.slice(openEnd).split('<')[0].trim().slice(0, 80);
    out.push({ id: m[2], tag: m[1], text });
  }
  return out;
}
