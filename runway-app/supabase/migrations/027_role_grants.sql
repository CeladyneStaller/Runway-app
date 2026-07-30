-- Runway — migration 027: two corrections to the role model.
--
-- 1. ONLY AN OWNER MAY APPOINT AN ADMIN. 021 allowed anybody to grant a role up to their own, so an
--    admin could mint admins. The rule is now "strictly below your own rank, unless you are the owner",
--    which lets an owner appoint another owner while stopping the junior tier from replicating itself.
--    An admin who can make admins can also make one out of their own second address, and from there
--    every other check in this schema is decorative.
--
-- 2. AN ADVISOR IS A VIEWER. The attribute exists so somebody can be in a company without occupying a
--    seat; letting them hold `editor` would be a seat-free editor, which is the seat model with a hole
--    in it. Their planning happens in their own layer (028), not in the company's document.
--
-- Removal is deliberately NOT changed here. An admin can still remove another admin, which is a
-- separate question from appointment and worth deciding on its own rather than inheriting from this.

/** May `p_mine` hand out `p_target`?
 *
 *  Strictly below, except an owner may grant anything — including owner, because a company with one
 *  owner needs some way to gain a second, and only an owner can be trusted with that. */
create or replace function may_grant(p_mine member_role, p_target member_role) returns boolean
language sql immutable as $$
  select p_mine = 'owner' or role_rank(p_target) < role_rank(p_mine);
$$;

revoke all on function may_grant(member_role, member_role) from public;
grant execute on function may_grant(member_role, member_role) to authenticated;

create or replace function invite_member(p_company_id uuid, p_email text, p_role member_role default 'editor')
returns text language plpgsql security definer set search_path = public as $$
declare
  mine     member_role := my_role(p_company_id);
  addr     text := lower(btrim(coalesce(p_email, '')));
  token    text;
  advisor  boolean;
  usage    record;
  granted  member_role := p_role;
begin
  if mine is null or role_rank(mine) < role_rank('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if addr = '' or addr not like '%_@_%.__%' then
    raise exception 'invalid_email' using errcode = 'P0008';
  end if;

  if exists (select 1 from memberships m
               join auth.users u on u.id = m.user_id
              where m.company_id = p_company_id and lower(u.email) = addr) then
    raise exception 'already_member' using errcode = 'P0009';
  end if;

  advisor := coalesce((select p.is_advisor
                         from profiles p join auth.users u on u.id = p.user_id
                        where lower(u.email) = addr), false);

  -- AN ADVISOR IS ALWAYS A VIEWER, whatever was asked for. Not an error: the inviter is not doing
  -- anything wrong, the role simply is not theirs to choose for this person.
  if advisor then
    granted := 'viewer';
  elsif not may_grant(mine, granted) then
    raise exception 'role_too_high' using errcode = 'P0007';
  end if;

  if not advisor then
    select * into usage from company_seat_usage(p_company_id);
    if usage.seats - usage.used - usage.pending <= 0 then
      raise exception 'no_seats_left' using errcode = 'P0014';
    end if;
  end if;

  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  update invitations set revoked_at = now()
   where company_id = p_company_id and email = addr
     and accepted_at is null and revoked_at is null and declined_at is null;

  insert into invitations (company_id, email, role, token_hash, invited_by)
  values (p_company_id, addr, granted, encode(sha256(token::bytea), 'hex'), auth.uid());

  perform log_audit(p_company_id, 'member.invite',
                    jsonb_build_object('email', addr, 'role', granted, 'advisor', advisor));
  return token;
end $$;

create or replace function set_member_role(p_company_id uuid, p_user_id uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare mine member_role := my_role(p_company_id); theirs member_role; owners int;
begin
  if mine is null or role_rank(mine) < role_rank('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not may_grant(mine, p_role) then
    raise exception 'role_too_high' using errcode = 'P0007';
  end if;

  select role into theirs from memberships
   where company_id = p_company_id and user_id = p_user_id;
  if theirs is null then return; end if;

  -- An advisor's role is not a choice. Refused rather than silently ignored, so a UI that offers the
  -- dropdown at all gets told why.
  if is_advisor(p_user_id) and p_role <> 'viewer' then
    raise exception 'advisor_is_viewer' using errcode = 'P0015';
  end if;

  if role_rank(theirs) > role_rank(mine) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if theirs = 'owner' and p_role <> 'owner' then
    select count(*) into owners from memberships
     where company_id = p_company_id and role = 'owner';
    if owners <= 1 then raise exception 'last_owner' using errcode = 'P0012'; end if;
  end if;

  update memberships set role = p_role
   where company_id = p_company_id and user_id = p_user_id;
  perform log_audit(p_company_id, 'member.role',
                    jsonb_build_object('user_id', p_user_id, 'from', theirs, 'to', p_role));
end $$;

revoke all on function invite_member(uuid, text, member_role) from public;
revoke all on function set_member_role(uuid, uuid, member_role) from public;
grant execute on function invite_member(uuid, text, member_role) to authenticated;
grant execute on function set_member_role(uuid, uuid, member_role) to authenticated;
