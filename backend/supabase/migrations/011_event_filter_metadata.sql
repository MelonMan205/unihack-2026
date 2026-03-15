-- 011_event_filter_metadata.sql
-- Add lightweight event metadata for richer filters.

set lock_timeout = '2s';

alter table public.events
  add column if not exists price_tier text not null default 'unknown',
  add column if not exists alcohol_policy text not null default 'unknown',
  add column if not exists is_sports boolean not null default false,
  add column if not exists subcategories text[] not null default '{}'::text[];

alter table public.events
  drop constraint if exists events_price_tier_check_v2;

alter table public.events
  add constraint events_price_tier_check_v2
  check (price_tier in ('free', 'budget', 'mid', 'premium', 'unknown'))
  not valid;

alter table public.events
  drop constraint if exists events_alcohol_policy_check_v2;

alter table public.events
  add constraint events_alcohol_policy_check_v2
  check (alcohol_policy in ('alcoholic', 'non_alcoholic', 'mixed', 'unknown'))
  not valid;

alter table public.events
  validate constraint events_price_tier_check_v2;

alter table public.events
  validate constraint events_alcohol_policy_check_v2;

alter table public.events
  drop constraint if exists events_price_tier_check;

alter table public.events
  drop constraint if exists events_alcohol_policy_check;

-- NOTE: Intentionally not creating non-concurrent indexes in this migration.
-- Run manually during low-risk rollout:
-- create index concurrently if not exists events_price_tier_idx on public.events (price_tier);
-- create index concurrently if not exists events_alcohol_policy_idx on public.events (alcohol_policy);
-- create index concurrently if not exists events_is_sports_idx on public.events (is_sports);

create or replace function public.app_list_popular_interest_tags(max_results integer default 40)
returns table (
  tag text,
  weight integer
)
language sql
security definer
set search_path = public
as $$
  with recent_events as (
    select tags
    from public.events
    order by created_at desc
    limit 5000
  )
  select
    lower(trim(tag_value)) as tag,
    count(*)::integer as weight
  from recent_events e
  cross join lateral unnest(coalesce(e.tags, '{}'::text[])) as tag_value
  where trim(tag_value) <> ''
  group by lower(trim(tag_value))
  order by count(*) desc, lower(trim(tag_value)) asc
  limit greatest(5, least(coalesce(max_results, 40), 120));
$$;

revoke all on function public.app_list_popular_interest_tags(integer) from public;
grant execute on function public.app_list_popular_interest_tags(integer) to authenticated;
