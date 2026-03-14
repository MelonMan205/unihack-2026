-- 005_users_spec_foundation.sql
-- Production data model expansion for USERS_SPEC features.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'app_role'
  ) then
    create type public.app_role as enum ('user', 'organizer', 'admin');
  end if;
end
$$;

alter table public.profiles
  add column if not exists username text,
  add column if not exists bio text,
  add column if not exists privacy_default text not null default 'friends',
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists interests text[] not null default '{}'::text[],
  add column if not exists attended_week_count integer not null default 0,
  add column if not exists attended_month_count integer not null default 0,
  add column if not exists attended_year_count integer not null default 0,
  add column if not exists attended_total_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_privacy_default_check'
  ) then
    alter table public.profiles
      add constraint profiles_privacy_default_check
      check (privacy_default in ('public', 'friends', 'close_friends', 'only_me', 'ghost'));
  end if;
end
$$;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null and btrim(username) <> '';

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'user',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

drop trigger if exists user_roles_set_updated_at on public.user_roles;
create trigger user_roles_set_updated_at
before update on public.user_roles
for each row
execute function public.set_updated_at();

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  acted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_status_check
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'blocked'))
);

create unique index if not exists friendships_unique_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_status_idx
  on public.friendships (requester_id, status, updated_at desc);
create index if not exists friendships_addressee_status_idx
  on public.friendships (addressee_id, status, updated_at desc);

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
before update on public.friendships
for each row
execute function public.set_updated_at();

create table if not exists public.friend_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_groups_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists friend_groups_owner_name_unique_idx
  on public.friend_groups (owner_id, lower(name));

drop trigger if exists friend_groups_set_updated_at on public.friend_groups;
create trigger friend_groups_set_updated_at
before update on public.friend_groups
for each row
execute function public.set_updated_at();

create table if not exists public.friend_group_members (
  group_id uuid not null references public.friend_groups(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, member_id)
);

create table if not exists public.event_attendance (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null,
  visibility text not null default 'friends',
  hidden_from_friends boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id),
  constraint event_attendance_status_check
    check (status in ('interested', 'going', 'not_going', 'checked_in')),
  constraint event_attendance_visibility_check
    check (visibility in ('public', 'friends', 'close_friends', 'only_me', 'ghost'))
);

create index if not exists event_attendance_event_status_idx
  on public.event_attendance (event_id, status);
create index if not exists event_attendance_user_updated_idx
  on public.event_attendance (user_id, updated_at desc);

drop trigger if exists event_attendance_set_updated_at on public.event_attendance;
create trigger event_attendance_set_updated_at
before update on public.event_attendance
for each row
execute function public.set_updated_at();

create table if not exists public.event_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  expires_at timestamptz not null,
  is_active boolean not null default true,
  source text not null default 'manual'
);

create index if not exists event_checkins_event_active_idx
  on public.event_checkins (event_id, is_active, expires_at);
create unique index if not exists event_checkins_active_unique_idx
  on public.event_checkins (user_id, event_id)
  where is_active = true;

create table if not exists public.saved_event_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_event_collections_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists saved_event_collections_user_name_idx
  on public.saved_event_collections (user_id, lower(name));

drop trigger if exists saved_event_collections_set_updated_at on public.saved_event_collections;
create trigger saved_event_collections_set_updated_at
before update on public.saved_event_collections
for each row
execute function public.set_updated_at();

create table if not exists public.saved_event_items (
  collection_id uuid not null references public.saved_event_collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (collection_id, event_id)
);

create index if not exists saved_event_items_user_created_idx
  on public.saved_event_items (user_id, created_at desc);

create table if not exists public.event_shares (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete set null,
  event_id uuid not null references public.events(id) on delete cascade,
  channel text not null,
  external_target text,
  created_at timestamptz not null default now(),
  constraint event_shares_channel_check
    check (channel in ('in_app', 'copy_link', 'whatsapp', 'instagram', 'other'))
);

create index if not exists event_shares_sender_created_idx
  on public.event_shares (sender_id, created_at desc);
