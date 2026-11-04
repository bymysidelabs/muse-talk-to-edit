// Every number a person actually said or pasted, read the way Koreans write
// and say amounts: "22,500원", "2만 2500원", "이만 이천오백 원", "만 이천삼백".
// The agent may only write an amount that is in this set, so a mis-heard or
// invented number is refused by code before it reaches the records.

const DIGIT = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL = { 십: 10, 백: 100, 천: 1000 };
const BIG = { 만: 10_000, 억: 100_000_000 };
const TOKEN = /[0-9][0-9,]*(?:\.[0-9]+)?|[영공일이삼사오육륙칠팔구십백천만억]/g;
const RUN = /(?:[0-9][0-9,]*(?:\.[0-9]+)?|[영공일이삼사오육륙칠팔구십백천만억])(?:\s*(?:[0-9][0-9,]*(?:\.[0-9]+)?|[영공일이삼사오육륙칠팔구십백천만억]))*\s*원?/g;

function parseRun(run) {
  let total = 0;
  let section = 0;
  let current = null;
  for (const t of run.match(TOKEN) || []) {
    if (/^[0-9]/.test(t)) {
      current = Number(t.replace(/,/g, ''));
    } else if (t in DIGIT) {
      current = DIGIT[t];
    } else if (t in SMALL) {
      section += (current ?? 1) * SMALL[t];
      current = null;
    } else if (t in BIG) {
      section += current ?? 0;
      total += (section || 1) * BIG[t];
      section = 0;
      current = null;
    }
  }
  return total + section + (current ?? 0);
}

/** All amounts in a text. A lone hangul digit (the 이 in 이마트) is not a number. */
export function koNumbers(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(RUN)) {
    const run = m[0].trim();
    const hasDigits = /[0-9]/.test(run);
    const hasUnit = /[십백천만억]/.test(run);
    const hasWon = /원$/.test(run);
    if (!hasDigits && !hasUnit && !hasWon) continue;
    const n = parseRun(run);
    if (Number.isFinite(n) && n > 0) out.add(n);
    // also each plain arabic number on its own, e.g. "11/04 13:38 16,000원"
    for (const d of run.match(/[0-9][0-9,]*/g) || []) out.add(Number(d.replace(/,/g, '')));
  }
  return out;
}
