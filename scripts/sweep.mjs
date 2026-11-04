// Reliability sweep: run a fixed list of requests and report what happened.
// Usage: META_API_KEY=... node scripts/sweep.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { editOnce } from '../src/agent.js';
import { elementIndex } from '../src/tools.js';

const FILE = path.resolve('demo/app.html');
const REQUESTS = [
  '저장 버튼을 더 크게 해줘',
  '제목을 "내일 할 일"로 바꿔줘',
  '두 번째 항목을 맨 위로 올려줘',
  '맨 아래 항목을 숨겨줘',
  '부제목 색을 회색으로 바꿔줘',
];

const base = await readFile(FILE, 'utf8');
const baseIds = elementIndex(base).map((e) => e.id).join(',');

for (const request of REQUESTS) {
  const started = Date.now();
  let out;
  try {
    out = await editOnce({ html: base, request });
  } catch (e) {
    console.log(JSON.stringify({ request, error: String(e.message || e) }));
    continue;
  }
  const ms = Date.now() - started;
  const idsAfter = elementIndex(out.html).map((e) => e.id).join(',');
  console.log(JSON.stringify({
    request,
    ms,
    tools: out.applied.map((a) => `${a.name}(${JSON.stringify(a.args)})`),
    changed: out.html !== base,
    idsIntact: idsAfter === baseIds,
    message: out.message.slice(0, 60),
  }));
}
