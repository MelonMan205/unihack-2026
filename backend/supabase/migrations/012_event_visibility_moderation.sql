-- 012_event_visibility_moderation.sql
-- Add soft-hide moderation control for events.

alter table public.events
  add column if not exists is_hidden boolean not null default false;

drop policy if exists events_select_public on public.events;
create policy events_select_public
  on public.events
  for select
  using (coalesce(is_hidden, false) = false or public.is_admin(auth.uid()));

create index if not exists events_is_hidden_idx on public.events (is_hidden);
