// Load .env from the project root if it exists. Existing environment variables win.
// Imported first by server.js so every module sees the values.
import { readFileSync } from 'node:fs';

try {
  const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== '' && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // no .env, use the environment as is
}
