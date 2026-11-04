// A small, dependency-free reader for the mini-app HTML. It only needs to know
// which marked elements exist, who their parent is, their inline style and their
// own text. That is enough to describe the app to the model and to verify edits.

export const ID_ATTR = 'data-bve-id';

const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'area', 'col', 'embed', 'wbr']);

export function camelName(key) {
  if (key.startsWith('--')) return key;
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function parseStyle(openTag) {
  const m = openTag.match(/\bstyle="([^"]*)"/);
  const out = {};
  if (!m) return out;
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[camelName(part.slice(0, i).trim())] = part.slice(i + 1).trim();
  }
  return out;
}

function attr(openTag, name) {
  const m = openTag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Parse the HTML into the list of marked elements, in document order. */
export function parse(html) {
  // Blank out script and style bodies so their contents are never read as tags.
  const masked = html.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (_, open, _t, body, close) => open + ' '.repeat(body.length) + close);

  const elements = [];
  const byId = new Map();
  const stack = []; // { tag, id }
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(masked))) {
    // text since the previous tag belongs to the innermost open element
    const text = masked.slice(last, m.index).replace(/\s+/g, ' ').trim();
    if (text && stack.length) {
      const top = stack[stack.length - 1];
      if (top.id != null) byId.get(top.id).text += (byId.get(top.id).text ? ' ' : '') + text;
    }
    last = m.index + m[0].length;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClosing = m[3] === '/' || VOID.has(tag);
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const openTag = html.slice(m.index, m.index + m[0].length);
    const id = attr(openTag, ID_ATTR);
    if (id != null) {
      let parentId = null;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].id != null) { parentId = stack[i].id; break; }
      }
      const el = {
        id,
        tag,
        parentId,
        openTag,
        style: parseStyle(openTag),
        className: attr(openTag, 'class') || '',
        action: attr(openTag, 'data-action'),
        role: attr(openTag, 'data-role'),
        text: '',
        order: elements.length,
      };
      elements.push(el);
      byId.set(id, el);
    }
    if (!selfClosing) stack.push({ tag, id });
  }
  return { elements, byId };
}

/** Child ids of a parent, in document order. */
export function childrenOf(doc, parentId) {
  return doc.elements.filter((e) => e.parentId === parentId).map((e) => e.id);
}

/** Open tag without the style attribute, for "did anything else change" checks. */
export function openTagWithoutStyle(openTag) {
  return openTag.replace(/\s*\bstyle="[^"]*"/, '');
}
