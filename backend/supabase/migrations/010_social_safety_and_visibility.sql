-- 010_social_safety_and_visibility.sql
-- Safety-first social updates:
-- - remove ghost visibility mode
-- - add bounded social RPCs
-- - avoid heavy locking in transactional migration

set lock_timeout = '2s';

update public.event_attendance
set visibility = 'only_me',
    hidden_from_friends = true,
    updated_at = now()
where visibility = 'ghost';

update public.profiles
set privacy_default = 'only_me'
where privacy_default = 'ghost';

alter table public.event_attendance
  drop constraint if exists event_attendance_visibility_check_v2;

alter table public.event_attendance
  add constraint event_attendance_visibility_check_v2
  check (visibility in ('public', 'friends', 'close_friends', 'only_me'))
  not valid;

alter table public.profiles
  drop constraint if exists profiles_privacy_default_check_v2;

alter table public.profiles
  add constraint profiles_privacy_default_check_v2
  check (privacy_default in ('public', 'friends', 'close_friends', 'only_me'))
  not valid;

alter table public.event_attendance
  validate constraint event_attendance_visibility_check_v2;

alter table public.profiles
  validate constraint profiles_privacy_default_check_v2;

alter table public.event_attendance
  drop constraint if exists event_attendance_visibility_check;

alter table public.profiles
  drop constraint if exists profiles_privacy_default_check;

-- NOTE: Intentionally not creating non-concurrent indexes here to avoid write blocking.
-- Run these manually with CREATE INDEX CONCURRENTLY during a low-risk rollout:
-- create index concurrently if not exists friendships_pair_status_updated_idx
--   on public.friendships (
--     least(requester_id, addressee_id),
--     greatest(requester_id, addressee_id),
--     status,
--     updated_at desc
--   );
-- create index concurrently if not exists event_attendance_event_visibility_status_updated_idx
--   on public.event_attendance (event_id, visibility, status, updated_at desc);
-- create index concurrently if not exists friend_group_members_group_member_idx
--   on public.friend_group_members (group_id, member_id);

create or replace function public.can_view_attendance(owner_uuid uuid, visibility_mode text)
returns boolean
language sql
stable
as $$
  select
    case
      when owner_uuid = auth.uid() then true
      when visibility_mode = 'public' then true
      when visibility_mode = 'friends' then public.are_friends(owner_uuid, auth.uid())
      when visibility_mode = 'close_friends' then public.is_close_friend(owner_uuid, auth.uid())
      when visibility_mode = 'only_me' then false
      else false
    end;
$$;

create or replace function public.app_set_attendance(
  event_uuid uuid,
  attendance_status text,
  visibility_mode text default 'friends'
)
returns public.event_attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  attendance public.event_attendance;
begin
  if attendance_status not in ('interested', 'going', 'not_going', 'checked_in') then
    raise exception 'Invalid attendance status';
  end if;
  if visibility_mode not in ('public', 'friends', 'close_friends', 'only_me') then
    raise exception 'Invalid attendance visibility';
  end if;

  insert into public.event_attendance (user_id, event_id, status, visibility, hidden_from_friends)
  values (
    auth.uid(),
    event_uuid,
    attendance_status,
    visibility_mode,
    visibility_mode = 'only_me'
  )
  on conflict (user_id, event_id)
  do update
    set status = excluded.status,
        visibility = excluded.visibility,
        hidden_from_friends = excluded.hidden_from_friends,
        updated_at = now()
  returning * into attendance;

  return attendance;
end;
$$;

