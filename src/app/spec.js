// An app spec is what the agent writes instead of code. The renderer turns a
// valid spec into a working app, so every generated app has the same, tested
// runtime and the same verifiable structure.

export const FIELD_TYPES = ['text', 'money', 'number', 'date', 'enum', 'bool'];
export const SUMMARY_OPS = ['sum', 'count'];
export const PERIODS = ['all', 'month', 'week', 'today'];

// JSON schema handed to the model as the propose_app tool parameters.
export const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'app name shown at the top, in the user\'s language' },
    subtitle: { type: 'string', description: 'one short line under the title' },
    entity: {
      type: 'object',
      description: 'the one kind of record this app keeps',
      properties: {
        name: { type: 'string', description: 'singular noun, e.g. 지출 or 메뉴' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'lowercase ascii, e.g. amount' },
              label: { type: 'string' },
              type: { type: 'string', enum: FIELD_TYPES },
              options: { type: 'array', items: { type: 'string' }, description: 'only for enum' },
            },
            required: ['key', 'label', 'type'],
          },
        },
      },
      required: ['name', 'fields'],
    },
    summaries: {
      type: 'array',
      description: 'numbers shown as cards at the top',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          op: { type: 'string', enum: SUMMARY_OPS },
          field: { type: 'string', description: 'money or number field for sum' },
          period: { type: 'string', enum: PERIODS },
          where: { type: 'object', description: 'optional exact-match filter, e.g. {"category":"외식"}' },
        },
        required: ['label', 'op', 'period'],
      },
    },
    quick: {
      type: 'array',
      description: 'one-tap buttons for the most repeated entries; each fills some fields',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, preset: { type: 'object' } },
        required: ['label', 'preset'],
      },
    },
  },
  required: ['title', 'entity', 'summaries'],
};

const KEY = /^[a-z][a-z0-9_]{0,23}$/;

/** Validate and normalise a spec. Returns { ok, spec } or { ok:false, errors }. */
export function validateSpec(input) {
  const errors = [];
  const s = input && typeof input === 'object' ? input : {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const spec = {
    title: str(s.title, 40),
    subtitle: str(s.subtitle, 80),
    entity: { name: str(s.entity && s.entity.name, 20), fields: [] },
    summaries: [],
    quick: [],
  };
  if (!spec.title) errors.push('title is required');
  if (!spec.entity.name) errors.push('entity.name is required');

  const fields = Array.isArray(s.entity && s.entity.fields) ? s.entity.fields : [];
  const seen = new Set();
  for (const f of fields.slice(0, 8)) {
    const key = str(f && f.key, 24).toLowerCase();
    const type = f && f.type;
    if (!KEY.test(key)) { errors.push(`field key "${key}" must be lowercase ascii`); continue; }
    if (seen.has(key)) { errors.push(`duplicate field ${key}`); continue; }
    if (!FIELD_TYPES.includes(type)) { errors.push(`field ${key} has unknown type ${type}`); continue; }
    const field = { key, label: str(f.label, 20) || key, type };
    if (type === 'enum') {
      field.options = (Array.isArray(f.options) ? f.options : []).map((o) => str(o, 20)).filter(Boolean).slice(0, 12);
      if (!field.options.length) { errors.push(`enum field ${key} needs options`); continue; }
    }
    seen.add(key);
    spec.entity.fields.push(field);
  }
  if (!spec.entity.fields.length) errors.push('entity needs at least one field');
  const byKey = Object.fromEntries(spec.entity.fields.map((f) => [f.key, f]));

  for (const m of (Array.isArray(s.summaries) ? s.summaries : []).slice(0, 4)) {
    const op = m && m.op;
    const period = (m && m.period) || 'all';
    if (!SUMMARY_OPS.includes(op) || !PERIODS.includes(period)) { errors.push('summary has unknown op or period'); continue; }
    const sum = { label: str(m.label, 20) || op, op, period };
    if (op === 'sum') {
      const f = byKey[m.field];
      if (!f || !['money', 'number'].includes(f.type)) { errors.push(`summary "${sum.label}" must sum a money or number field`); continue; }
      sum.field = f.key;
    }
    const where = cleanWhere(m.where, byKey);
    if (where === null) { errors.push(`summary "${sum.label}" filters on an unknown field`); continue; }
    if (Object.keys(where).length) sum.where = where;
    spec.summaries.push(sum);
  }

  for (const q of (Array.isArray(s.quick) ? s.quick : []).slice(0, 4)) {
    const preset = cleanWhere(q && q.preset, byKey);
    if (!preset || !Object.keys(preset).length) continue;
    spec.quick.push({ label: str(q.label, 16) || 'Add', preset });
  }

  return errors.length ? { ok: false, errors } : { ok: true, spec };
}

function cleanWhere(w, byKey) {
  if (w == null) return {};
  if (typeof w !== 'object' || Array.isArray(w)) return null;
  const out = {};
  for (const [k, v] of Object.entries(w)) {
    const f = byKey[k];
    if (!f) return null;
    if (f.type === 'enum' && !f.options.includes(String(v))) return null;
    out[k] = f.type === 'bool' ? Boolean(v) : (['money', 'number'].includes(f.type) ? Number(v) : String(v));
  }
  return out;
}
