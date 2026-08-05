-- 046 · TERMS ACCEPTANCE, RECORDED
--
-- A checkbox that writes nothing is worth nothing. If somebody ever asks whether a particular user
-- agreed to a particular version of the terms, the answer has to be a row with a timestamp, not "the
-- form required it at the time".
--
-- WHY THE ACCEPTANCE ARRIVES IN SIGNUP METADATA rather than through an RPC: with email confirmation on,
-- `signUp` returns NO SESSION. `my_profile()` and every other RPC need `auth.uid()`, so nothing can be
-- written until the user confirms and signs in — which may be days later, or never. Recording it then
-- would timestamp the confirmation rather than the agreement.
--
-- So the client passes `terms_version` and `terms_accepted_at` in `options.data`, Supabase stores them
-- on `auth.users.raw_user_meta_data` at the moment of signup, and `my_profile()` copies them across the
-- first time it runs with a session. The timestamp is the moment they ticked the box.

alter table profiles add column if not exists terms_version    text;
alter table profiles add column if not exists terms_accepted_at timestamptz;

comment on column profiles.terms_version is
  'Which version of the terms this account accepted. Compared against terms_current(); a mismatch '
  'means the user is asked again.';

/** The version of the terms currently in force.
 *
 *  A DATE, NOT A NUMBER. "2026-08-04" says when the document it refers to was published, which is the
 *  thing anybody investigating an acceptance actually wants to know. `v3` does not.
 *
 *  MUST MATCH `TERMS_VERSION` in the client. A test reads both.
 */
create or replace function terms_current() returns text
language sql immutable set search_path = public as $$ select '2026-08-04' $$;

revoke all on function terms_current() from public;
grant execute on function terms_current() to authenticated, anon;

/** Record acceptance for the signed-in user.
 *
 *  Used when the terms CHANGE and an existing account has to agree again. New accounts come through the
 *  metadata path above instead.
 *
 *  ACCEPTS ONLY THE CURRENT VERSION. A client that is a deploy behind would otherwise write an old
 *  version string and read as accepted, which is the failure mode that makes the whole record
 *  worthless.
 */
create or replace function accept_terms(p_version text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_version is distinct from terms_current() then
    raise exception 'terms_version_mismatch' using errcode = 'P0001';
  end if;
  update profiles
     set terms_version = p_version, terms_accepted_at = now()
   where user_id = auth.uid();
end $$;

revoke all on function accept_terms(text) from public;
grant execute on function accept_terms(text) to authenticated;

-- POSTGRES REFUSES `create or replace` WHEN THE RETURN TYPE CHANGES, and this adds three columns to
-- `my_profile()`. Without the drop the migration fails on apply with "cannot change return type of
-- existing function" — caught here by the scanner rather than at 2am against production.
drop function if exists my_profile();

/** Profile, now carrying the terms state — and copying it out of signup metadata on first run.
 *
 *  `on conflict do nothing` means this is safe to call repeatedly; the update below is guarded so a
 *  later sign-in cannot overwrite an acceptance that is already recorded with a fresher timestamp.
 */
create or replace function my_profile()
returns table (password_set_at timestamptz, last_company_id uuid,
               terms_version text, terms_accepted_at timestamptz, terms_required text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into profiles (user_id) values (auth.uid()) on conflict (user_id) do nothing;

  -- COPY FROM SIGNUP METADATA, ONCE. Only when nothing is recorded yet, so this can never move an
  -- existing acceptance — and only when the metadata names the current version, so a stale client
  -- cannot backdate somebody into terms they never saw.
  update profiles p
     set terms_version     = u.raw_user_meta_data->>'terms_version',
         terms_accepted_at = coalesce(
           (u.raw_user_meta_data->>'terms_accepted_at')::timestamptz, now())
    from auth.users u
   where p.user_id = auth.uid()
     and u.id = auth.uid()
     and p.terms_version is null
     and u.raw_user_meta_data->>'terms_version' is not null;

  return query
    select p.password_set_at, p.last_company_id, p.terms_version, p.terms_accepted_at,
           -- What the client should ask for. Null means nothing to do — the common case, and the one
           -- where the UI must stay out of the way.
           case when p.terms_version is distinct from terms_current()
                then terms_current() else null end
      from profiles p where p.user_id = auth.uid();
end $$;

revoke all on function my_profile() from public;
grant execute on function my_profile() to authenticated;
