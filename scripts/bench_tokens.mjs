// Token test. Same model (Muse Spark 1.3), same requests, two ways of working:
//   code:  the usual way. The model writes the whole app, and rewrites the whole
//          file for every change.
//   ours:  the model writes a spec for the app, and picks one checked tool per change.
// Records tokens and time for each, plus whether the rewritten file still has
// every element it had before (a cheap sign that nothing else was lost).
//
// Usage: META_API_KEY=... node scripts/bench_tokens.mjs [concurrency=4]

import { readFile, writeFile } from 'node:fs/promises';
import { respond } from '../src/meta.js';
import { editOnce } from '../src/agent.js';
import { propose } from '../src/app/agentops.js';
import { validateSpec } from '../src/app/spec.js';
import { renderShell } from '../src/app/render.js';
import { LEDGER_SPEC, recentActivity } from '../src/demo/household.js';

const CONCURRENCY = Number(process.argv[2] || 4);
const cafe = await readFile(new URL('../demo/app.html', import.meta.url), 'utf8');
const cafeComputed = JSON.parse(await readFile(new URL('../demo/app.computed.json', import.meta.url), 'utf8'));
const ledger = renderShell(validateSpec(LEDGER_SPEC).spec);
const history = recentActivity();

const EDITS = [
  { app: 'cafe', q: '주문하기 버튼을 더 크게 해줘' },
  { app: 'cafe', q: '영업시간을 09:00 - 21:00으로 바꿔줘' },
  { app: 'cafe', q: '카페라떼를 메뉴 맨 위로 올려줘' },
  { app: 'cafe', q: '주문하기 버튼 색을 초록색으로 바꿔줘' },
  { app: 'ledger', q: '추가 버튼 색을 초록색으로 바꿔줘' },
  { app: 'ledger', q: '이번 달 외식 카드 글씨를 더 크게 해줘' },
  { app: 'ledger', q: '앱 제목을 "우리 가족 가계부"로 바꿔줘' },
];

const count = (html) => (String(html).match(/data-bve-id="/g) || []).length;
const tok = (u) => ({ input: (u && u.input_tokens) || 0, output: (u && u.output_tokens) || 0 });
const cost = (t) => t.input * 1.25e-6 + t.output * 4.25e-6;
function stripFence(t) {
  const m = String(t).match(/```(?:html)?\s*([\s\S]*?)```/);
  return m ? m[1] : String(t);
}

async function editCode(html, q) {
  const t0 = Date.now();
  const res = await respond({
    instructions: 'You edit a small phone app. Apply the change the user asks for and return the complete updated HTML file, nothing else.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: `App:\n${html}\n\nChange: ${q}` }] }],
    tools: [],
  });
  const out = stripFence(res.text);
  return { ms: Date.now() - t0, tokens: tok(res.raw.usage), keptAll: count(out) === count(html) };
}

async function editOurs(html, q, computed) {
  const t0 = Date.now();
  const r = await editOnce({ html, request: q, computed });
  return { ms: Date.now() - t0, tokens: { input: r.usage.input, output: r.usage.output }, status: r.status };
}

async function buildCode() {
  const t0 = Date.now();
  const res = await respond({
    instructions: `You look at what a person has been doing lately and find the chore they repeat most.
Then build one small phone app that turns that chore into a one-tap job. Return the complete app as a single HTML file with inline CSS and JavaScript, nothing else.`,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `Recent activity (ko):\n${history}` }] }],
    tools: [],
  });
  return { ms: Date.now() - t0, tokens: tok(res.raw.usage), bytes: stripFence(res.text).length };
}

async function buildOurs() {
  const r = await propose({ history });
  return { ms: r.ms, tokens: { input: r.usage.input, output: r.usage.output }, ok: Boolean(r.spec) };
}

const jobs = [];
for (const e of EDITS) {
  const html = e.app === 'cafe' ? cafe : ledger;
  const computed = e.app === 'cafe' ? cafeComputed : {};
  jobs.push({ kind: 'edit', way: 'code', ...e, run: () => editCode(html, e.q) });
  jobs.push({ kind: 'edit', way: 'ours', ...e, run: () => editOurs(html, e.q, computed) });
}
for (let i = 1; i <= 2; i++) {
  jobs.push({ kind: 'build', way: 'code', q: `build ${i}`, run: buildCode });
  jobs.push({ kind: 'build', way: 'ours', q: `build ${i}`, run: buildOurs });
}

const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      const r = await j.run();
      const total = r.tokens.input + r.tokens.output;
      results.push({ kind: j.kind, way: j.way, app: j.app, q: j.q, ...r, total, costUsd: Number(cost(r.tokens).toFixed(5)) });
      console.log(`${j.kind} ${j.way.padEnd(4)} ${String(j.app || '').padEnd(6)} ${total} tok (in ${r.tokens.input} / out ${r.tokens.output}) ${(r.ms / 1000).toFixed(1)}s ${r.keptAll === false ? 'LOST ELEMENTS ' : ''}${r.status || ''} | ${j.q}`);
    } catch (e) {
      results.push({ kind: j.kind, way: j.way, q: j.q, error: String(e.message || e) });
      console.log(`ERR ${j.kind} ${j.way} ${j.q}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

function sum(kind, way) {
  const list = results.filter((r) => r.kind === kind && r.way === way && !r.error);
  const ms = list.map((r) => r.ms).sort((a, b) => a - b);
  return {
    n: list.length,
    avgTokens: Math.round(list.reduce((s, r) => s + r.total, 0) / (list.length || 1)),
    avgOutput: Math.round(list.reduce((s, r) => s + r.tokens.output, 0) / (list.length || 1)),
    medianSeconds: ms.length ? ms[Math.floor(ms.length / 2)] / 1000 : null,
    costUsd: Number(list.reduce((s, r) => s + r.costUsd, 0).toFixed(4)),
    ...(kind === 'edit' && way === 'code' ? { lostElements: list.filter((r) => r.keptAll === false).length } : {}),
  };
}
const summary = {
  edit: { code: sum('edit', 'code'), ours: sum('edit', 'ours') },
  build: { code: sum('build', 'code'), ours: sum('build', 'ours') },
  appBytes: { cafe: cafe.length, ledger: ledger.length },
  when: new Date().toISOString(),
};
console.log('\nSUMMARY', JSON.stringify(summary));
await writeFile(new URL('../results/tokens.json', import.meta.url), JSON.stringify({ summary, results }, null, 2));
