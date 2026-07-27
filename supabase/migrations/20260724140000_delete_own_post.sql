-- Allow a member to delete their own post.
--
-- Hard-deletes the attempt; FKs cascade to its award, reactions, comments,
-- feed_hides and reports. The owner's score is then recomputed from source
-- (private.recompute_user_score), which subtracts the challenge points the
-- post earned plus any reaction bonuses it had accrued. The orphaned storage
-- object is left for the existing cleanup-orphans job.

create or replace function public.delete_own_post(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
begin
  if not public.is_active_member() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select a.user_id into v_owner
  from public.attempts a
  where a.id = p_attempt_id;

  if v_owner is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_owner <> v_uid then
    raise exception 'NOT_OWNER';
  end if;

  -- Cascades to awards / reactions / comments / feed_hides / reports.
  delete from public.attempts where id = p_attempt_id;

  perform private.recompute_user_score(v_uid);
end;
$$;

revoke all on function public.delete_own_post(uuid) from public;
grant execute on function public.delete_own_post(uuid) to authenticated;
