# Kabar Ekonomi — Economic Dashboard

A personal, interactive economic newspaper for learning about central banking: see Indonesia, travel the world, and get AI-assisted insights and ideas.

Six sections: Inflation · FX & World · MSMEs · Payment Systems · Rupiah Circulation · Communication Studio.

- Key data tiles (BI-Rate, CPI inflation, inflation target, FX reserves, JISDOR, INDONIA) come from bi.go.id, checked 17 Nov 2026.
- News inside the sections is still illustrative sample content. A daily update with real news is planned.
- Indonesian sources appear in Bahasa Indonesia; foreign sources appear in English.

This is a personal study project, not an official Bank Indonesia product.

## How it runs

A single static page, with no build step needed to host it:

- `index.html` — the page (markup, styles and logic)
- `petite-vue.iife.js` — [petite-vue](https://github.com/vuejs/petite-vue) (MIT), a tiny library for the interactive parts
- `.nojekyll` — tells GitHub Pages to serve the files as they are

To view it locally, open `index.html` in a browser.

## Deploy

GitHub Pages: Settings → Pages → Build and deployment → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)`.
