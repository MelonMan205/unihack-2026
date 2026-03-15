-- 012_event_visibility_moderation.sql
-- Add soft-hide moderation control for events.

set lock_timeout = '2s';

alter table public.events
  add column if not exists is_hidden boolean not null default false;

drop policy if exists events_select_public on public.events;
create policy events_select_public
  on public.events
  for select
  using (coalesce(is_hidden, false) = false or public.is_admin(auth.uid()));

-- NOTE: Intentionally avoiding non-concurrent index creation in this migration to
-- reduce lock risk in SQL editor runs. Add this separately during low traffic:
-- create index concurrently if not exists events_is_hidden_idx on public.events (is_hidden);
