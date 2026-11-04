// The agent side of generated apps, all on Muse Spark 1.3:
//  - propose(): read what the user has been doing, spot the repeated chore,
//    and write an app spec (never code) for it.
//  - assist(): act inside an app with the app's own operations. A new bank
//    text becomes one add_record call; a question becomes one query_records
//    call, so the model never adds numbers up itself.

import { respond, toolResultItems } from '../meta.js';
import { SPEC_SCHEMA, validateSpec } from './spec.js';
import { addEntry, updateEntry, query, can } from './ops.js';

function usageOf(total, raw) {
  const u = raw && raw.usage;
  if (!u) return;
  total.input += u.input_tokens || 0;
  total.output += u.output_tokens || 0;
  total.cached += (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
}

const PROPOSE_INSTRUCTIONS = `You look at what a person has been doing lately and find the chore they repeat most.
Then you design one small app that turns that chore into a one-tap job for them and a one-call job for you.

Rules:
- Write a spec with the propose_app tool. Never write code.
- Pick the single most repeated chore. Count how often it happens in what you were given and mention that count.
- One kind of record. Use money for amounts, date for dates, enum for a short fixed list of categories, bool for on/off states such as sold out.
- Add two to four summary cards the person would check every day. Add quick buttons only for entries that repeat with the same values.
- Field keys are lowercase ascii. Labels, title and categories are in the person's language.
- Write plainly. Do not use the middle dot character; join words with 와/과 or a comma instead.
- After the tool result comes back ok, reply with two short sentences in the person's language: what repeats and how often, and what the app does about it.`;

export async function propose({ history, lang = 'ko' }) {
  const usage = { input: 0, output: 0, cached: 0 };
  const steps = [];
  const started = Date.now();
  let input = [{ role: 'user', content: [{ type: 'input_text', text: `Recent activity (${lang}):\n${history}` }] }];
  let previousResponseId;
  let spec = null;
  let failures = 0;

  for (let turn = 1; turn <= 5; turn++) {
    const t0 = Date.now();
    const res = await respond({
      instructions: PROPOSE_INSTRUCTIONS,
      input,
      tools: [{ name: 'propose_app', description: 'Propose the app as a spec. The app is built from this spec by a fixed renderer.', parameters: SPEC_SCHEMA }],
      previousResponseId,
    });
    usageOf(usage, res.raw);
    previousResponseId = res.id;
    steps.push({ type: 'model', turn, ms: Date.now() - t0, text: res.text, calls: res.toolCalls.map((c) => c.name) });
    if (!res.toolCalls.length) {
      return { ok: Boolean(spec), spec, message: res.text, steps, usage, ms: Date.now() - started };
    }
    const results = res.toolCalls.map((call) => {
      if (call.name !== 'propose_app') { failures++; return { ok: false, error: 'unknown tool' }; }
      const v = validateSpec(call.args);
      steps.push({ type: 'validate', ok: v.ok, errors: v.errors || [] });
      if (!v.ok) { failures++; return { ok: false, error: `Spec rejected: ${v.errors.join('; ')}` }; }
      spec = v.spec;
      return { ok: true, fields: spec.entity.fields.map((f) => f.key), summaries: spec.summaries.length };
    });
    if (failures >= 3) return { ok: false, spec: null, message: 'Could not produce a valid spec.', steps, usage, ms: Date.now() - started };
    input = toolResultItems(res.toolCalls, results);
  }
  return { ok: Boolean(spec), spec, message: '', steps, usage, ms: Date.now() - started };
}

function appTools(app) {
  const fields = app.spec.entity.fields;
  const props = Object.fromEntries(fields.map((f) => {
    const p = { description: f.label };
    if (f.type === 'money' || f.type === 'number') p.type = 'number';
    else if (f.type === 'bool') p.type = 'boolean';
    else p.type = 'string';
    if (f.type === 'enum') p.enum = f.options;
    if (f.type === 'date') p.description += ' (YYYY-MM-DD)';
    return [f.key, p];
  }));
  return [
    {
      name: 'add_record',
      description: `Add one ${app.spec.entity.name}.`,
      parameters: { type: 'object', properties: { values: { type: 'object', properties: props } }, required: ['values'] },
    },
    {
      name: 'update_record',
      description: `Change fields of one existing ${app.spec.entity.name} by id.`,
      parameters: { type: 'object', properties: { id: { type: 'string' }, values: { type: 'object', properties: props } }, required: ['id', 'values'] },
    },
    {
      name: 'query_records',
      description: 'Read records. Use this for every number you report: totals, counts, lists. Never add numbers up yourself.',
      parameters: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['sum', 'count', 'list'] },
          field: { type: 'string', description: 'money or number field, for sum' },
          where: { type: 'object', description: 'filters: exact {field: value}, {field: {"contains": "text"}}, {field: {"gte": n}}, {field: {"lte": n}}, {field: {"in": [..]}}' },
          from: { type: 'string', description: 'first date, YYYY-MM-DD, inclusive' },
          to: { type: 'string', description: 'last date, YYYY-MM-DD, inclusive' },
          group_by: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['op'],
      },
    },
  ];
}

