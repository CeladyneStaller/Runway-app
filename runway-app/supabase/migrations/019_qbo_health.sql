-- Runway — migration 019: a health read for the QuickBooks connections.
--
-- The keep-alive knows what happened during ITS run. It does not know that a connection has been
-- healthy and unsynced since March, which is the failure this phase actually has to defend against:
-- a sync that stops quietly leaves numbers that LOOK current, and this product's entire output is a
-- date computed from them. A dead sync is worse than no sync.
--
-- Counts only. No company ids, no names, no realm ids — this is read by a scheduled job whose output
-- lands in a CI log, and a log is not a place to put a customer's identity.

create or replace function qbo_health(p_stale_after interval default interval '45 days')
returns table (
  total          int,
  active         int,
  needs_reauth   int,
  never_synced   int,
  stale_syncs    int,
  reauth_due_90d int
)
language sql security definer set search_path = public as $$
  select
    count(*)::int,
    count(*) filter (where status = 'active')::int,
    count(*) filter (where status = 'needs_reauth')::int,
    -- Connected and never used. Usually somebody who connected and did not finish the mapping, which
    -- is a product problem rather than a plumbing one — and invisible without counting it.
    count(*) filter (where status = 'active' and last_sync_at is null)::int,
    count(*) filter (where status = 'active' and last_sync_at < now() - p_stale_after)::int,
    -- The five-year ceiling, seen coming rather than discovered. Rotation does not reset it.
    count(*) filter (where authorized_at + interval '5 years' < now() + interval '90 days')::int
  from qbo_connections;
$$;

revoke all on function qbo_health(interval) from public;
grant execute on function qbo_health(interval) to service_role;
