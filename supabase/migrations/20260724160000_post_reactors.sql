-- List the members who reacted to a post with a specific emoji.
-- Used by the "tap and hold a reaction" UI. Reactions only exist on
-- accepted + visible posts (enforced by toggle_reaction), so membership is
-- the only gate needed.

create or replace function public.get_post_reactors(
  p_attempt_id uuid,
  p_emoji text
)
returns table (
  user_id uuid,
  display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_active_member() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
  select r.user_id, coalesce(p.display_name, 'Player')
  from public.reactions r
  join public.profiles p on p.id = r.user_id
  where r.attempt_id = p_attempt_id
    and r.emoji = p_emoji
  order by r.created_at asc;
end;
$$;

revoke all on function public.get_post_reactors(uuid, text) from public;
grant execute on function public.get_post_reactors(uuid, text) to authenticated;
