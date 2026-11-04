// Reliability gate: fixed requests, each run N times, against the café demo app.
// A run is correct when the outcome matches what a careful human editor would do:
// the right element changed and nothing else, or the agent declined when the
// request is outside its tools. A "silent wrong edit" is a Done on the wrong element.
//
// Usage: META_API_KEY=... REVIEW_API_KEY=... node scripts/gate.mjs [runs=2] [concurrency=4]

import { readFile, writeFile } from 'node:fs/promises';
import { editOnce } from '../src/agent.js';

const RUNS = Number(process.argv[2] || 2);
const CONCURRENCY = Number(process.argv[3] || 4);
const html = await readFile(new URL('../demo/app.html', import.meta.url), 'utf8');
const computed = JSON.parse(await readFile(new URL('../demo/app.computed.json', import.meta.url), 'utf8'));

const CASES = [
  { q: '주문하기 버튼을 더 크게 해줘', expect: 'done', targets: ['22'] },
  { q: '영업시간을 09:00 - 21:00으로 바꿔줘', expect: 'done', targets: ['3'] },
  { q: '카페라떼를 메뉴 맨 위로 올려줘', expect: 'done', targets: ['10'] },
  { q: '바닐라라떼는 당분간 숨겨줘', expect: 'done', targets: ['15'] },
  { q: '가게 이름을 "골목 커피 울산점"으로 바꿔줘', expect: 'done', targets: ['2'] },
  { q: '주문하기 버튼 색을 초록색으로 바꿔줘', expect: 'done', targets: ['22'] },
  { q: '아메리카노 가격을 3,800원으로 바꿔줘', expect: 'done', targets: ['8'] },
  { q: '영업시간 글씨를 조금 작게 해줘', expect: 'done', targets: ['3'] },
  { q: '메뉴에 케이크를 추가해줘', expect: 'declined', targets: [] },
  { q: '카드 결제 기능 넣어줘', expect: 'declined', targets: [] },
];

const jobs = [];
for (let r = 0; r < RUNS; r++) for (const c of CASES) jobs.push({ ...c, run: r + 1 });

const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    let out;
    try {
      out = await editOnce({ html, request: job.q, computed });
    } catch (e) {
      results.push({ ...job, status: 'error', error: String(e.message || e), correct: false, silentWrong: false, ms: 0 });
      continue;
    }
    const touched = [...new Set(out.applied.map((a) => String(a.args.id)))];
    const declined = out.status === 'refused' || (out.status === 'needs_confirmation' && !out.applied.length);
    const rightTargets = touched.length > 0 && touched.every((id) => job.targets.includes(id));
    const correct = job.expect === 'declined' ? declined : (out.status === 'done' && rightTargets);
    const silentWrong = out.status === 'done' && !rightTargets;
    results.push({
      ...job, status: out.status, touched, tools: out.applied.map((a) => a.name),
      failures: out.failures, review: out.review && out.review.satisfied, ms: out.ms,
      tokens: out.usage, correct, silentWrong, message: (out.message || '').slice(0, 80),
    });
    console.log(`${correct ? 'PASS' : 'FAIL'} run${job.run} ${job.q} -> ${out.status} ${touched.join(',')} ${out.applied.map((a) => a.name).join(',')} ${(out.ms / 1000).toFixed(1)}s retries=${out.failures}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const ms = results.map((r) => r.ms).filter(Boolean).sort((a, b) => a - b);
const median = ms[Math.floor(ms.length / 2)];
const p90 = ms[Math.floor(ms.length * 0.9)];
const tokIn = results.reduce((s, r) => s + ((r.tokens && r.tokens.input) || 0), 0);
const tokOut = results.reduce((s, r) => s + ((r.tokens && r.tokens.output) || 0), 0);
const summary = {
  runs: results.length,
  correct: results.filter((r) => r.correct).length,
  silentWrongEdits: results.filter((r) => r.silentWrong).length,
  errors: results.filter((r) => r.status === 'error').length,
  medianSeconds: median / 1000,
  p90Seconds: p90 / 1000,
  costUsd: Number((tokIn * 1.25e-6 + tokOut * 4.25e-6).toFixed(4)),
  when: new Date().toISOString(),
};
console.log('\nSUMMARY', JSON.stringify(summary));
await writeFile(new URL('../results/gate.json', import.meta.url), JSON.stringify({ summary, results }, null, 2));
