-- 006_users_spec_security_rpc.sql
-- RLS hardening and RPC workflows for USERS_SPEC.

create or replace function public.is_admin(check_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = check_user_id
      and ur.role = 'admin'::public.app_role
  );
$$;

create or replace function public.is_organizer(check_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = check_user_id
      and ur.role in ('organizer'::public.app_role, 'admin'::public.app_role)
  );
$$;

create or replace function public.are_friends(user_a uuid, user_b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = user_a and f.addressee_id = user_b)
        or (f.requester_id = user_b and f.addressee_id = user_a)
      )
  );
$$;

create or replace function public.is_close_friend(owner_uuid uuid, viewer_uuid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.friend_groups g
    join public.friend_group_members m on m.group_id = g.id
    where g.owner_id = owner_uuid
      and lower(g.name) = 'close friends'
      and m.member_id = viewer_uuid
  );
$$;

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
      when visibility_mode = 'ghost' then false
      else false
    end;
$$;

create or replace function public.can_view_profile(profile_id uuid)
returns boolean
language sql
stable
as $$
  select
    case
      when profile_id = auth.uid() then true
      when exists (
        select 1
        from public.profiles p
        where p.id = profile_id
          and p.privacy_default = 'public'
      ) then true
      when exists (
        select 1
        from public.profiles p
        where p.id = profile_id
          and p.privacy_default = 'friends'
          and public.are_friends(profile_id, auth.uid())
      ) then true
      when exists (
        select 1
        from public.profiles p
        where p.id = profile_id
          and p.privacy_default = 'close_friends'
          and public.is_close_friend(profile_id, auth.uid())
      ) then true
      else false
    end;
$$;

create or replace function public.bootstrap_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict do nothing;

  if not exists (
    select 1
    from public.friend_groups
    where owner_id = new.id
      and lower(name) = 'close friends'
  ) then
    insert into public.friend_groups (owner_id, name, is_system)
    values (new.id, 'Close Friends', true);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_bootstrap_role on auth.users;
create trigger on_auth_user_bootstrap_role
after insert on auth.users
for each row
execute function public.bootstrap_user_role();

alter table public.user_roles enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_groups enable row level security;
alter table public.friend_group_members enable row level security;
alter table public.event_attendance enable row level security;
alter table public.event_checkins enable row level security;
alter table public.saved_event_collections enable row level security;
alter table public.saved_event_items enable row level security;
alter table public.event_shares enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.device_tokens enable row level security;
alter table public.organizer_verification_requests enable row level security;
alter table public.reports enable row level security;
alter table public.user_bans enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.event_views enable row level security;
alter table public.event_crowd_forecasts enable row level security;

drop policy if exists user_roles_select_self on public.user_roles;
create policy user_roles_select_self
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists user_roles_insert_admin on public.user_roles;
create policy user_roles_insert_admin
  on public.user_roles
  for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

drop policy if exists user_roles_update_admin on public.user_roles;
create policy user_roles_update_admin
  on public.user_roles
  for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists user_roles_delete_admin on public.user_roles;
create policy user_roles_delete_admin
  on public.user_roles
  for delete
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy
  on public.profiles
  for select
  to authenticated
  using (public.can_view_profile(id) or public.is_admin(auth.uid()));

drop policy if exists friendships_select_participants on public.friendships;
create policy friendships_select_participants
  on public.friendships
  for select
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists friendships_insert_requester on public.friendships;
create policy friendships_insert_requester
  on public.friendships
  for insert
  to authenticated
  with check (requester_id = auth.uid() and addressee_id <> auth.uid());

