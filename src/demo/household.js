// Synthetic but realistic household data for the demo and the reading test.
// Deterministic (seeded), so every run of the benchmark sees the same records.
// All names, cards and merchants are made up.

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export const CATEGORIES = ['식비', '외식', '카페', '교통', '생활', '쇼핑', '교육'];

const MERCHANTS = {
  식비: [['이마트', 28000, 92000], ['홈플러스', 22000, 78000], ['동네마트', 6000, 31000], ['쿠팡 로켓프레시', 18000, 64000]],
  외식: [['아웃백', 52000, 118000], ['김밥천국', 9000, 21000], ['교촌치킨', 21000, 34000], ['본죽', 11000, 26000], ['고깃집 화로', 48000, 96000]],
  카페: [['스타벅스', 4800, 14200], ['메가커피', 2000, 7400], ['투썸플레이스', 5600, 16800]],
  교통: [['카카오T', 7200, 24800], ['주유소', 45000, 82000], ['티머니', 1250, 1250]],
  생활: [['다이소', 3000, 21000], ['올리브영', 8900, 38000]],
  쇼핑: [['무신사', 39000, 129000], ['쿠팡', 9900, 64000]],
  교육: [['피아노학원', 150000, 150000], ['영어학원', 220000, 220000]],
};
const WEIGHTS = { 식비: 5, 외식: 4, 카페: 6, 교통: 5, 생활: 2, 쇼핑: 2, 교육: 0 };
const CARDS = ['KB국민체크', '신한카드', '현대카드'];

const pad = (n) => String(n).padStart(2, '0');

/** Card payments between two dates (inclusive), as structured records. */
export function payments(from = '2026-08-01', to = '2026-11-03', seed = 20261104) {
  const r = rng(seed);
  const out = [];
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  const pickCat = () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (const [c, w] of Object.entries(WEIGHTS)) { if ((x -= w) < 0) return c; }
    return '식비';
  };
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const category = pickCat();
      const list = MERCHANTS[category];
      const [merchant, lo, hi] = list[Math.floor(r() * list.length)];
      const amount = lo === hi ? lo : Math.round((lo + r() * (hi - lo)) / 100) * 100;
      const hh = 8 + Math.floor(r() * 14);
      const mm = Math.floor(r() * 60);
      out.push({ date, time: `${pad(hh)}:${pad(mm)}`, merchant, amount, category, card: CARDS[Math.floor(r() * CARDS.length)] });
    }
    if (date.endsWith('-25')) { // monthly fixed costs
      out.push({ date, time: '09:00', merchant: '아파트 관리비', amount: 238000 + Math.floor(r() * 30) * 1000, category: '생활', card: 'KB국민체크' });
      out.push({ date, time: '09:05', merchant: '피아노학원', amount: 150000, category: '교육', card: '신한카드' });
    }
  }
  return out;
}

/** The text a phone would receive for a payment. Category is not in the text. */
export function sms(p) {
  const [, m, d] = p.date.split('-');
  return `[${p.card}] ${m}/${d} ${p.time} ${p.amount.toLocaleString('ko-KR')}원 ${p.merchant} 승인`;
}

/** Two weeks of what the person did on their phone: card texts plus chats. */
export function recentActivity() {
  const pays = payments('2026-10-21', '2026-11-03', 7).slice(0, 34);
  const lines = pays.map((p) => sms(p));
  const notes = [
    '[메모 10/22] 이번 달 외식 너무 많은 듯. 정리해보자',
    '[카톡 아내 10/24] 관리비 이번 달 얼마 나왔어?',
    '[메모 10/26] 가계부 엑셀: 카드 문자 보고 한 줄씩 옮김 (3일치 밀림)',
    '[카톡 아내 10/28] 이번 달 카페만 몇 번 간 거야 ㅋㅋ',
    '[메모 10/30] 가계부 엑셀 정리 30분. 외식/카페/마트 나눠서',
    '[카톡 아내 11/02] 10월 외식비 총 얼마야? 나도 같이 볼 수 있게 해줘',
    '[메모 11/03] 가계부 또 밀림. 카드 문자 23개',
  ];
  // interleave notes with texts in date order
  return [...lines, ...notes].sort((a, b) => dateOf(a).localeCompare(dateOf(b))).join('\n');
}

function dateOf(line) {
  const m = line.match(/(\d{1,2})\/(\d{1,2})/);
  return m ? `${pad(m[1])}-${pad(m[2])}` : '99';
}

/** Fixed spec used by the reading test, so results are repeatable. */
export const LEDGER_SPEC = {
  title: '우리집 가계부',
  subtitle: '카드 문자가 오면 자동으로 정리돼요',
  entity: {
    name: '지출',
    fields: [
      { key: 'merchant', label: '사용처', type: 'text' },
      { key: 'amount', label: '금액', type: 'money' },
      { key: 'category', label: '분류', type: 'enum', options: CATEGORIES },
      { key: 'date', label: '날짜', type: 'date' },
    ],
  },
  summaries: [
    { label: '이번 달 지출', op: 'sum', field: 'amount', period: 'month' },
    { label: '이번 달 외식', op: 'sum', field: 'amount', period: 'month', where: { category: '외식' } },
    { label: '이번 달 카페', op: 'count', period: 'month', where: { category: '카페' } },
    { label: '오늘 지출', op: 'sum', field: 'amount', period: 'today' },
  ],
  quick: [{ label: '메가커피', preset: { merchant: '메가커피', amount: 2000, category: '카페' } }],
};

const SYNONYMS = {
  식비: ['식비', '마트', '장보기', '식료품', '식재료'],
  외식: ['외식', '식당', '배달'],
  카페: ['카페', '커피', '음료'],
  교통: ['교통', '택시', '주유', '대중교통', '차량'],
  생활: ['생활', '생활비', '생필품', '관리비', '고정비', '공과금'],
  쇼핑: ['쇼핑', '의류', '온라인'],
  교육: ['교육', '학원', '아이'],
};

/** Map demo payments onto whatever spec the agent proposed, for "import past records". */
export function mapToSpec(spec, pays) {
  const fields = spec.entity.fields;
  const text = fields.find((f) => f.type === 'text');
  const money = fields.find((f) => f.type === 'money' || f.type === 'number');
  const date = fields.find((f) => f.type === 'date');
  const cat = fields.find((f) => f.type === 'enum');
  const pickCat = (p) => {
    if (!cat) return null;
    const opts = cat.options;
    if (p.merchant === '아파트 관리비') { const fixed = opts.find((o) => /고정|관리비|공과금/.test(o)); if (fixed) return fixed; }
    if (p.merchant === '주유소') { const fuel = opts.find((o) => /주유/.test(o)); if (fuel) return fuel; }
    for (const name of SYNONYMS[p.category] || [p.category]) { const hit = opts.find((o) => o.includes(name) || name.includes(o)); if (hit) return hit; }
    return opts.find((o) => /기타/.test(o)) || opts[opts.length - 1];
  };
  return pays.map((p) => {
    const v = {};
    if (text) v[text.key] = p.merchant;
    if (money) v[money.key] = p.amount;
    if (date) v[date.key] = p.date;
    if (cat) v[cat.key] = pickCat(p);
    return v;
  });
}
