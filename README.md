# Kabar Ekonomi — Economic Dashboard

A personal, interactive economic newspaper for learning about central banking: see Indonesia, travel the world, and get AI-assisted insights and ideas.

Six sections: Inflation · FX & World · MSMEs · Payment Systems · Rupiah Circulation · Communication Studio.

- Key data tiles (BI-Rate, CPI inflation, inflation target, FX reserves, JISDOR, INDONIA) come from bi.go.id, checked 17 Nov 2026.
- **AI Insight** above the news: a Gemini-written summary per topic, three times a day, with numbered links to its sources.
- **Latest news** is live: stories (with photos) are pulled from Indonesian and world outlets every 15 minutes, stored in Supabase, and pushed to open pages in real time.
- News inside the six sections is still illustrative sample content.
- Indonesian sources appear in Bahasa Indonesia; foreign sources appear in English.

This is a personal study project, not an official Bank Indonesia product.

## How it runs

```
RSS feeds ──(GitHub Actions, every 15 min)──> scripts/ingest.mjs ──> Supabase table news_articles
                                                                          │
                          index.html <──(read + realtime, public key)─────┘
```

- `index.html` — the page (markup, styles and logic)
- `petite-vue.iife.js` — [petite-vue](https://github.com/vuejs/petite-vue) (MIT), a tiny library for the interactive parts
- `config.js` — Supabase project URL and **public** key used by the page
- `scripts/feeds.json` — the outlets to pull from (add or remove feeds here)
- `scripts/ingest.mjs` — fetches feeds, finds each story's photo, sorts it into a section, inserts new stories (no dependencies, Node 18+)
- `.github/workflows/ingest-news.yml` — runs the ingest every 15 minutes
- `supabase/schema.sql` — table, read-only public access (RLS) and realtime
- `scripts/insights.mjs` — asks Gemini for a short, sourced insight per news section (plus an overall brief) and stores it in `news_insights`
- `.github/workflows/insights.yml` — runs the insights at 07:30, 12:00 and 17:00 WIB
- `supabase/insights.sql` — the `news_insights` table, read-only public access and realtime
- `.nojekyll` — tells GitHub Pages to serve the files as they are

What is stored per story: headline, a short excerpt (max 280 characters), the photo's URL (hotlinked, not copied), outlet name, link to the original article, section and publish time. Stories older than 30 days are deleted automatically.

## Setup

1. **Supabase**: Dashboard → SQL Editor → paste `supabase/schema.sql` → Run.
2. **Website**: put the Project URL and the public key (anon, or `sb_publishable_…`) into `config.js`.
3. **Ingest job**: GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
   - `SUPABASE_URL` — the Project URL
   - `SUPABASE_SERVICE_KEY` — the `service_role` key or a secret key (`sb_secret_…`). Never put this one in `config.js`.
4. Actions tab → "Ingest news" → Run workflow, to fill the table right away.

### AI insights (Gemini)

1. Supabase SQL Editor: run `supabase/insights.sql`.
2. Add the repository secret `GEMINI_API_KEY` (Google AI Studio key).
3. Optional: add the repository **variable** `GEMINI_MODEL` to use another model (default `gemini-flash-lite-latest`).
4. Actions tab → "AI insights" → Run workflow.

Each run makes up to 9 Gemini calls (about 20k input + 3–4k output tokens in total). Insights are AI interpretations of headlines and can be wrong; every point links to the stories it is based on.

Try the ingest locally without writing anything:

```bash
node scripts/ingest.mjs --dry-run
```

## Deploy

GitHub Pages: Settings → Pages → Build and deployment → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)`.
