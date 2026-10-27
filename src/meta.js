// Minimal client for the Meta Model API Responses endpoint, plus the tool-call loop.
// Docs: https://dev.meta.ai/docs/protocols/responses

const BASE = process.env.META_BASE_URL || 'https://api.meta.ai/v1';
const MODEL = process.env.META_MODEL || 'muse-spark-1.3';

function apiKey() {
  const key = process.env.META_API_KEY;
  if (!key) throw new Error('META_API_KEY is not set');
  return key;
}

async function createResponse(body) {
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

function collectToolCalls(json) {
  const calls = [];
  for (const item of json.output || []) {
    if (item.type === 'function_call') {
      calls.push({
        callId: item.call_id || item.id,
        name: item.name,
        args: safeJson(item.arguments),
      });
    }
  }
  return calls;
}

function outputText(json) {
  const parts = [];
  for (const item of json.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text' && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

function safeJson(s) {
  if (typeof s !== 'string') return s || {};
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * One agent turn.
 * @param {object} opts
 * @param {string} opts.instructions system-level guidance
 * @param {Array}  opts.input previous items (replayed, including tool outputs)
 * @param {Array}  opts.tools tool definitions
 * @returns {Promise<{text: string, toolCalls: Array, raw: object}>}
 */
export async function respond({ instructions, input, tools, previousResponseId }) {
  const body = {
    model: MODEL,
    instructions,
    input,
    tools: tools.map((t) => ({ type: 'function', ...t })),
    reasoning: { effort: 'low' },
    store: true,
  };
  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }
  const json = await createResponse(body);
  return { text: outputText(json), toolCalls: collectToolCalls(json), raw: json, id: json.id };
}

export function toolResultItems(toolCalls, results) {
  return toolCalls.map((call, i) => ({
    type: 'function_call_output',
    call_id: call.callId,
    output: JSON.stringify(results[i]),
  }));
}

export const MODEL_NAME = MODEL;