create index if not exists event_shares_recipient_created_idx
  on public.event_shares (recipient_id, created_at desc);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  event_reminders boolean not null default true,
  social_activity boolean not null default true,
  nearby_events boolean not null default true,
  organizer_posts boolean not null default true,
  push_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row
execute function public.set_updated_at();

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

drop trigger if exists device_tokens_set_updated_at on public.device_tokens;
create trigger device_tokens_set_updated_at
before update on public.device_tokens
for each row
execute function public.set_updated_at();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_status_check check (status in ('queued', 'sent', 'failed', 'cancelled'))
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_queue_idx
  on public.notifications (status, scheduled_for)
  where status = 'queued';

create table if not exists public.organizer_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_name text not null,
  organization_email text not null,
  website_url text,
  evidence text,
  status text not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizer_verification_requests_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists organizer_verification_requests_status_idx
  on public.organizer_verification_requests (status, created_at desc);

drop trigger if exists organizer_verification_requests_set_updated_at on public.organizer_verification_requests;
create trigger organizer_verification_requests_set_updated_at
before update on public.organizer_verification_requests
for each row
execute function public.set_updated_at();

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_event_id uuid references public.events(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open',
  assigned_admin_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_target_type_check check (target_type in ('user', 'event')),
  constraint reports_status_check check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  constraint reports_target_check check (
    (target_type = 'user' and target_user_id is not null and target_event_id is null)
    or
    (target_type = 'event' and target_event_id is not null and target_user_id is null)
  )
);

create index if not exists reports_status_created_idx
  on public.reports (status, created_at desc);

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
before update on public.reports
for each row
execute function public.set_updated_at();

create table if not exists public.user_bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  banned_by uuid not null references auth.users(id) on delete restrict,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_bans_user_active_idx
  on public.user_bans (user_id, is_active, starts_at desc);

drop trigger if exists user_bans_set_updated_at on public.user_bans;
create trigger user_bans_set_updated_at
before update on public.user_bans
for each row
execute function public.set_updated_at();

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete restrict,
  report_id uuid references public.reports(id) on delete set null,
  action_type text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_event_id uuid references public.events(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  constraint moderation_actions_type_check
    check (action_type in ('ban_user', 'unban_user', 'remove_event', 'restore_event', 'edit_event', 'verify_organizer', 'reject_organizer'))
);

create index if not exists moderation_actions_created_idx
  on public.moderation_actions (created_at desc);

create table if not exists public.event_views (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  viewer_id uuid references auth.users(id) on delete set null,
  viewed_at timestamptz not null default now()
);

create index if not exists event_views_event_viewed_at_idx
  on public.event_views (event_id, viewed_at desc);

create table if not exists public.event_crowd_forecasts (
  event_id uuid primary key references public.events(id) on delete cascade,
  forecast_label text not null,
  confidence numeric(5,2) not null default 0.50,
  computed_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  constraint event_crowd_forecasts_label_check
    check (forecast_label in ('low', 'medium', 'high')),
  constraint event_crowd_forecasts_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

create or replace view public.user_event_activity_stats as
select
  a.user_id,
  count(*) filter (where a.status = 'checked_in')::integer as total_checked_in,
  count(*) filter (where a.status = 'going')::integer as total_going,
  count(*) filter (where a.status = 'interested')::integer as total_interested,
  count(*)::integer as total_actions
from public.event_attendance a
group by a.user_id;

create or replace view public.organizer_event_metrics as
select
  e.created_by as organizer_id,
  e.id as event_id,
  count(distinct v.id)::integer as view_count,
  count(distinct a.user_id) filter (where a.status = 'interested')::integer as interested_count,
  count(distinct a.user_id) filter (where a.status = 'going')::integer as going_count,
  count(distinct c.user_id) filter (where c.is_active = true)::integer as active_checkins
from public.events e
left join public.event_views v on v.event_id = e.id
left join public.event_attendance a on a.event_id = e.id
left join public.event_checkins c on c.event_id = e.id
group by e.created_by, e.id;