create or replace function public.app_remove_friend(target_user_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  relation public.friendships;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'Invalid target user';
  end if;

  update public.friendships
  set status = 'cancelled',
      acted_by = auth.uid(),
      updated_at = now()
  where least(requester_id, addressee_id) = least(auth.uid(), target_user_id)
    and greatest(requester_id, addressee_id) = greatest(auth.uid(), target_user_id)
    and status in ('pending', 'accepted', 'declined', 'cancelled')
  returning * into relation;

  if relation.id is null then
    raise exception 'Friendship not found';
  end if;

  return relation;
end;
$$;

create or replace function public.app_set_close_friend(
  target_user_id uuid,
  make_close boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  close_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'Invalid target user';
  end if;
  if not public.are_friends(auth.uid(), target_user_id) then
    raise exception 'Only accepted friends can be close friends';
  end if;

  select g.id
  into close_group_id
  from public.friend_groups g
  where g.owner_id = auth.uid()
    and lower(g.name) = 'close friends'
  limit 1;

  if close_group_id is null then
    insert into public.friend_groups (owner_id, name, is_system)
    values (auth.uid(), 'Close Friends', true)
    returning id into close_group_id;
  end if;

  if make_close then
    insert into public.friend_group_members (group_id, member_id)
    values (close_group_id, target_user_id)
    on conflict do nothing;
  else
    delete from public.friend_group_members
    where group_id = close_group_id
      and member_id = target_user_id;
  end if;

  return make_close;
end;
$$;

drop function if exists public.app_list_friendships(integer);

create function public.app_list_friendships(max_results integer default 100)
returns table (
  id uuid,
  status text,
  is_incoming boolean,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  is_close_friend boolean
)
language sql
security definer
set search_path = public
as $$
  with relation_rows as (
    select
      f.id,
      f.status,
      (f.addressee_id = auth.uid()) as is_incoming,
      case
        when f.requester_id = auth.uid() then f.addressee_id
        else f.requester_id
      end as other_user_id
    from public.friendships f
    where auth.uid() is not null
      and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    order by f.updated_at desc
    limit greatest(1, least(coalesce(max_results, 100), 200))
  )
  select
    r.id,
    r.status,
    r.is_incoming,
    r.other_user_id,
    p.username as other_username,
    p.display_name as other_display_name,
    public.is_close_friend(auth.uid(), r.other_user_id) as is_close_friend
  from relation_rows r
  left join public.profiles p on p.id = r.other_user_id;
$$;

create or replace function public.app_list_event_friend_attendance(
  event_ids uuid[],
  max_per_event integer default 4,
  statuses text[] default array['going', 'checked_in']::text[]
)
returns table (
  event_id uuid,
  user_id uuid,
  username text,
  display_name text,
  attendee_position integer,
  total_visible integer,
  is_close_friend boolean
)
language sql
security definer
set search_path = public
as $$
  with bounded_ids as (
    select distinct e_id as event_id
    from unnest(event_ids) as e_id
    limit 120
  ),
  visible_rows as (
    select
      a.event_id,
      a.user_id,
      p.username,
      p.display_name,
      public.is_close_friend(auth.uid(), a.user_id) as is_close_friend,
      row_number() over (
        partition by a.event_id
        order by public.is_close_friend(auth.uid(), a.user_id) desc, a.updated_at desc, a.user_id
      ) as row_num,
      count(*) over (partition by a.event_id) as visible_count
    from bounded_ids ids
    join public.event_attendance a on a.event_id = ids.event_id
    left join public.profiles p on p.id = a.user_id
    where auth.uid() is not null
      and a.user_id <> auth.uid()
      and a.status = any (coalesce(statuses, array['going', 'checked_in']::text[]))
      and public.can_view_attendance(a.user_id, a.visibility)
      and exists (
        select 1
        from public.friendships f
        where f.status = 'accepted'
          and least(f.requester_id, f.addressee_id) = least(auth.uid(), a.user_id)
          and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), a.user_id)
      )
  )
  select
    event_id,
    user_id,
    username,
    display_name,
    row_num::integer as attendee_position,
    visible_count::integer as total_visible,
    is_close_friend
  from visible_rows
  where row_num <= greatest(1, least(coalesce(max_per_event, 4), 8))
  order by event_id, row_num;
$$;

revoke all on function public.app_remove_friend(uuid) from public;
grant execute on function public.app_remove_friend(uuid) to authenticated;

revoke all on function public.app_set_close_friend(uuid, boolean) from public;
grant execute on function public.app_set_close_friend(uuid, boolean) to authenticated;

revoke all on function public.app_list_friendships(integer) from public;
grant execute on function public.app_list_friendships(integer) to authenticated;

revoke all on function public.app_list_event_friend_attendance(uuid[], integer, text[]) from public;
grant execute on function public.app_list_event_friend_attendance(uuid[], integer, text[]) to authenticated;
