-- 010_subscription_rpc.sql
--
-- Fixes two faults in how the Stripe webhook writes `subscriptions`.
--
-- 1. PERMISSION DENIED. 009 granted `select` to `authenticated` and nothing at all to `service_role`.
--    RLS BYPASS AND TABLE PRIVILEGES ARE DIFFERENT MECHANISMS: the service role skips row-level
--    security, but it still needs a GRANT to touch the table, and was refused before RLS was ever
--    consulted. Postgres said so precisely — "permission denied for table subscriptions".
--
-- 2. THE STALE-EVENT GUARD DID NOT WORK. It was expressed as a PostgREST filter:
--       ?on_conflict=user_id&or=(last_event_at.is.null,last_event_at.lt.2026-07-27T21:24:32.776Z)
--    which is wrong twice over. The timestamp's colons and period are unencoded inside `or=(...)`,
--    and filters are not consulted by upsert conflict resolution anyway. So out-of-order events —
--    which Stripe explicitly does not protect against — would have applied silently.
--
-- Both are solved by moving the write into a function. The ordering guard becomes an ON CONFLICT
-- WHERE, which is atomic and cannot be mis-encoded, and the service role gets EXECUTE on one function
-- rather than write access to a table. Tighter than the grant Postgres suggested.

create or replace function apply_subscription_event(
  p_user_id       uuid,
  p_status        text,
  p_plan          text,
  p_period_end    timestamptz,
  p_customer_id   text,
  p_sub_id        text,
  p_event_id      text,
  p_event_at      timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare applied boolean;
begin
  insert into subscriptions (user_id, status, plan, current_period_end,
                             stripe_customer_id, stripe_subscription_id,
                             last_event_id, last_event_at, updated_at)
  values (p_user_id, p_status, coalesce(p_plan, 'solo'), p_period_end,
          p_customer_id, p_sub_id, p_event_id, p_event_at, now())
  on conflict (user_id) do update
     set status                 = excluded.status,
         plan                   = excluded.plan,
         current_period_end     = excluded.current_period_end,
         stripe_customer_id     = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
         stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
         last_event_id          = excluded.last_event_id,
         last_event_at          = excluded.last_event_at,
         updated_at             = now()
   -- THE GUARD. Stripe guarantees at-least-once delivery and NOT ordering, so a `subscription.updated`
   -- from before a cancellation can arrive after it. Older events match nothing and change nothing.
   -- A replay of the SAME event is also older-or-equal, so it is idempotent for free.
   where subscriptions.last_event_at is null
      or subscriptions.last_event_at < excluded.last_event_at;

  get diagnostics applied = row_count;
  return applied;
end $$;

-- EXECUTE only, and only for the webhook's role. `authenticated` is deliberately absent: a signed-in
-- user calling this would be granting themselves a plan.
revoke all on function apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz) from public;
grant execute on function apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz) to service_role;
