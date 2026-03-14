-- 008_safe_profile_search.sql
-- Hardened profile search RPC with strict guardrails.

create index if not exists profiles_username_prefix_idx
  on public.profiles (lower(username) text_pattern_ops)
  where username is not null and btrim(username) <> '';

create or replace function public.app_search_profiles(
  search_text text,
  max_results integer default 8
)
returns table (
  id uuid,
  username text,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_query text := lower(btrim(coalesce(search_text, '')));
  safe_limit integer := greatest(1, least(coalesce(max_results, 8), 10));
begin
  if auth.uid() is null then
    return;
  end if;

  normalized_query := regexp_replace(normalized_query, '[%_\\]', '', 'g');

  if length(normalized_query) < 3 then
    return;
  end if;

  return query
  select
    p.id,
    p.username,
    p.display_name
  from public.profiles p
  where p.id <> auth.uid()
    and p.username is not null
    and btrim(p.username) <> ''
    and lower(p.username) like normalized_query || '%'
    and public.can_view_profile(p.id)
  order by
    case when lower(p.username) = normalized_query then 0 else 1 end,
    char_length(p.username),
    lower(p.username),
    p.id
  limit safe_limit;
end;
$$;

revoke all on function public.app_search_profiles(text, integer) from public;
grant execute on function public.app_search_profiles(text, integer) to authenticated;
