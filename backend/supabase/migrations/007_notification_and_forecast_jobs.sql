-- 007_notification_and_forecast_jobs.sql
-- Scheduled reminder and crowd forecast helpers.

alter table public.events
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz;

create index if not exists events_start_at_idx on public.events (start_at);

create or replace function public.app_queue_event_reminders(window_minutes integer default 60)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if window_minutes < 5 then
    window_minutes := 5;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    payload,
    status,
    scheduled_for
  )
  select
    a.user_id,
    'event_reminder',
    'Event reminder',
    format('%s starts soon', e.title),
    jsonb_build_object('event_id', e.id, 'event_title', e.title, 'start_at', e.start_at),
    'queued',
    now()
  from public.event_attendance a
  join public.events e on e.id = a.event_id
  join public.notification_preferences p on p.user_id = a.user_id
  where a.status in ('interested', 'going')
    and p.event_reminders = true
    and p.in_app_enabled = true
    and e.start_at is not null
    and e.start_at > now()
    and e.start_at <= now() + make_interval(mins => window_minutes)
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = a.user_id
        and n.type = 'event_reminder'
        and n.payload ->> 'event_id' = e.id::text
        and n.created_at >= now() - interval '2 hours'
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.app_refresh_crowd_forecasts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  insert into public.event_crowd_forecasts (
    event_id,
    forecast_label,
    confidence,
    computed_at,
    details
  )
  select
    e.id as event_id,
    case
      when coalesce(att.going_count, 0) + coalesce(chk.checkin_count, 0) >= 40 then 'high'
      when coalesce(att.going_count, 0) + coalesce(chk.checkin_count, 0) >= 12 then 'medium'
      else 'low'
    end as forecast_label,
    least(
      1.0,
      0.35
      + (coalesce(att.interested_count, 0) * 0.01)
      + (coalesce(att.going_count, 0) * 0.015)
      + (coalesce(chk.checkin_count, 0) * 0.02)
    )::numeric(5,2) as confidence,
    now(),
    jsonb_build_object(
      'interested_count', coalesce(att.interested_count, 0),
      'going_count', coalesce(att.going_count, 0),
      'checkin_count', coalesce(chk.checkin_count, 0)
    )
  from public.events e
  left join (
    select
      event_id,
      count(*) filter (where status = 'interested')::integer as interested_count,
      count(*) filter (where status in ('going', 'checked_in'))::integer as going_count
    from public.event_attendance
    group by event_id
  ) att on att.event_id = e.id
  left join (
    select event_id, count(*)::integer as checkin_count
    from public.event_checkins
    where is_active = true
    group by event_id
  ) chk on chk.event_id = e.id
  on conflict (event_id)
  do update
    set forecast_label = excluded.forecast_label,
        confidence = excluded.confidence,
        computed_at = excluded.computed_at,
        details = excluded.details;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;
