-- 009_safe_friendships_list.sql
-- Hardened RPC for listing friendships with profile preview.

create or replace function public.app_list_friendships(max_results integer default 100)
returns table (
  id uuid,
  status text,
  is_incoming boolean,
  other_user_id uuid,
  other_username text,
  other_display_name text
)
language sql
security definer
set search_path = public
as $$
  select
    f.id,
    f.status,
    (f.addressee_id = auth.uid()) as is_incoming,
    case
      when f.requester_id = auth.uid() then f.addressee_id
      else f.requester_id
    end as other_user_id,
    p.username as other_username,
    p.display_name as other_display_name
  from public.friendships f
  left join public.profiles p
    on p.id = case
      when f.requester_id = auth.uid() then f.addressee_id
      else f.requester_id
    end
  where auth.uid() is not null
    and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
  order by f.updated_at desc
  limit greatest(1, least(coalesce(max_results, 100), 200));
$$;

revoke all on function public.app_list_friendships(integer) from public;
grant execute on function public.app_list_friendships(integer) to authenticated;
