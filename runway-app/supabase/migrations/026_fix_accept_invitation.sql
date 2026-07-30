-- Runway — migration 026: `accept_invitation` could not be called.
--
--   ERROR: column reference "company_id" is ambiguous
--
-- `returns table (company_id uuid, company_name text, role member_role)` declares THREE OUT VARIABLES,
-- and plpgsql resolves an unqualified name to the variable OR the column with no way to guess which was
-- meant. The body has both:
--
--     insert into memberships (user_id, company_id, role) ...
--     on conflict (user_id, company_id) do update set role = excluded.role;
--
-- `company_id` and `role` are each both an OUT variable and a column of `memberships`. Qualifying is the
-- usual fix and is not available here: the columns in an `on conflict` inference clause cannot be
-- table-qualified, because they name an index rather than a relation.
--
-- So the body declares which it means. `#variable_conflict use_column` is the documented remedy and
-- resolves both collisions at once; the OUT variables are never read, since the row is produced by
-- `return query`.
--
-- WHY NO TEST CAUGHT IT: this is a runtime resolution failure inside plpgsql. The function was created
-- without complaint — plpgsql defers name resolution until execution, exactly as 022's ordering bug
-- showed from the other direction, where a `language sql` function failed AT CREATION for a forward
-- reference plpgsql would have accepted. Neither is visible to a suite that never calls the function
-- against a real database.
--
-- WORTH KNOWING FOR THE NEXT ONE: every plpgsql function here that uses `returns table` with names
-- matching real columns — `list_members`, `list_invitations`, `company_plan`, `qbo_connection_status` —
-- is safe only because every reference in those bodies happens to be qualified. That is a habit rather
-- than a guarantee.

create or replace function accept_invitation(p_token text)
returns table (company_id uuid, company_name text, role member_role)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare inv invitations; me text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select lower(u.email) into me from auth.users u where u.id = auth.uid();

  select * into inv from invitations
   where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
     and accepted_at is null and revoked_at is null and declined_at is null;

  -- ONE ERROR for "no such invitation", "already used", "revoked", "declined" and "expired". Somebody
  -- holding a token should not be able to learn WHICH: the difference is what a person probing tokens
  -- would want to know.
  if inv.id is null or inv.expires_at < now() then
    raise exception 'invalid_invitation' using errcode = 'P0010';
  end if;

  if me is null or me <> inv.email then
    -- Distinct on purpose: this is a real person with a real invitation who signed up under a different
    -- address, and "invalid" would be a dead end for them.
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

revoke all on function accept_invitation(text) from public;
grant execute on function accept_invitation(text) to authenticated;
