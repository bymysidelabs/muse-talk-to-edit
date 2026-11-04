// Second, independent check: a separate reviewer model reads the request and the
// measured before/after facts and says whether the request is actually met.
// It runs on Muse Spark Open (open weights) through Baseten, so the model that
// edits is never the model that grades.

const BASE = process.env.REVIEW_BASE_URL || 'https://inference.baseten.co/v1';
const MODEL = process.env.REVIEW_MODEL || 'meta-models/muse-spark-open-1026';

const SYSTEM = `You review edits to a small phone app. You get the user's request and the exact
changes that were applied, with measured values. Decide only whether the request is satisfied.
Be strict about intent: "bigger" needs a clearly larger size, a text change must match what was asked,
a move must land where the user asked. Ignore how the edit was made.
Reply with JSON only: {"satisfied": true|false, "reason": "<one short sentence>"}`;

function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function review({ request, applied, verifications }) {
  const key = process.env.REVIEW_API_KEY;
  if (!key) return { satisfied: null, reason: 'reviewer not configured', model: null, ms: 0 };

  const facts = applied.map((a, i) => {
    const v = verifications[i];
    const lines = v.checks.map((c) => `  - ${c.label}: ${c.ok ? 'ok' : 'FAILED'} (${c.detail})`).join('\n');
    return `${i + 1}. ${a.name} ${JSON.stringify(a.args)}\n${lines}`;
  }).join('\n');

  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Request: ${request}\n\nApplied changes and measurements:\n${facts}` },
      ],
      // Muse Spark Open always reasons. Low effort keeps the reasoning short enough
      // that the verdict is never cut off by the token limit.
      reasoning_effort: 'low',
      max_tokens: 4000,
      temperature: 0,
    }),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    const t = await res.text();
    return { satisfied: null, reason: `reviewer error ${res.status}: ${t.slice(0, 160)}`, model: MODEL, ms };
  }
  const json = await res.json();
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  const parsed = extractJson(msg && msg.content);
  if (!parsed || typeof parsed.satisfied !== 'boolean') {
    return { satisfied: null, reason: 'reviewer gave no verdict', model: MODEL, ms };
  }
  return { satisfied: parsed.satisfied, reason: String(parsed.reason || ''), model: MODEL, ms };
}
