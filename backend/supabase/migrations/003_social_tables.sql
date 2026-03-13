-- 003_social_tables.sql
-- Social tables (friends, saved events, RSVPs) and related RLS.

create table if not exists public.friends (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  constraint friends_not_self check (requester_id <> addressee_id)
);

create unique index if not exists friends_unique_pair_idx
  on public.friends (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table if not exists public.saved_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.rsvps (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null check (status in ('going', 'checked_in')),
  hidden_from_friends boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists friends_status_idx on public.friends (status);
create index if not exists saved_events_user_created_idx on public.saved_events (user_id, created_at desc);
create index if not exists rsvps_event_status_idx on public.rsvps (event_id, status);

drop trigger if exists friends_set_updated_at on public.friends;
create trigger friends_set_updated_at
before update on public.friends
for each row
execute function public.set_updated_at();

drop trigger if exists rsvps_set_updated_at on public.rsvps;
create trigger rsvps_set_updated_at
before update on public.rsvps
for each row
execute function public.set_updated_at();

alter table public.friends enable row level security;
alter table public.saved_events enable row level security;
alter table public.rsvps enable row level security;

create policy friends_select_participants
  on public.friends
  for select
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friends_insert_requester
  on public.friends
  for insert
  to authenticated
  with check (requester_id = auth.uid() and addressee_id <> auth.uid());

create policy friends_update_participants
  on public.friends
  for update
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friends_delete_participants
  on public.friends
  for delete
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy saved_events_select_own
  on public.saved_events
  for select
  to authenticated
  using (user_id = auth.uid());

create policy saved_events_insert_own
  on public.saved_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy saved_events_delete_own
  on public.saved_events
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy rsvps_select_own
  on public.rsvps
  for select
  to authenticated
  using (user_id = auth.uid());

create policy rsvps_insert_own
  on public.rsvps
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy rsvps_update_own
  on public.rsvps
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy rsvps_delete_own
  on public.rsvps
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy profiles_select_friends
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.friends f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
          or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
        )
    )
  );