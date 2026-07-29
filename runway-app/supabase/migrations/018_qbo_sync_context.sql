-- Runway — migration 018: the sync context comes from an RPC, not from the table.
--
-- `qbo-sync` read `realm_id` straight from `qbo_connections` over PostgREST. 017 revoked that table
-- from `anon` and `authenticated` — correctly, it holds a credential reference — but never granted it
-- to `service_role`, so the read came back as an ERROR OBJECT rather than an array. The calling code
-- did `?? []` and `[0]?.realm_id`, which turned a permission failure into `undefined` and reported it
-- as "no realm_id", a state that cannot actually exist.
--
-- NOTES.md already records this exact shape from migration 001: RLS and privileges are two
-- independent gates, and a missing GRANT fails DIFFERENTLY from an RLS denial — permission denied
-- versus zero rows. Same trap, second time.
--
-- The repair is not a grant. It is that a function which already asks the database for the token has
-- no business also reaching into the table for the realm: two round trips, two permission surfaces,
-- and one of them silently optional. One RPC returns both, `service_role` only, and the Edge
-- Functions need no table privileges at all.

create or replace function qbo_sync_context(p_company_id uuid)
returns table (realm_id text, refresh_token text, status text, qbo_company_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.realm_id,
           s.decrypted_secret,
           c.status,
           c.qbo_company_name
      from qbo_connections c
      join vault.decrypted_secrets s on s.id = c.secret_id
     where c.company_id = p_company_id;
end $$;

revoke all on function qbo_sync_context(uuid) from public;
grant execute on function qbo_sync_context(uuid) to service_role;

-- And the grant 017 should have carried anyway, so a direct read fails as "no rows" rather than as a
-- permission error dressed up as missing data. `service_role` is the only role that gets it; `anon`
-- and `authenticated` stay revoked, which is the property the isolation probes assert.
grant select on qbo_connections to service_role;