drop policy if exists friendships_update_participants on public.friendships;
create policy friendships_update_participants
  on public.friendships
  for update
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid() or public.is_admin(auth.uid()))
  with check (requester_id = auth.uid() or addressee_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists friend_groups_select_owner on public.friend_groups;
create policy friend_groups_select_owner
  on public.friend_groups
  for select
  to authenticated
  using (owner_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists friend_groups_mutate_owner on public.friend_groups;
create policy friend_groups_mutate_owner
  on public.friend_groups
  for all
  to authenticated
  using (owner_id = auth.uid() or public.is_admin(auth.uid()))
  with check (owner_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists friend_group_members_select_owner on public.friend_group_members;
create policy friend_group_members_select_owner
  on public.friend_group_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.friend_groups g
      where g.id = friend_group_members.group_id
        and (g.owner_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

drop policy if exists friend_group_members_mutate_owner on public.friend_group_members;
create policy friend_group_members_mutate_owner
  on public.friend_group_members
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.friend_groups g
      where g.id = friend_group_members.group_id
        and (g.owner_id = auth.uid() or public.is_admin(auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from public.friend_groups g
      where g.id = friend_group_members.group_id
        and (g.owner_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

drop policy if exists event_attendance_select_policy on public.event_attendance;
create policy event_attendance_select_policy
  on public.event_attendance
  for select
  to authenticated
  using (
    public.can_view_attendance(user_id, visibility)
    or public.is_admin(auth.uid())
  );

drop policy if exists event_attendance_mutate_owner on public.event_attendance;
create policy event_attendance_mutate_owner
  on public.event_attendance
  for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists event_checkins_select_policy on public.event_checkins;
create policy event_checkins_select_policy
  on public.event_checkins
  for select
  to authenticated
  using (
    is_active = true
    and (
      public.can_view_attendance(user_id, 'friends')
      or user_id = auth.uid()
      or public.is_admin(auth.uid())
    )
  );

drop policy if exists event_checkins_mutate_owner on public.event_checkins;
create policy event_checkins_mutate_owner
  on public.event_checkins
  for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists saved_event_collections_owner_policy on public.saved_event_collections;
create policy saved_event_collections_owner_policy
  on public.saved_event_collections
  for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists saved_event_items_owner_policy on public.saved_event_items;
create policy saved_event_items_owner_policy
  on public.saved_event_items
  for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists event_shares_owner_or_recipient on public.event_shares;
create policy event_shares_owner_or_recipient
  on public.event_shares
  for select
  to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists event_shares_insert_sender on public.event_shares;
create policy event_shares_insert_sender
  on public.event_shares
  for insert
  to authenticated
  with check (sender_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists notification_preferences_owner_policy on public.notification_preferences;
create policy notification_preferences_owner_policy
  on public.notification_preferences
  for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists notifications_owner_policy on public.notifications;
create policy notifications_owner_policy
  on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists notifications_mark_read_policy on public.notifications;
create policy notifications_mark_read_policy
  on public.notifications
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists notifications_insert_admin_only on public.notifications;
create policy notifications_insert_admin_only
  on public.notifications
  for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

drop policy if exists device_tokens_owner_policy on public.device_tokens;
create policy device_tokens_owner_policy
  on public.device_tokens
  for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists organizer_verification_requests_select_policy on public.organizer_verification_requests;
create policy organizer_verification_requests_select_policy
  on public.organizer_verification_requests
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists organizer_verification_requests_insert_policy on public.organizer_verification_requests;
create policy organizer_verification_requests_insert_policy
  on public.organizer_verification_requests
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists organizer_verification_requests_update_policy on public.organizer_verification_requests;
create policy organizer_verification_requests_update_policy
  on public.organizer_verification_requests
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists reports_owner_admin_select on public.reports;
create policy reports_owner_admin_select
  on public.reports
  for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists reports_owner_insert on public.reports;
create policy reports_owner_insert
  on public.reports
  for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update
  on public.reports
  for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists user_bans_self_admin_select on public.user_bans;
create policy user_bans_self_admin_select
  on public.user_bans
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists user_bans_admin_mutate on public.user_bans;
create policy user_bans_admin_mutate
  on public.user_bans
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists moderation_actions_admin_only on public.moderation_actions;
create policy moderation_actions_admin_only
  on public.moderation_actions
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists event_views_insert_policy on public.event_views;
create policy event_views_insert_policy
  on public.event_views
  for insert
  to authenticated
  with check (viewer_id = auth.uid() or viewer_id is null);

drop policy if exists event_views_select_owner_or_admin on public.event_views;
create policy event_views_select_owner_or_admin
  on public.event_views
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_views.event_id
        and (e.created_by = auth.uid() or public.is_admin(auth.uid()))
    )
  );

drop policy if exists event_crowd_forecasts_public_read on public.event_crowd_forecasts;
create policy event_crowd_forecasts_public_read
  on public.event_crowd_forecasts
  for select
  using (true);

drop policy if exists event_crowd_forecasts_admin_write on public.event_crowd_forecasts;
create policy event_crowd_forecasts_admin_write
  on public.event_crowd_forecasts
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists events_insert_authenticated_self on public.events;
drop policy if exists events_update_created_by on public.events;
drop policy if exists events_delete_created_by on public.events;

create policy events_insert_organizer
  on public.events
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_organizer(auth.uid())
  );

create policy events_update_owner_or_admin
  on public.events
  for update
  to authenticated
  using (created_by = auth.uid() or public.is_admin(auth.uid()))
  with check (created_by = auth.uid() or public.is_admin(auth.uid()));

create policy events_delete_owner_or_admin
  on public.events
  for delete
  to authenticated
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

create or replace function public.app_send_friend_request(target_user_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  relation public.friendships;
begin
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'Invalid target user';
  end if;

  update public.friendships
  set requester_id = auth.uid(),
      addressee_id = target_user_id,
      status = 'pending',
      acted_by = auth.uid(),
      updated_at = now()
  where least(requester_id, addressee_id) = least(auth.uid(), target_user_id)
    and greatest(requester_id, addressee_id) = greatest(auth.uid(), target_user_id)
  returning * into relation;

  if relation.id is null then
    insert into public.friendships (requester_id, addressee_id, status, acted_by)
    values (auth.uid(), target_user_id, 'pending', auth.uid())
    returning * into relation;
  end if;

  return relation;
end;
$$;

create or replace function public.app_respond_friend_request(friendship_id uuid, decision text)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  relation public.friendships;
  next_status text;
begin
  if decision not in ('accepted', 'declined', 'cancelled') then
    raise exception 'Invalid decision';
  end if;
  next_status := decision;

  update public.friendships
  set status = next_status,
      acted_by = auth.uid(),
      updated_at = now()
  where id = friendship_id
    and (requester_id = auth.uid() or addressee_id = auth.uid())
  returning * into relation;

  if relation.id is null then
    raise exception 'Friend request not found';
  end if;

  return relation;
end;
$$;

create or replace function public.app_block_user(target_user_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  relation public.friendships;
begin
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'Invalid target user';
  end if;

  update public.friendships
  set requester_id = auth.uid(),
      addressee_id = target_user_id,
      status = 'blocked',
      acted_by = auth.uid(),
      updated_at = now()
  where least(requester_id, addressee_id) = least(auth.uid(), target_user_id)
    and greatest(requester_id, addressee_id) = greatest(auth.uid(), target_user_id)
  returning * into relation;

  if relation.id is null then
    insert into public.friendships (requester_id, addressee_id, status, acted_by)
    values (auth.uid(), target_user_id, 'blocked', auth.uid())
    returning * into relation;
  end if;

  return relation;
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
  if visibility_mode not in ('public', 'friends', 'close_friends', 'only_me', 'ghost') then
    raise exception 'Invalid attendance visibility';
  end if;

  insert into public.event_attendance (user_id, event_id, status, visibility, hidden_from_friends)
  values (
    auth.uid(),
    event_uuid,
    attendance_status,
    visibility_mode,
    visibility_mode in ('ghost', 'only_me')
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

create or replace function public.app_check_in(event_uuid uuid, ttl_minutes integer default 240)
returns public.event_checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  checkin public.event_checkins;
begin
  if ttl_minutes < 10 then
    ttl_minutes := 10;
  end if;

  update public.event_checkins
  set is_active = false
  where user_id = auth.uid()
    and event_id = event_uuid
    and is_active = true;

  insert into public.event_checkins (user_id, event_id, expires_at)
  values (auth.uid(), event_uuid, now() + make_interval(mins => ttl_minutes))
  returning * into checkin;

  perform public.app_set_attendance(event_uuid, 'checked_in', 'friends');
  return checkin;
end;
$$;

create or replace function public.app_admin_review_organizer_request(
  request_id uuid,
  approved boolean,
  review_notes text default null
)
returns public.organizer_verification_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.organizer_verification_requests;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Unauthorized';
  end if;

  update public.organizer_verification_requests
  set status = case when approved then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      evidence = coalesce(evidence, '') || case when review_notes is not null then E'\n\nreview: ' || review_notes else '' end,
      updated_at = now()
  where id = request_id
  returning * into request_row;

  if request_row.id is null then
    raise exception 'Verification request not found';
  end if;

  if approved then
    insert into public.user_roles (user_id, role, granted_by)
    values (request_row.user_id, 'organizer', auth.uid())
    on conflict do nothing;
  end if;

  return request_row;
end;
$$;

create or replace function public.app_expire_checkins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  row_count integer;
begin
  update public.event_checkins
  set is_active = false
  where is_active = true
    and expires_at <= now();

  get diagnostics row_count = row_count;
  return row_count;
end;
$$;
