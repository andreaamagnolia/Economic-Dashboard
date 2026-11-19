// Kabar Ekonomi — news ingestion
// Pulls the latest economic news from the RSS feeds in feeds.json, finds a photo for
// each story, sorts it into one of the site's sections, and inserts NEW stories into
// the Supabase table `news_articles`. Existing stories are left untouched.
//
// Env:
//   SUPABASE_URL           https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_KEY   secret / service_role key (server-side only, never in the site)
// Flags:
//   --dry-run              parse and print, write nothing (also the default when env is missing)
//
// Zero dependencies: Node 18+ (built-in fetch).

import { readFile } from 'node:fs/promises';

const FEEDS = JSON.parse(await readFile(new URL('./feeds.json', import.meta.url), 'utf8'));

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const DRY_RUN = process.argv.includes('--dry-run') || !SUPABASE_URL || !SUPABASE_KEY;

const MAX_AGE_DAYS = 7;          // ignore stories older than this
const KEEP_DAYS = 30;            // delete stories older than this from the table
const SUMMARY_MAX = 280;         // snippet length: a teaser, never the article
const OG_LOOKUPS_PER_RUN = 30;   // page fetches to find a photo when the feed has none
const UA = 'Mozilla/5.0 (compatible; KabarEkonomiBot/1.0; RSS reader for a personal study dashboard)';

// ---------- small helpers ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·', copy: '©', reg: '®', euro: '€', pound: '£' };

function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const unCdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ');
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const text = (s) => squash(decode(stripTags(decode(unCdata(s))))); // handles entity-encoded HTML too

function tag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function attr(xml, tagName, attrName, filter) {
  const re = new RegExp('<' + tagName + '\\b([^>]*)>', 'gi');
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1].match(new RegExp('\\b' + attrName + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
    if (a && (!filter || filter(m[1]))) return decode(a[1]);
  }
  return '';
}

function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 30)).replace(/[\s,.;:–—-]+$/, '') + '…';
}

