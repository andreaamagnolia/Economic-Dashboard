// Kabar Ekonomi — AI insights
// Reads the latest stories per section from Supabase, asks Gemini for a short,
// sourced insight per section (plus one overall brief), and stores the result in
// the `news_insights` table. The website shows the newest insight per section.
//
// Env:
//   SUPABASE_URL           https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_KEY   secret / service_role key (needed to write)
//   SUPABASE_ANON_KEY      optional: public key, enough for a local --dry-run
//   GEMINI_API_KEY         Google AI Studio key
//   GEMINI_MODEL           optional, default gemini-flash-lite-latest
// Flags:
//   --dry-run              generate and print, write nothing
//   --only=<category>      generate just one section (handy for testing)
//
// Zero dependencies: Node 18+ (built-in fetch).

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const WRITE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const READ_KEY = WRITE_KEY || process.env.SUPABASE_ANON_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
// Flash-Lite: fast (a few seconds per section) and accurate enough for sourced summaries.
// Override with the GEMINI_MODEL repository variable, e.g. gemini-3.8-flash.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const DRY_RUN = process.argv.includes('--dry-run') || !WRITE_KEY;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

const WINDOW_HOURS = 36;     // stories considered "current"
const PER_SECTION = 40;      // max stories sent per section
const MIN_STORIES = 4;       // skip a section with less news than this
const KEEP_DAYS = 14;        // delete older insights

const SECTIONS = [
  ['semua',   'Gambaran umum ekonomi hari ini (semua topik)', 'id'],
  ['inflasi', 'Inflasi dan harga barang', 'id'],
  ['moneter', 'Kebijakan moneter dan bank sentral', 'id'],
  ['pasar',   'Pasar keuangan, rupiah dan nilai tukar', 'id'],
  ['bayar',   'Sistem pembayaran dan keuangan digital', 'id'],
  ['rupiah',  'Pengelolaan uang rupiah dan uang tunai', 'id'],
  ['umkm',    'UMKM dan usaha kecil', 'id'],
  ['dunia',   'World economy and foreign central banks', 'en'],
  ['umum',    'Bisnis, energi dan industri', 'id']
];

if (!SUPABASE_URL || !READ_KEY) { console.error('Set SUPABASE_URL and a Supabase key.'); process.exit(1); }
if (!GEMINI_KEY) { console.error('Set GEMINI_API_KEY.'); process.exit(1); }

// ---------- Supabase ----------

const sb = (key) => ({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' });

async function stories() {
  const since = new Date(Date.now() - WINDOW_HOURS * 36e5).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/news_articles?select=title,summary,url,source,lang,category,published_at&published_at=gte.${encodeURIComponent(since)}&order=published_at.desc&limit=1000`, { headers: sb(READ_KEY) });
  if (!res.ok) throw new Error('Supabase read failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

async function save(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/news_insights`, { method: 'POST', headers: { ...sb(WRITE_KEY), Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  if (!res.ok) throw new Error('Supabase insert failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const before = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/news_insights?generated_at=lt.${encodeURIComponent(before)}`, { method: 'DELETE', headers: { ...sb(WRITE_KEY), Prefer: 'return=minimal' } });
}

// ---------- Gemini ----------

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: 'One-line takeaway, max 14 words.' },
    summary: { type: 'STRING', description: '2-3 sentences: what is happening and the common thread.' },
    points: {
      type: 'ARRAY', minItems: 3, maxItems: 5,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING', description: 'One observation, 1-2 sentences.' },
          sources: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Story numbers this observation is based on.' }
        },
        required: ['text', 'sources']
      }
    },
    why_it_matters: { type: 'STRING', description: 'Why this matters from a central bank point of view: prices, rupiah, financial stability, payments or the real economy. 1-2 sentences.' },
    watch_next: { type: 'ARRAY', minItems: 2, maxItems: 3, items: { type: 'STRING' }, description: 'Concrete things to check next (data, events, follow-up questions).' }
  },
  required: ['headline', 'summary', 'points', 'why_it_matters', 'watch_next']
};

function systemPrompt(lang) {
  const language = lang === 'en' ? 'English' : 'Bahasa Indonesia';
  return [
    'You write the "AI Insight" box of Kabar Ekonomi, a personal study dashboard for someone learning about central banking in Indonesia.',
    'You receive today\'s numbered news stories for one section. Find the few things that actually matter, connect related stories, and explain them plainly.',
    'Rules:',
    '- Use only the stories given. Never add numbers, names or events that are not in them.',
    '- Every point cites the story numbers it rests on.',
    '- Patterns in news coverage are not proof of cause and effect: say "diberitakan"/"reported" and be careful with causal claims.',
    '- Skip promotional items, event announcements and duplicates.',
    '- No investment advice, no buy/sell calls, no price predictions.',
    '- Plain, calm language a student understands. Short sentences. No hype.',
    `- Write everything in ${language}.`
  ].join('\n');
}

