-- Kabar Ekonomi — live news table
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again: every statement is idempotent.

create table if not exists public.news_articles (
  id            bigint generated always as identity primary key,
  url           text        not null unique,          -- link to the original article (dedup key)
  title         text        not null,
  summary       text,                                  -- short snippet only, never the full article
  image_url     text,                                  -- hotlinked from the outlet, not re-hosted
  source        text        not null,                  -- outlet name, e.g. "Antara"
  source_domain text,
  lang          text        not null default 'id',     -- 'id' or 'en'
  scope         text        not null default 'id',     -- 'id' = Indonesia, 'global' = world
  category      text        not null default 'umum',   -- inflasi | moneter | pasar | bayar | rupiah | umkm | dunia | umum
  published_at  timestamptz not null default now(),
  fetched_at    timestamptz not null default now()
);

create index if not exists news_articles_published_idx on public.news_articles (published_at desc);
create index if not exists news_articles_category_idx  on public.news_articles (category, published_at desc);

-- Row Level Security: anyone may READ, nobody may write with the public key.
-- The ingestion job writes with the secret / service_role key, which bypasses RLS.
alter table public.news_articles enable row level security;

drop policy if exists "news are publicly readable" on public.news_articles;
create policy "news are publicly readable"
  on public.news_articles for select
  to anon, authenticated
  using (true);

-- Realtime: push new rows to the website instantly.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'news_articles'
  ) then
    alter publication supabase_realtime add table public.news_articles;
  end if;
end $$;
