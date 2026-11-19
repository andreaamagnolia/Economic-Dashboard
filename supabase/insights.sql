-- Kabar Ekonomi — AI insights table
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again: every statement is idempotent.

create table if not exists public.news_insights (
  id              bigint generated always as identity primary key,
  category        text        not null,               -- 'semua' (overall brief) or a news category
  lang            text        not null default 'id',
  headline        text        not null,
  summary         text        not null,
  points          jsonb       not null default '[]',  -- [{ "text": "...", "sources": [1, 4] }]
  why_it_matters  text,
  watch_next      jsonb       not null default '[]',  -- ["...", "..."]
  sources         jsonb       not null default '[]',  -- [{ "n": 1, "title": "...", "url": "...", "source": "..." }]
  story_count     int         not null default 0,
  model           text        not null,
  generated_at    timestamptz not null default now()
);

create index if not exists news_insights_cat_idx on public.news_insights (category, generated_at desc);

-- Anyone may read; only the insight job (secret / service_role key) writes.
alter table public.news_insights enable row level security;

drop policy if exists "insights are publicly readable" on public.news_insights;
create policy "insights are publicly readable"
  on public.news_insights for select
  to anon, authenticated
  using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'news_insights'
  ) then
    alter publication supabase_realtime add table public.news_insights;
  end if;
end $$;
