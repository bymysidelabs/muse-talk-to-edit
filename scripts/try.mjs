// Run one talk-to-edit request against a local HTML file.
// Usage: META_API_KEY=... node scripts/try.mjs demo/app.html "저장 버튼을 더 크게 해줘"

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { editOnce } from '../src/agent.js';

const [file, request] = process.argv.slice(2);
if (!file || !request) {
  console.error('usage: node scripts/try.mjs <html-file> "<request>"');
  process.exit(1);
}

const html = await readFile(path.resolve(file), 'utf8');
const started = Date.now();
const result = await editOnce({ html, request, onTool: (t) => console.log('tool', t.name, JSON.stringify(t.args), t.ok ? '' : `-> ${t.error}`) });
const ms = Date.now() - started;

console.log('---');
console.log('applied:', JSON.stringify(result.applied));
console.log('message:', result.message);
console.log('elapsed:', ms, 'ms');
console.log('changed:', result.html !== html);
await writeFile(path.resolve(file.replace(/\.html?$/, '') + '.edited.html'), result.html);
