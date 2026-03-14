-- 004_waitlist_signups.sql
-- Stores waitlist submissions collected by waitlist-worker.

create extension if not exists pgcrypto;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(trim(full_name)) >= 2),
  email text not null unique,
  suburb text,
  intent text,
  source text default 'waitlist-worker',
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

create index if not exists waitlist_signups_email_idx
  on public.waitlist_signups (email);

alter table public.waitlist_signups enable row level security;

-- Keep table private by default. Service-role writes from worker bypass RLS.
