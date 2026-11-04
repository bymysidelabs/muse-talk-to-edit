// Reading test. Same model (Muse Spark 1.3), same questions, two ways:
//   raw:  the model reads every card text and works the answer out itself
//   app:  the model asks the generated app (query_records) and reports the result
// Ground truth is computed from the data by code.
//
// Usage: META_API_KEY=... node scripts/bench_read.mjs [runs=2] [concurrency=4]

import { writeFile, mkdir } from 'node:fs/promises';
import { respond } from '../src/meta.js';
import { assist } from '../src/app/agentops.js';
import { validateSpec } from '../src/app/spec.js';
import { payments, sms, LEDGER_SPEC } from '../src/demo/household.js';

const RUNS = Number(process.argv[2] || 2);
const CONCURRENCY = Number(process.argv[3] || 4);
const TODAY = '2026-11-04';

const FROM = process.env.BENCH_FROM || '2026-08-01';
const pays = payments(FROM, '2026-11-03');
const spec = validateSpec(LEDGER_SPEC).spec;
const app = {
  id: 'bench', spec, html: '', members: {}, log: [],
  entries: pays.map((p, i) => ({ id: `p${i}`, merchant: p.merchant, amount: p.amount, category: p.category, date: p.date })),
};
const member = { name: 'bench', role: 'member' };

const inRange = (p, a, b) => p.date >= a && p.date <= b;
const sum = (list) => list.reduce((s, p) => s + p.amount, 0);
const oct = (p) => inRange(p, '2026-10-01', '2026-10-31');
const sep = (p) => inRange(p, '2026-09-01', '2026-09-30');
const aug = (p) => inRange(p, '2026-08-01', '2026-08-31');

const byCatOct = {};
for (const p of pays.filter(oct)) byCatOct[p.category] = (byCatOct[p.category] || 0) + p.amount;
const topOct = Object.entries(byCatOct).sort((a, b) => b[1] - a[1])[0];

const QUESTIONS = [
  { q: '지난달(10월) 외식에 쓴 돈은 모두 얼마야?', truth: sum(pays.filter((p) => oct(p) && p.category === '외식')) },
  { q: '10월에 카페 결제는 몇 번이었어?', truth: pays.filter((p) => oct(p) && p.category === '카페').length },
  { q: '9월 전체 지출 합계는?', truth: sum(pays.filter(sep)) },
  { q: '8월부터 10월까지 식비(마트) 총액은?', truth: sum(pays.filter((p) => inRange(p, '2026-08-01', '2026-10-31') && p.category === '식비')) },
  { q: '10월에 가장 많이 쓴 분류의 금액은 얼마야? 금액만.', truth: topOct[1] },
  { q: '10월 5일부터 10월 11일까지 쓴 돈은?', truth: sum(pays.filter((p) => inRange(p, '2026-10-05', '2026-10-11'))) },
  { q: '9월에 스타벅스에서 쓴 돈은?', truth: sum(pays.filter((p) => sep(p) && p.merchant === '스타벅스')) },
  { q: '10월 교통비 합계는?', truth: sum(pays.filter((p) => oct(p) && p.category === '교통')) },
  { q: '8월에 3만원 이상 결제는 몇 건이야?', truth: pays.filter((p) => aug(p) && p.amount >= 30000).length },
  { q: '10월 외식비는 9월 외식비보다 얼마나 많거나 적어? 차이 금액만.', truth: Math.abs(sum(pays.filter((p) => oct(p) && p.category === '외식')) - sum(pays.filter((p) => sep(p) && p.category === '외식'))) },
];

// Every number in the reply; the answer counts as correct if the true value is among them.
function numbersIn(text) {
  return (String(text).match(/-?\d[\d,]*(\.\d+)?/g) || []).map((s) => Number(s.replace(/,/g, '')));
}
function correct(text, truth) {
  const nums = numbersIn(text);
  // Korean amounts are sometimes written as 만원 units, e.g. 51만 2,300원.
  const man = String(text).match(/(\d[\d,]*)\s*만\s*(\d[\d,]*)?/);
  if (man) nums.push(Number(man[1].replace(/,/g, '')) * 10000 + (man[2] ? Number(man[2].replace(/,/g, '')) : 0));
  return nums.includes(truth);
}

const RAW_TEXT = pays.map(sms).join('\n');
const RAW_INSTRUCTIONS = `You keep a household's card spending. Today is ${TODAY}. Each line is a card payment text.
Categories: 식비 (마트, 장보기), 외식 (restaurants), 카페, 교통 (taxi, fuel, transit), 생활 (관리비, 다이소, 올리브영), 쇼핑, 교육 (학원).
Answer the question with the exact number. Reply in one short Korean sentence.`;

async function runRaw(q) {
  const t0 = Date.now();
  const res = await respond({
    instructions: RAW_INSTRUCTIONS,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `Card texts:\n${RAW_TEXT}\n\nQuestion: ${q}` }] }],
    tools: [],
  });
  const u = res.raw.usage || {};
  return { text: res.text, ms: Date.now() - t0, tokens: (u.input_tokens || 0) + (u.output_tokens || 0), input: u.input_tokens || 0, output: u.output_tokens || 0 };
}

async function runApp(q) {
  const r = await assist({ app, member, message: q, today: TODAY });
  return { text: r.message, ms: r.ms, tokens: r.usage.input + r.usage.output, input: r.usage.input, output: r.usage.output, ops: r.steps.filter((s) => s.type === 'op').length };
}

const jobs = [];
for (let run = 1; run <= RUNS; run++) for (const [i, item] of QUESTIONS.entries()) for (const mode of ['raw', 'app']) jobs.push({ run, i, mode, ...item });

const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      const r = j.mode === 'raw' ? await runRaw(j.q) : await runApp(j.q);
      const ok = correct(r.text, j.truth);
      results.push({ ...j, ...r, ok });
      console.log(`${ok ? 'OK ' : 'BAD'} ${j.mode} q${j.i + 1} run${j.run} truth=${j.truth} ${(r.ms / 1000).toFixed(1)}s ${r.tokens}tok | ${String(r.text).replace(/\s+/g, ' ').slice(0, 90)}`);
    } catch (e) {
      results.push({ ...j, error: String(e.message || e), ok: false });
      console.log(`ERR ${j.mode} q${j.i + 1}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

function stats(mode) {
  const list = results.filter((r) => r.mode === mode && !r.error);
  const ms = list.map((r) => r.ms).sort((a, b) => a - b);
  return {
    correct: list.filter((r) => r.ok).length,
    total: results.filter((r) => r.mode === mode).length,
    medianSeconds: ms.length ? ms[Math.floor(ms.length / 2)] / 1000 : null,
    avgTokens: list.length ? Math.round(list.reduce((s, r) => s + r.tokens, 0) / list.length) : null,
    costUsd: Number(list.reduce((s, r) => s + r.input * 1.25e-6 + r.output * 4.25e-6, 0).toFixed(4)),
  };
}
const summary = { records: pays.length, questions: QUESTIONS.length, runs: RUNS, raw: stats('raw'), app: stats('app'), when: new Date().toISOString() };
console.log('\nSUMMARY', JSON.stringify(summary));
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(new URL(`../results/reading-${FROM}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2));