function describeApp(app) {
  const f = app.spec.entity.fields.map((x) => `${x.key} (${x.type}${x.options ? ': ' + x.options.join('/') : ''}) "${x.label}"`).join(', ');
  return `App "${app.spec.title}". Each record is a ${app.spec.entity.name} with fields: ${f}.`;
}

export async function assist({ app, member, message, today = new Date().toISOString().slice(0, 10) }) {
  const usage = { input: 0, output: 0, cached: 0 };
  const steps = [];
  const started = Date.now();
  const instructions = `You work inside one app on behalf of ${member.name} (role: ${member.role}). Today is ${today}.
${describeApp(app)}

Rules:
- If you are given a new item such as a bank or card text, add it with one add_record call. Pick the category from the options.
- Get every total, count and list from query_records. Never add up records yourself.
- Simple arithmetic between query results is fine (a difference, an average). Show the numbers you used.
- Resolve dates like "this month" or "last week" into from/to yourself, using today's date.
- If an operation is refused, say so plainly. Do not try a workaround.
- Reply in one or two short sentences in the user's language.`;

  let input = [{ role: 'user', content: [{ type: 'input_text', text: message }] }];
  let previousResponseId;
  for (let turn = 1; turn <= 5; turn++) {
    const t0 = Date.now();
    const res = await respond({ instructions, input, tools: appTools(app), previousResponseId });
    usageOf(usage, res.raw);
    previousResponseId = res.id;
    steps.push({ type: 'model', turn, ms: Date.now() - t0, text: res.text, calls: res.toolCalls.map((c) => ({ name: c.name, args: c.args })) });
    if (!res.toolCalls.length) return { ok: true, message: res.text, steps, usage, ms: Date.now() - started };
    const results = res.toolCalls.map((call) => {
      const a = call.args || {};
      let r;
      if (call.name === 'add_record') r = addEntry(app, member, a.values, 'agent');
      else if (call.name === 'update_record') r = updateEntry(app, member, a.id, a.values, 'agent');
      else if (call.name === 'query_records') r = query(app, member, a);
      else r = { ok: false, error: `${call.name} is not available` };
      steps.push({ type: 'op', name: call.name, args: a, ok: r.ok, result: r.ok ? summarize(r) : r.error });
      return r;
    });
    input = toolResultItems(res.toolCalls, results);
  }
  return { ok: false, message: 'Stopped at the turn limit.', steps, usage, ms: Date.now() - started };
}

function summarize(r) {
  if (r.record) return { id: r.record.id };
  if (r.groups) return { groups: r.groups.slice(0, 6), matched: r.matched };
  if (r.records) return { matched: r.matched, shown: r.records.length };
  return { value: r.value, matched: r.matched };
}

export { can };
