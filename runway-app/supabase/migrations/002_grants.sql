-- Runway — migration 002: privileges, and one RPC to resolve the caller's company.
--
-- WHY THIS EXISTS: 001 enabled RLS and wrote policies but granted nothing. RLS and GRANTs are two
-- INDEPENDENT gates, and they fail differently — RLS denial returns zero rows, a missing GRANT returns
-- "permission denied for table". Policies on a table the role cannot touch are never even evaluated.
--
-- POSTURE: `authenticated` gets SELECT and nothing else. Every write goes through a SECURITY DEFINER
-- function that checks membership itself, so there is no INSERT/UPDATE/DELETE grant anywhere for a
-- client to misuse — and therefore no way for a client to write a document without passing the version
-- precondition in save_document. That is stricter than the usual "grant all, trust the policies" setup,
-- and it is the whole reason to have the RPC in the first place.

grant usage on schema public to anon, authenticated;

-- Read-only. RLS still narrows these to the caller's own company.
grant select on companies         to authenticated;
grant select on documents         to authenticated;
grant select on document_versions to authenticated;
grant select on audit_log         to authenticated;

-- NOTE: no grant on `memberships`. Nothing outside the database needs to read it — current_company()
-- below answers the only question a client ever had, and does it as definer.

-- Writes and lookups, all definer-checked.
grant execute on function save_document(uuid, int, jsonb, bigint) to authenticated;
grant execute on function bootstrap_company(text)                 to authenticated;

-- --------------------------------------------------- the caller's company --
-- Replaces a client-side "select from memberships, and if empty call bootstrap" with a single call.
-- Fewer round trips, no table exposure, and the create-if-missing path is atomic rather than a race
-- between two requests from the same user signing in on two devices at once.
create or replace function current_company()
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Ordered, so a user who belongs to several companies resolves to the SAME one on every load rather
  -- than whichever row the planner happened to return. A switcher is a later phase; silently hopping
  -- between documents would be a data-integrity bug now.
  select m.company_id into c
    from memberships m
   where m.user_id = auth.uid()
   order by m.created_at asc
   limit 1;

  if c is not null then return c; end if;

  -- A signed-in user with no membership is a brand-new account.
  insert into companies (name) values ('My company') returning id into c;
  insert into memberships (user_id, company_id, role) values (auth.uid(), c, 'owner');
  return c;
end $$;

grant execute on function current_company() to authenticated;

-- ------------------------------------------------------------ future-proof --
-- Anything added later inherits the same posture without a follow-up migration to remember.
alter default privileges in schema public grant select on tables to authenticated;
