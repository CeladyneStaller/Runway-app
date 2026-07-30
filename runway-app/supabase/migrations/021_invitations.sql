-- Runway — migration 021: team invitations.
--
-- `memberships` has been many-to-many with four roles since 001 and `can_edit()` has always gated on
-- role. What was missing was any way to put a second person in it. This adds that, and the interesting
-- parts are all refusals.
--
-- NO EMAIL IS SENT. The invite produces a LINK, once, and the inviter sends it however they already talk
-- to the person. That is not a shortcut around building email — it avoids adding an email subprocessor
-- to a product whose privacy documents are at review, and it works today. Delivery by email later is an
-- addition to this, not a replacement for it.
--
-- THE TOKEN IS STORED AS A SHA-256 HASH, never in plain text. It is a bearer credential to a company's
-- payroll and runway: if this table leaked with raw tokens in it, every outstanding invitation would be
-- usable by whoever read it. `sha256()` is built into Postgres, so this needs no extension.
--
-- THE INVITE IS BOUND TO AN EMAIL ADDRESS. Accepting requires being signed in AS the invited address,
-- which means a link forwarded to a group chat is useless to everyone in it. The cost is that somebody
-- who signs up with a different address gets a clear refusal instead of access; for a document holding
-- salaries that is the right way round.

create table if not exists invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  -- Lower-cased on write. Email comparison is case-insensitive in practice and `citext` would be an
  -- extension for one column.
  email        text not null,
  role         member_role not null default 'editor',
  token_hash   text not null unique,
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- FOURTEEN DAYS. An invitation that never expires is a permanent key to somebody's finances sitting
  -- in an inbox, and the person who sent it will not remember it exists.
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz
);

create index if not exists invitations_company_idx on invitations (company_id);
-- ONE PENDING INVITE PER ADDRESS PER COMPANY. Without this, inviting twice leaves two live tokens and
-- revoking one does nothing visible.
create unique index if not exists invitations_pending_uniq
  on invitations (company_id, email)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------- RLS --
-- No client reads this table directly. The listing RPC returns everything the UI needs and no hash.
alter table invitations enable row level security;
revoke all on invitations from anon, authenticated;

-- --------------------------------------------------------------------- rank --
-- NOBODY MAY GRANT A ROLE ABOVE THEIR OWN. An admin who can mint owners can promote themselves by
-- inviting their own second address, which makes every other check here decorative.
create or replace function role_rank(r member_role) returns int
language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 else 1 end;
$$;

create or replace function my_role(p_company_id uuid) returns member_role
language sql security definer stable set search_path = public as $$
  select m.role from memberships m
   where m.company_id = p_company_id and m.user_id = auth.uid();
$$;

revoke all on function role_rank(member_role) from public;
revoke all on function my_role(uuid) from public;
grant execute on function role_rank(member_role) to authenticated;
grant execute on function my_role(uuid) to authenticated;

-- ------------------------------------------------------------------- invite --
/** Creates an invitation and returns the RAW TOKEN — the only time it exists in readable form. The
 *  caller builds a link from it; nothing stores it. */
create or replace function invite_member(p_company_id uuid, p_email text, p_role member_role default 'editor')
returns text language plpgsql security definer set search_path = public as $$
declare
  mine  member_role := my_role(p_company_id);
  addr  text := lower(btrim(coalesce(p_email, '')));
  token text;
