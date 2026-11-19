# Kabar Ekonomi — Economic Dashboard

A personal, interactive economic newspaper for learning about central banking: see Indonesia, travel the world, and get AI-assisted insights and ideas.

Six sections: Inflation · FX & World · MSMEs · Payment Systems · Rupiah Circulation · Communication Studio.

- Key data tiles (BI-Rate, CPI inflation, inflation target, FX reserves, JISDOR, INDONIA) come from bi.go.id, checked 17 Nov 2026.
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
- `.nojekyll` — tells GitHub Pages to serve the files as they are

What is stored per story: headline, a short excerpt (max 280 characters), the photo's URL (hotlinked, not copied), outlet name, link to the original article, section and publish time. Stories older than 30 days are deleted automatically.

## Setup

1. **Supabase**: Dashboard → SQL Editor → paste `supabase/schema.sql` → Run.
2. **Website**: put the Project URL and the public key (anon, or `sb_publishable_…`) into `config.js`.
3. **Ingest job**: GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
   - `SUPABASE_URL` — the Project URL
   - `SUPABASE_SERVICE_KEY` — the `service_role` key or a secret key (`sb_secret_…`). Never put this one in `config.js`.
4. Actions tab → "Ingest news" → Run workflow, to fill the table right away.

Try the ingest locally without writing anything:

```bash
node scripts/ingest.mjs --dry-run
```

## Deploy

GitHub Pages: Settings → Pages → Build and deployment → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)`.