function cleanUrl(u) {
  try {
    const url = new URL(decode(u).trim());
    [...url.searchParams.keys()].forEach((k) => { if (/^(utm_|at_|fbclid|gclid)/i.test(k)) url.searchParams.delete(k); });
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function betterImage(u) {
  if (!u) return '';
  let s = u.trim();
  if (s.startsWith('//')) s = 'https:' + s;
  if (!/^https?:\/\//i.test(s)) return '';
  s = s.replace(/^http:\/\//i, 'https://');
  // Ask for a larger rendition where the CDN supports it.
  s = s.replace(/(ichef\.bbci\.co\.uk\/ace\/standard\/)\d+\//, '$1800/');
  s = s.replace(/(akcdn\.detik\.net\.id\/[^?]+\?w=)\d+/, '$1720');
  return s;
}

const isImg = (a) => /image\//i.test(a) || /medium\s*=\s*["']image/i.test(a) || /\.(jpe?g|png|webp|gif)(\?|["'])/i.test(a) || !/type\s*=/i.test(a);

function findImage(item) {
  return betterImage(
    attr(item, 'media:content', 'url', isImg) ||
    attr(item, 'enclosure', 'url', isImg) ||
    attr(item, 'media:thumbnail', 'url') ||
    squash(unCdata(tag(item, 'img'))) ||                                   // Tempo: <img>url</img>
    attr(decode(unCdata(tag(item, 'description'))), 'img', 'src') ||
    attr(decode(unCdata(tag(item, 'content:encoded'))), 'img', 'src')
  );
}

// ---------- categories (match the site's sections) ----------

const RULES = [
  ['bayar',   ['qris', 'sistem pembayaran', 'pembayaran digital', 'transaksi digital', 'dompet digital', 'e-wallet', 'uang elektronik', 'fintech', 'paylater', 'pinjol', 'pinjaman online', 'kartu kredit', 'kartu debit', 'bi-fast', 'gpn', 'open banking', 'rupiah digital', 'digital payment', 'payments', 'stablecoin', 'cbdc', 'crypto', 'kripto']],
  ['rupiah',  ['uang tunai', 'uang baru', 'penukaran uang', 'tukar uang', 'uang palsu', 'uang pecahan', 'pecahan uang', 'peredaran uang', 'kas keliling', 'uang kartal', 'banknote', 'cash withdrawal']],
  ['inflasi', ['inflasi', 'deflasi', 'indeks harga konsumen', 'harga pangan', 'harga beras', 'harga cabai', 'harga telur', 'harga bawang', 'minyak goreng', 'sembako', 'bahan pokok', 'harga bbm', 'inflation', 'consumer price', 'cpi', 'cost of living', 'food prices']],
  ['umkm',    ['umkm', 'ukm', 'usaha mikro', 'usaha kecil', 'kredit usaha rakyat', 'kur', 'koperasi', 'pelaku usaha kecil', 'msme', 'msmes', 'small business', 'small businesses']],
  ['moneter', ['bi-rate', 'bi rate', 'suku bunga', 'bank indonesia', 'kebijakan moneter', 'rapat dewan gubernur', 'cadangan devisa', 'likuiditas', 'bank sentral', 'indonia', 'fomc', 'the fed', 'federal reserve', 'interest rate', 'interest rates', 'rate cut', 'rate hike', 'central bank', 'monetary policy', 'ecb', 'bank of england']],
  ['pasar',   ['ihsg', 'saham', 'bursa', 'kurs', 'rupiah', 'dolar', 'obligasi', 'yield', 'harga emas', 'emas antam', 'reksa dana', 'investor', 'stock', 'stocks', 'shares', 'bond', 'bonds', 'currency', 'forex', 'dollar', 'gold price', 'wall street', 'markets']]
];
const RULE_RE = RULES.map(([cat, words]) => [cat, words.map((w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i'))]);

function classify(title, summary) {
  const t = (title + ' ' + summary).toLowerCase();
  let best = null, bestScore = 0;
  for (const [cat, res] of RULE_RE) {
    // Title hits count double: the headline says what the story is about.
    const score = res.reduce((n, re) => n + (re.test(title.toLowerCase()) ? 2 : re.test(t) ? 1 : 0), 0);
    if (score > bestScore) { best = cat; bestScore = score; }
  }
  return best;
}

// Keyword match wins; the feed's own category is the fallback. World stories go to
// "dunia" unless they are about central banks, inflation or payments, which the
// site follows as topics in their own right.
function pickCategory(found, feed) {
  if (feed.scope === 'global') return ['moneter', 'inflasi', 'bayar'].includes(found) ? found : (feed.category || 'dunia');
  return found || feed.category || 'umum';
}

// ---------- fetching ----------

async function get(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const out = [];
  for (const item of blocks) {
    const title = text(tag(item, 'title'));
    const link = cleanUrl(text(tag(item, 'link')) || attr(item, 'link', 'href') || (/^https?:/.test(text(tag(item, 'guid'))) ? text(tag(item, 'guid')) : ''));
    if (!title || !link) continue;
    const rawSummary = text(tag(item, 'description')) || text(tag(item, 'summary')) || text(tag(item, 'content:encoded'));
    const summary = truncate(rawSummary.replace(/\s*Continue reading\.*$/i, ''), SUMMARY_MAX);
    let ts = Date.parse(text(tag(item, 'pubDate')) || text(tag(item, 'published')) || text(tag(item, 'updated')) || text(tag(item, 'dc:date')));
    if (!Number.isFinite(ts)) ts = Date.now();
    if (ts > Date.now() + 36e5) ts = Date.now();
    if (ts < cutoff) continue;
    const found = classify(title, summary);
    if (feed.economyOnly && !found) continue;
    out.push({
      url: link,
      title: truncate(title, 300),
      summary: summary && summary !== title ? summary : null,
      image_url: findImage(item) || null,
      source: feed.source,
      source_domain: new URL(link).hostname.replace(/^www\./, ''),
      lang: feed.lang || 'id',
      scope: feed.scope || 'id',
      category: pickCategory(found, feed),
      published_at: new Date(ts).toISOString()
    });
  }
  return out;
}

async function ogImage(url) {
  try {
    const html = (await get(url, 10000)).slice(0, 200000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/i);
    const c = m && m[0].match(/content=["']([^"']+)["']/i);
    return c ? betterImage(decode(c[1])) : '';
  } catch { return ''; }
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---------- Supabase (PostgREST) ----------

const sbHeaders = () => ({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' });

async function existingUrls() {
  const since = new Date(Date.now() - (MAX_AGE_DAYS + 1) * 864e5).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/news_articles?select=url&published_at=gte.${encodeURIComponent(since)}&limit=10000`, { headers: sbHeaders() });
  if (!res.ok) throw new Error('Supabase read failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return new Set((await res.json()).map((r) => r.url));
}

async function insert(rows) {
  for (let i = 0; i < rows.length; i += 100) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/news_articles?on_conflict=url`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 100))
    });
    if (!res.ok) throw new Error('Supabase insert failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  }
}

async function prune() {
  const before = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/news_articles?published_at=lt.${encodeURIComponent(before)}`, { method: 'DELETE', headers: { ...sbHeaders(), Prefer: 'return=minimal' } });
  if (!res.ok) console.warn('Prune skipped: HTTP ' + res.status);
}

// ---------- main ----------

const started = Date.now();
console.log(DRY_RUN ? 'DRY RUN — nothing will be written.' : 'Writing to ' + new URL(SUPABASE_URL).hostname);
if (DRY_RUN && process.env.GITHUB_ACTIONS && !process.argv.includes('--dry-run')) {
  console.log('::warning::SUPABASE_URL / SUPABASE_SERVICE_KEY secrets are not set, so no news was saved.');
}

const results = await Promise.all(FEEDS.map(async (feed) => {
  try {
    const items = parseFeed(await get(feed.url), feed);
    console.log(`  ok   ${String(items.length).padStart(3)}  ${feed.source} — ${feed.url}`);
    return items;
  } catch (e) {
    console.warn(`  FAIL      ${feed.source} — ${feed.url}: ${e.message}`);
    return null;
  }
}));
if (results.every((r) => r === null)) { console.error('Every feed failed.'); process.exit(1); }

// De-duplicate within this run (same link, or same headline from the same outlet).
const seen = new Set();
let all = results.flat().filter(Boolean).filter((a) => {
  const keys = [a.url, a.source + '|' + a.title.toLowerCase()];
  if (keys.some((k) => seen.has(k))) return false;
  keys.forEach((k) => seen.add(k));
  return true;
});

const known = DRY_RUN ? new Set() : await existingUrls();
const fresh = all.filter((a) => !known.has(a.url));

// Photo fallback: read the article page's og:image for new stories whose feed had none.
const needPhoto = fresh.filter((a) => !a.image_url).slice(0, OG_LOOKUPS_PER_RUN);
await pool(needPhoto, 5, async (a) => { a.image_url = (await ogImage(a.url)) || null; });

const byCat = fresh.reduce((m, a) => ((m[a.category] = (m[a.category] || 0) + 1), m), {});
const withPhoto = fresh.filter((a) => a.image_url).length;
console.log(`\n${all.length} stories in feeds, ${fresh.length} new, ${withPhoto} with photo.`);
console.log('By section:', JSON.stringify(byCat));

if (DRY_RUN) {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  if (outArg) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outArg.slice(6), JSON.stringify(fresh, null, 1));
    console.log('Saved preview to ' + outArg.slice(6));
  }
  fresh.sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 12).forEach((a) =>
    console.log(`\n[${a.category}] ${a.source} · ${a.published_at}\n  ${a.title}\n  ${a.summary || ''}\n  img: ${a.image_url || '—'}\n  ${a.url}`));
} else {
  if (fresh.length) await insert(fresh);
  await prune();
  console.log(`Inserted ${fresh.length} new stories in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}
