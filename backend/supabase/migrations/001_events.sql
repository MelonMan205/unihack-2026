-- 001_events.sql
-- Core events table for scraper-worker inserts and frontend reads.

create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  venue text,
  time_label text,
  photo_url text,
  location text,
  category text,
  spontaneity_score integer check (spontaneity_score is null or spontaneity_score between 0 and 100),
  crowd_label text check (crowd_label is null or crowd_label in ('quiet', 'moderate', 'busy', 'packed')),
  tags text[] default '{}'::text[],
  description text,
  source_url text not null,
  source text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists events_created_at_idx on public.events (created_at desc);
create index if not exists events_category_idx on public.events (category);
create index if not exists events_source_url_idx on public.events (source_url);

alter table public.events enable row level security;

create policy events_select_public
  on public.events
  for select
  using (true);

create policy events_insert_authenticated_self
  on public.events
  for insert
  to authenticated
  with check (created_by = auth.uid());

create policy events_update_created_by
  on public.events
  for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy events_delete_created_by
  on public.events
  for delete
  to authenticated
  using (created_by = auth.uid());