function userPrompt(label, items) {
  const lines = items.map((a, i) => {
    const t = new Date(a.published_at).toISOString().slice(0, 16).replace('T', ' ');
    return `[${i + 1}] ${a.source} · ${t} UTC\n${a.title}${a.summary ? '\n' + a.summary : ''}`;
  });
  return `Section: ${label}\nStories (${items.length}):\n\n${lines.join('\n\n')}`;
}

async function gemini(system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.4, maxOutputTokens: 8192 }
  };
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
    } catch (e) {
      if (attempt < 3) { console.warn(`  Gemini request failed (${e.name}), retrying…`); continue; }
      throw e;
    }
    if (res.ok) {
      const data = await res.json();
      const cand = (data.candidates || [])[0];
      const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error('Empty response (finishReason: ' + (cand && cand.finishReason) + ')');
      return { json: JSON.parse(text), usage: data.usageMetadata || {} };
    }
    const err = (await res.text()).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 5000 * attempt;
      console.warn(`  Gemini HTTP ${res.status}, retrying in ${wait / 1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error('Gemini HTTP ' + res.status + ': ' + err);
  }
}

// ---------- main ----------

const all = await stories();
console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${all.length} stories from the last ${WINDOW_HOURS}h · model ${MODEL}`);

const rows = [];
const tokens = { in: 0, out: 0 };
for (const [cat, label, lang] of SECTIONS) {
  if (ONLY && ONLY !== cat) continue;
  let items;
  if (cat === 'semua') {
    // Overall brief: the newest few stories from every real topic.
    const per = {};
    items = all.filter((a) => a.category !== 'umum' && (per[a.category] = (per[a.category] || 0) + 1) <= 8);
  } else {
    items = all.filter((a) => a.category === cat);
  }
  items = items.slice(0, PER_SECTION);
  if (items.length < MIN_STORIES) { console.log(`  skip ${cat}: only ${items.length} stories`); continue; }

  try {
    const { json, usage } = await gemini(systemPrompt(lang), userPrompt(label, items));
    tokens.in += usage.promptTokenCount || 0;
    tokens.out += (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
    const valid = (n) => Number.isInteger(n) && n >= 1 && n <= items.length;
    const points = (json.points || []).map((p) => ({ text: String(p.text || '').trim(), sources: [...new Set((p.sources || []).filter(valid))] })).filter((p) => p.text);
    const used = [...new Set(points.flatMap((p) => p.sources))].sort((a, b) => a - b);
    if (!json.headline || !json.summary || points.length < 2) throw new Error('Incomplete insight');
    rows.push({
      category: cat, lang,
      headline: String(json.headline).trim(),
      summary: String(json.summary).trim(),
      points,
      why_it_matters: json.why_it_matters ? String(json.why_it_matters).trim() : null,
      watch_next: (json.watch_next || []).map((s) => String(s).trim()).filter(Boolean),
      sources: used.map((n) => ({ n, title: items[n - 1].title, url: items[n - 1].url, source: items[n - 1].source })),
      story_count: items.length,
      model: MODEL
    });
    console.log(`  ok   ${cat.padEnd(8)} ${items.length} stories → "${json.headline}" (${usage.promptTokenCount || '?'} in / ${(usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0)} out tokens)`);
  } catch (e) {
    console.warn(`  FAIL ${cat}: ${e.message}`);
  }
}

console.log(`\n${rows.length} insights · ${tokens.in} input + ${tokens.out} output tokens this run.`);
if (!rows.length) process.exit(1);

if (DRY_RUN) {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  if (outArg) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outArg.slice(6), JSON.stringify(rows.map((r) => ({ ...r, generated_at: new Date().toISOString() })), null, 1));
    console.log('Saved preview to ' + outArg.slice(6));
  }
  const r = rows[0];
  console.log('\nExample (' + r.category + '):\n' + JSON.stringify({ headline: r.headline, summary: r.summary, points: r.points, why_it_matters: r.why_it_matters, watch_next: r.watch_next, sources: r.sources.slice(0, 3) }, null, 2));
} else {
  await save(rows);
  console.log('Saved to news_insights.');
}
