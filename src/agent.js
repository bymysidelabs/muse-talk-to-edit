// Plan, act, verify. The model picks one tool per turn; we apply it, feed the
// result back, and stop when it says it is done or we run out of turns.

import { respond, toolResultItems, MODEL_NAME } from './meta.js';
import { TOOL_DEFS, applyTool, elementIndex } from './tools.js';

const MAX_TURNS = 6;

const INSTRUCTIONS = `You edit a small phone app for a user who describes the change in words.

Rules:
- Look at the element list and pick exactly one tool per turn.
- Only touch the element the user is talking about. Do not restyle or reorder anything else.
- Never invent element ids. Use the ids in the list.
- If the request is already satisfied, reply with "done" and call nothing.
- If the request cannot be expressed with the available tools, say what is missing in one sentence.`;

export async function editOnce({ html, request, onTool }) {
  const elements = elementIndex(html);
  let input = [{
    role: 'user',
    content: [{
      type: 'input_text',
      text: `Request: ${request}\n\nElements:\n${elements.map((e) => `${e.id}\t${e.tag}\t${e.text}`).join('\n')}`,
    }],
  }];

  let current = html;
  const applied = [];
  let previousResponseId;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await respond({
      instructions: INSTRUCTIONS,
      input,
      tools: TOOL_DEFS,
      previousResponseId,
    });

    if (!res.toolCalls.length) {
      return { html: current, applied, message: res.text || 'done', model: MODEL_NAME };
    }

    const results = [];
    for (const call of res.toolCalls) {
      const out = applyTool(current, call.name, call.args);
      if (out.ok) {
        current = out.html;
        applied.push({ name: call.name, args: call.args });
        if (onTool) onTool({ name: call.name, args: call.args, ok: true });
        results.push({ ok: true });
      } else {
        if (onTool) onTool({ name: call.name, args: call.args, ok: false, error: out.error });
        results.push({ ok: false, error: out.error });
      }
    }

    input = toolResultItems(res.toolCalls, results);
    previousResponseId = res.id;
  }

  return { html: current, applied, message: 'stopped after the turn limit', model: MODEL_NAME };
}