begin
  if mine is null or role_rank(mine) < role_rank('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if role_rank(p_role) > role_rank(mine) then
    -- Told apart from `forbidden` because it is a different mistake with a different fix: you are
    -- allowed to invite, just not to hand out something you do not hold.
    raise exception 'role_too_high' using errcode = 'P0007';
  end if;
  if addr = '' or addr not like '%_@_%.__%' then
    raise exception 'invalid_email' using errcode = 'P0008';
  end if;

  -- ALREADY IN THE COMPANY. Refused rather than silently re-invited, so the UI can say "they are
  -- already a member" instead of producing a link that will fail when used.
  if exists (select 1 from memberships m
               join auth.users u on u.id = m.user_id
              where m.company_id = p_company_id and lower(u.email) = addr) then
    raise exception 'already_member' using errcode = 'P0009';
  end if;

  -- Two uuids of randomness, hex, no extension required. Roughly 244 bits.
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  -- Re-inviting REPLACES the outstanding invitation rather than adding a second one, and the old token
  -- stops working immediately. Two live tokens for one seat is a revocation that does not revoke.
  update invitations set revoked_at = now()
   where company_id = p_company_id and email = addr
     and accepted_at is null and revoked_at is null;

  insert into invitations (company_id, email, role, token_hash, invited_by)
  values (p_company_id, addr, p_role, encode(sha256(token::bytea), 'hex'), auth.uid());

  perform log_audit(p_company_id, 'member.invite',
                    jsonb_build_object('email', addr, 'role', p_role));
  return token;
end $$;

-- ------------------------------------------------------------------- accept --
/** Redeems a token. The signed-in address must match the invited one. */
create or replace function accept_invitation(p_token text)
returns table (company_id uuid, company_name text, role member_role)
language plpgsql security definer set search_path = public as $$
declare inv invitations; me text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select lower(u.email) into me from auth.users u where u.id = auth.uid();

  select * into inv from invitations
   where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
     and accepted_at is null and revoked_at is null;

  -- ONE ERROR FOR "no such invitation", "already used", "revoked" and "expired". A caller holding a
  -- token should not be able to learn WHICH of those it is: the difference is exactly the information
  -- somebody probing tokens would want.
  if inv.id is null or inv.expires_at < now() then
    raise exception 'invalid_invitation' using errcode = 'P0010';
  end if;

  if me is null or me <> inv.email then
    -- Deliberately distinct, because this one is a real person with a real invitation who signed up
    -- with a different address, and telling them "invalid" would be a dead end.
    raise exception 'wrong_email' using errcode = 'P0011';
  end if;

  insert into memberships (user_id, company_id, role)
  values (auth.uid(), inv.company_id, inv.role)
  on conflict (user_id, company_id) do update set role = excluded.role;

  update invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  perform log_audit(inv.company_id, 'member.join',
                    jsonb_build_object('email', inv.email, 'role', inv.role));

  return query select c.id, c.name, inv.role from companies c where c.id = inv.company_id;
end $$;

-- -------------------------------------------------------------- list/revoke --
create or replace function list_invitations(p_company_id uuid)
returns table (id uuid, email text, role member_role, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if role_rank(coalesce(my_role(p_company_id), 'viewer')) < role_rank('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- NO HASH IS RETURNED, and the raw token is unrecoverable by design: a link that can be re-read from
  -- a list is a link that outlives the moment it was meant for. Re-invite to issue a new one.
  return query
    select i.id, i.email, i.role, i.created_at, i.expires_at
      from invitations i
     where i.company_id = p_company_id
       and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     order by i.created_at desc;
end $$;

create or replace function revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid; addr text;
begin
  select company_id, email into cid, addr from invitations where id = p_id;
  if cid is null then return; end if;
  if role_rank(coalesce(my_role(cid), 'viewer')) < role_rank('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update invitations set revoked_at = now() where id = p_id and revoked_at is null;
  perform log_audit(cid, 'member.invite_revoked', jsonb_build_object('email', addr));
end $$;

-- ------------------------------------------------------------------ members --
create or replace function list_members(p_company_id uuid)
returns table (user_id uuid, email text, role member_role, joined_at timestamptz, is_me boolean)
language plpgsql security definer set search_path = public as $$
begin
  -- Any member may see who else is in the company. Working alongside somebody you cannot see is worse
  -- than the alternative, and the emails are already known to everybody in a shared company.
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.user_id, lower(u.email), m.role, m.created_at, m.user_id = auth.uid()
      from memberships m join auth.users u on u.id = m.user_id
     where m.company_id = p_company_id
     order by role_rank(m.role) desc, u.email;
end $$;

create or replace function set_member_role(p_company_id uuid, p_user_id uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public as $$
declare mine member_role := my_role(p_company_id); theirs member_role; owners int;
begin
  if mine is null or role_rank(mine) < role_rank('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if role_rank(p_role) > role_rank(mine) then
    raise exception 'role_too_high' using errcode = 'P0007';
  end if;
  select role into theirs from memberships where company_id = p_company_id and user_id = p_user_id;
  if theirs is null then return; end if;
  -- AN ADMIN MAY NOT DEMOTE AN OWNER. Otherwise the junior role can take the company.
  if role_rank(theirs) > role_rank(mine) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- THE LAST OWNER CANNOT BE DEMOTED. A company with no owner cannot be deleted, cannot invite, and
  -- cannot be recovered without operator intervention — the state is unreachable by accident and
  -- unfixable by the customer.
  if theirs = 'owner' and p_role <> 'owner' then
    select count(*) into owners from memberships
     where company_id = p_company_id and role = 'owner';
    if owners <= 1 then raise exception 'last_owner' using errcode = 'P0012'; end if;
  end if;

  update memberships set role = p_role where company_id = p_company_id and user_id = p_user_id;
  perform log_audit(p_company_id, 'member.role',
                    jsonb_build_object('user_id', p_user_id, 'from', theirs, 'to', p_role));
end $$;

create or replace function remove_member(p_company_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mine member_role := my_role(p_company_id); theirs member_role; owners int;
begin
  select role into theirs from memberships where company_id = p_company_id and user_id = p_user_id;
  if theirs is null then return; end if;

  -- LEAVING IS ALWAYS ALLOWED, whatever your role — subject only to the last-owner rule below. Nobody
  -- should need permission to stop being in a company.
  if p_user_id <> auth.uid() then
    if mine is null or role_rank(mine) < role_rank('admin') or role_rank(theirs) > role_rank(mine) then
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

-- ---------------------------------------------------------------- retention --
create or replace function purge_expired_invitations(p_older_than interval default interval '30 days')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from invitations
   where (accepted_at is not null or revoked_at is not null or expires_at < now())
     and created_at < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------------- grants --
revoke all on function invite_member(uuid, text, member_role)        from public;
revoke all on function accept_invitation(text)                       from public;
revoke all on function list_invitations(uuid)                        from public;
revoke all on function revoke_invitation(uuid)                       from public;
revoke all on function list_members(uuid)                            from public;
revoke all on function set_member_role(uuid, uuid, member_role)      from public;
revoke all on function remove_member(uuid, uuid)                     from public;
revoke all on function purge_expired_invitations(interval)           from public;

grant execute on function invite_member(uuid, text, member_role)     to authenticated;
grant execute on function accept_invitation(text)                    to authenticated;
grant execute on function list_invitations(uuid)                     to authenticated;
grant execute on function revoke_invitation(uuid)                    to authenticated;
grant execute on function list_members(uuid)                         to authenticated;
grant execute on function set_member_role(uuid, uuid, member_role)   to authenticated;
grant execute on function remove_member(uuid, uuid)                  to authenticated;
grant execute on function purge_expired_invitations(interval)        to service_role;
