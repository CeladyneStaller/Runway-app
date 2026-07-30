-- Runway — migration 029: an admin cannot remove another admin.
--
-- 027 stopped an admin APPOINTING one and left removal alone deliberately, as a separate question. It
-- is now answered: an admin who cannot appoint an admin but can remove one has a lateral attack — take
-- out the other admins, and you are the only one left holding the role you could not have granted
-- yourself. The two rules only work as a pair.
--
-- The rule is the same as granting: you may act on somebody STRICTLY BELOW your own rank, unless you
-- are the owner. Leaving is unaffected — nobody needs permission to stop being in a company — except
-- for the last owner, whose departure would leave nobody able to invite, delete, or decide anything.

create or replace function remove_member(p_company_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare mine member_role := my_role(p_company_id); theirs member_role; owners int;
begin
  select role into theirs from memberships
   where company_id = p_company_id and user_id = p_user_id;
  if theirs is null then return; end if;

  if p_user_id <> auth.uid() then
    -- `may_grant` reads as a grant question and is really a rank question: may I act on somebody of
    -- that rank. Reused rather than duplicated, so appointment and removal cannot drift apart — which
    -- is exactly how the gap this migration closes came to exist.
    if mine is null or role_rank(mine) < role_rank('admin') or not may_grant(mine, theirs) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if theirs = 'owner' then
    select count(*) into owners from memberships
     where company_id = p_company_id and role = 'owner';
    if owners <= 1 then raise exception 'last_owner' using errcode = 'P0012'; end if;
  end if;

  delete from memberships where company_id = p_company_id and user_id = p_user_id;
  perform log_audit(p_company_id, 'member.remove',
                    jsonb_build_object('user_id', p_user_id, 'was', theirs,
                                       'left', p_user_id = auth.uid()));
end $$;

revoke all on function remove_member(uuid, uuid) from public;
grant execute on function remove_member(uuid, uuid) to authenticated;
