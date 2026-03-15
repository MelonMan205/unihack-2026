-- 013_event_validity_and_recurrence.sql
-- Enforce event time validity, organizer duplicate prevention, recurrence metadata,
-- and exclude expired rows from public visibility.
--
-- SAFETY NOTE:
-- - This migration intentionally avoids blocking table-wide operations.
-- - Constraints are added as NOT VALID first; validate later in a low-traffic window.
-- - The unique duplicate index must be created CONCURRENTLY outside transaction-wrapped migrations.

set lock_timeout = '2s';

alter table public.events
  add column if not exists recurrence_cadence text not null default 'none',
  add column if not exists recurrence_weekdays smallint[] null,
  add column if not exists recurrence_until timestamptz null;

alter table public.events
  drop constraint if exists events_time_window_check,
  add constraint events_time_window_check
    check (end_at is null or start_at is null or end_at > start_at) not valid,
  drop constraint if exists events_recurrence_cadence_check,
  add constraint events_recurrence_cadence_check
    check (recurrence_cadence in ('none', 'daily', 'weekly', 'monthly')) not valid,
  drop constraint if exists events_recurrence_weekdays_check,
  add constraint events_recurrence_weekdays_check
    check (
      recurrence_cadence <> 'weekly'
      or (
        recurrence_weekdays is not null
        and cardinality(recurrence_weekdays) > 0
        and not exists (
          select 1
          from unnest(recurrence_weekdays) as weekday_value
          where weekday_value < 0 or weekday_value > 6
        )
      )
    ) not valid,
  drop constraint if exists events_recurrence_weekdays_unused_check,
  add constraint events_recurrence_weekdays_unused_check
    check (recurrence_cadence = 'weekly' or recurrence_weekdays is null) not valid,
  drop constraint if exists events_recurrence_until_check,
  add constraint events_recurrence_until_check
    check (recurrence_until is null or start_at is null or recurrence_until >= start_at) not valid;

-- Validate constraints in a controlled low-traffic window.
-- These validations can scan the table, but they avoid long ACCESS EXCLUSIVE locks.
alter table public.events validate constraint events_time_window_check;
alter table public.events validate constraint events_recurrence_cadence_check;
alter table public.events validate constraint events_recurrence_weekdays_check;
alter table public.events validate constraint events_recurrence_weekdays_unused_check;
alter table public.events validate constraint events_recurrence_until_check;

-- IMPORTANT: do NOT create the unique duplicate index here because concurrent index
-- builds cannot run inside transaction blocks used by many migration runners.
-- Run this manually (or in a non-transaction migration) during normal operations:
--
-- select
--   created_by,
--   lower(btrim(title)) as normalized_title,
--   start_at,
--   lower(btrim(coalesce(location, ''))) as normalized_location,
--   count(*) as duplicate_count
-- from public.events
-- where created_by is not null and start_at is not null
-- group by created_by, lower(btrim(title)), start_at, lower(btrim(coalesce(location, '')))
-- having count(*) > 1;
--
-- create unique index concurrently if not exists events_organizer_duplicate_guard_idx
--   on public.events (
--     created_by,
--     lower(btrim(title)),
--     start_at,
--     lower(btrim(coalesce(location, '')))
--   )
--   where created_by is not null and start_at is not null;

drop policy if exists events_select_public on public.events;
create policy events_select_public
  on public.events
  for select
  using (
    (coalesce(is_hidden, false) = false or public.is_admin(auth.uid()))
    and (
      coalesce(end_at, start_at) is null
      or coalesce(end_at, start_at) >= now()
      or public.is_admin(auth.uid())
    )
  );
