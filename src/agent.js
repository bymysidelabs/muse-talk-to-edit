// Plan, act, verify, review.
//
// Muse Spark 1.3 picks one tool per turn. Every tool call goes through the same
// gate: apply -> deterministic verification -> roll back on failure. The model
// cannot skip verification because it is part of applying. When the model says
// it is finished, an independent reviewer (Muse Spark Open) reads the measured
// before/after facts. Three failures in total and the agent stops and asks the
// user instead of guessing.

import { respond, toolResultItems, MODEL_NAME } from './meta.js';
import { TOOL_DEFS, ALLOWED_TOOLS, applyTool, describeElements } from './tools.js';
import { verifyEdit } from './verify.js';
import { review } from './review.js';

const MAX_TURNS = 8;
const MAX_FAILURES = 3;

const INSTRUCTIONS = `You edit a small phone app for its owner, who describes the change in plain words.

How to work:
- Read the element list. Each line is: id | parent | tag.class | role | own text | measured style.
- Change only what the owner asked for. One tool per turn. Never restyle, move or rename anything else.
- Use the exact ids from the list. Never invent ids.
- After a tool result comes back verified, stop and reply in one short sentence, unless the request has another part left.
- If a tool result says the edit was rolled back, read the reason and try a different, correct call.
- If the request needs something the tools cannot do (new features, new items, logins, payments, data), do not call any tool. Say in one sentence what you cannot do.
- Reply in the owner's language.`;

function addUsage(total, raw) {
  const u = raw && raw.usage;
  if (!u) return;
  total.input += u.input_tokens || 0;
  total.output += u.output_tokens || 0;
}

export async function editOnce({ html, request, computed = {} }) {
  const started = Date.now();
  const steps = [];
  const log = (s) => steps.push({ at: Date.now() - started, ...s });
  const usage = { input: 0, output: 0 };

  let current = html;
  const applied = [];
  const verifications = [];
  let failures = 0;
  let previousResponseId;
  let reviewResult = null;

  let input = [{
    role: 'user',
    content: [{
      type: 'input_text',
      text: `Request: ${request}\n\nApp elements:\n${describeElements(html, computed)}`,
    }],
  }];

  const finish = (status, message) => ({
    status,
    message,
    html: status === 'done' ? current : html,
    proposedHtml: status === 'needs_confirmation' && applied.length ? current : null,
    applied,
    verifications,
    review: reviewResult,
    failures,
    steps,
    usage,
    model: MODEL_NAME,
    ms: Date.now() - started,
  });

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const t0 = Date.now();
    const res = await respond({ instructions: INSTRUCTIONS, input, tools: TOOL_DEFS, previousResponseId });
    addUsage(usage, res.raw);
    log({ type: 'model', turn, ms: Date.now() - t0, text: res.text, calls: res.toolCalls.map((c) => ({ name: c.name, args: c.args })) });
    previousResponseId = res.id;

    if (!res.toolCalls.length) {
      if (!applied.length) return finish('refused', res.text || 'No change was made.');

      reviewResult = await review({ request, applied, verifications });
      log({ type: 'review', ...reviewResult });
      if (reviewResult.satisfied === false) {
        failures += 1;
        if (failures >= MAX_FAILURES) {
          return finish('needs_confirmation', `The reviewer is still not satisfied: ${reviewResult.reason}`);
        }
        // Roll back what the reviewer rejected, so the retry starts from the
        // original app and a rejected change never stays behind.
        log({ type: 'rollback', undone: applied.map((x) => ({ name: x.name, args: x.args })) });
        current = html;
        applied.length = 0;
        verifications.length = 0;
        input = [{
          role: 'user',
          content: [{
            type: 'input_text',
            text: `An independent reviewer rejected the result: ${reviewResult.reason}\nThat change was rolled back, so the app is as it was at the start.\nCurrent elements:\n${describeElements(current, computed)}\nTry again with one tool call, or say that you cannot.`,
          }],
        }];
        continue;
      }
      return finish('done', res.text || 'Done.');
    }

    const results = [];
    for (const call of res.toolCalls) {
      if (!ALLOWED_TOOLS.has(call.name)) {
        failures += 1;
        log({ type: 'discarded', name: call.name, args: call.args });
        results.push({ ok: false, error: `${call.name} is not an available tool. The call was discarded.` });
        continue;
      }
      const out = applyTool(current, call.name, call.args, { computed });
      if (!out.ok) {
        failures += 1;
        log({ type: 'tool_error', name: call.name, args: call.args, error: out.error });
        results.push({ ok: false, error: out.error });
        continue;
      }
      const v = verifyEdit(current, out.html, call, { computed });
      log({ type: 'verify', name: call.name, args: call.args, pass: v.pass, checks: v.checks });
      if (!v.pass) {
        failures += 1;
        results.push({ ok: false, error: `Rolled back. Verification failed: ${v.reason}` });
        continue;
      }
      current = out.html;
      applied.push({ name: call.name, args: call.args });
      verifications.push(v);
      results.push({ ok: true, verified: v.checks.map((c) => `${c.label}: ${c.detail}`) });
    }

    if (failures >= MAX_FAILURES) {
      return finish('needs_confirmation', 'Three attempts did not pass verification, so nothing was changed. Please confirm what you want.');
    }
    input = toolResultItems(res.toolCalls, results);
  }

  return finish(applied.length ? 'needs_confirmation' : 'refused', 'Stopped at the turn limit.');
}
