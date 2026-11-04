// Voice and icons for generated apps, both on the Meta Model API.
//  - transcribe(): Muse Voice Transcribe turns a short spoken request into text.
//    The app hands the speech model its own words (categories, field names,
//    shops it has seen) as keywords, so "식비" is not heard as "식기".
//  - makeIcon(): Muse Image draws the app's icon from its spec, flat and in
//    the app's own colour, when the app is built.

const BASE = process.env.META_BASE_URL || 'https://api.meta.ai/v1';
const VOICE_MODEL = process.env.VOICE_MODEL || 'muse-voice-transcribe-1.0';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'muse-image-1.0';

function key() {
  const k = process.env.META_API_KEY;
  if (!k) throw new Error('META_API_KEY is not set');
  return k;
}

/** Words this app uses, most useful first: categories, labels, quick buttons, then frequent names. */
export function voiceKeywords(app, max = 60) {
  const out = [];
  const push = (w) => {
    const s = String(w || '').trim();
    if (s && s.length <= 30 && !out.includes(s)) out.push(s);
  };
  const fields = app.spec.entity.fields;
  for (const f of fields) if (f.type === 'enum') f.options.forEach(push);
  fields.forEach((f) => push(f.label));
  (app.spec.quick || []).forEach((q) => push(q.label));
  app.spec.summaries.forEach((s) => push(s.label));
  const text = fields.find((f) => f.type === 'text');
  if (text) {
    const freq = {};
    for (const r of app.entries) if (r[text.key]) freq[r[text.key]] = (freq[r[text.key]] || 0) + 1;
    Object.entries(freq).sort((a, b) => b[1] - a[1]).forEach(([w]) => push(w));
  }
  return out.slice(0, max);
}

async function asr(wav, keywords) {
  const form = new FormData();
  const request = { model: VOICE_MODEL, audioEncoding: 'WAV', ...(keywords && keywords.length ? { keywords } : {}) };
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  const res = await fetch(`${BASE}/asr/transcribe`, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`transcribe ${res.status}: ${(json.error && json.error.message) || 'failed'}`);
  return { text: String(json.transcript || '').replace(/([?!.])\.+$/, '$1').trim(), audioMs: json.audioDurationMs || null };
}

/**
 * Transcribe with the app's own words, and (for the demo trace) also without
 * them, in parallel, so you can see what the keywords fixed.
 */
export async function transcribe(app, wav, { compare = true } = {}) {
  if (!wav || wav.length < 44 || wav.slice(0, 4).toString('ascii') !== 'RIFF') throw new Error('expected a WAV recording');
  const keywords = voiceKeywords(app);
  const started = Date.now();
  const [withWords, plain] = await Promise.all([
    asr(wav, keywords),
    compare ? asr(wav, null).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    ok: true,
    transcript: withWords.text,
    withoutAppWords: plain ? plain.text : null,
    keywordCount: keywords.length,
    keywordsSample: keywords.slice(0, 8),
    audioMs: withWords.audioMs,
    ms: Date.now() - started,
    model: VOICE_MODEL,
  };
}

export function iconPrompt(spec, accent = '#2f6f8f') {
  return `App icon for a small phone app called "${spec.title}". It keeps ${spec.entity.name} records.
Pick one simple object that stands for what the app does and draw only that, large and centred.
Flat 2D vector illustration with exactly three colours: ${accent} as a full-bleed square background, warm cream #fdfcf9, and one soft accent colour.
No text, no letters, no numbers, no gradients, no shadows, no glow, no 3D, no outlines around the canvas, no rounded-corner frame.`;
}

/** Draw the app's icon. Returns the image bytes (webp) and timing. */
export async function makeIcon(spec, accent) {
  const started = Date.now();
  const res = await fetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: iconPrompt(spec, accent), n: 1 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.data || !json.data[0] || !json.data[0].b64_json) {
    throw new Error(`image ${res.status}: ${(json.error && json.error.message) || 'no image'}`);
  }
  return {
    bytes: Buffer.from(json.data[0].b64_json, 'base64'),
    format: json.output_format || 'webp',
    ms: Date.now() - started,
    model: IMAGE_MODEL,
  };
}
