-- Runway — migration 025: an invitation consumes a seat, and a full company cannot send one.
--
-- 022 made `company_seat_usage` count pending invitations as taken. This is the other half: refusing to
-- create one when there is nowhere to put the person. Without it a three-seat company sends fifty
-- invitations and the first three to accept win — a race nobody asked to be in, and one where the
-- losers get a link that fails at the moment they try to use it.
--
-- `invite_member` is reproduced from 021 with one block added.

create or replace function invite_member(p_company_id uuid, p_email text, p_role member_role default 'editor')
returns text language plpgsql security definer set search_path = public as $$
declare
  mine     member_role := my_role(p_company_id);
  addr     text := lower(btrim(coalesce(p_email, '')));
  token    text;
  advisor  boolean;
  usage    record;
begin
  if mine is null or role_rank(mine) < role_rank('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if role_rank(p_role) > role_rank(mine) then
    raise exception 'role_too_high' using errcode = 'P0007';
  end if;
  if addr = '' or addr not like '%_@_%.__%' then
    raise exception 'invalid_email' using errcode = 'P0008';
  end if;

  if exists (select 1 from memberships m
               join auth.users u on u.id = m.user_id
              where m.company_id = p_company_id and lower(u.email) = addr) then
    raise exception 'already_member' using errcode = 'P0009';
  end if;

  -- IS THIS PERSON AN ADVISOR? Checked by address, because they may not have an account yet — and an
  -- advisor consumes no seat, which is the whole point of the attribute. Somebody who is not an advisor
  -- today and becomes one later simply frees the seat then; nothing needs recomputing.
  advisor := coalesce((select p.is_advisor
                         from profiles p join auth.users u on u.id = p.user_id
                        where lower(u.email) = addr), false);

  if not advisor then
    select * into usage from company_seat_usage(p_company_id);
    -- SEATS, MINUS MEMBERS, MINUS INVITATIONS ALREADY OUTSTANDING. A company that is over capacity
    -- after a downgrade has none to give either — its existing members are already read-only, and
    -- adding another person would make that worse while looking like it worked.
    if usage.seats - usage.used - usage.pending <= 0 then
      raise exception 'no_seats_left' using errcode = 'P0014';
    end if;
  end if;

  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  update invitations set revoked_at = now()
   where company_id = p_company_id and email = addr
     and accepted_at is null and revoked_at is null and declined_at is null;

  insert into invitations (company_id, email, role, token_hash, invited_by)
  values (p_company_id, addr, p_role, encode(sha256(token::bytea), 'hex'), auth.uid());

  perform log_audit(p_company_id, 'member.invite',
                    jsonb_build_object('email', addr, 'role', p_role, 'advisor', advisor));
  return token;
end $$;

revoke all on function invite_member(uuid, text, member_role) from public;
grant execute on function invite_member(uuid, text, member_role) to authenticated;
