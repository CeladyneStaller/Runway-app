-- 010_apply_subscription_event.sql
--
-- Fixes a real bug: the webhook applied Stripe events with a PostgREST upsert carrying an `or=`
-- filter to drop stale events. FILTERS DO NOT APPLY TO INSERTS in PostgREST — they work on PATCH and
-- DELETE — so every event was rejected and the handler returned 500. The staleness guard belongs in
-- Postgres, where `on conflict do update ... where` does exactly this job.
--
-- WHY THE GUARD MATTERS AT ALL: Stripe guarantees at-least-once delivery, NOT ordering. A
-- `subscription.updated` created before a cancellation can arrive after it, and applying it blindly
-- resurrects a subscription the customer already cancelled — they keep write access they stopped
-- paying for, and nothing anywhere reports a problem.
--
-- Service-role only. `subscriptions` has no insert or update policy, so this is the sole write path.

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
  insert into subscriptions (
    user_id, status, plan, current_period_end,
    stripe_customer_id, stripe_subscription_id,
    last_event_id, last_event_at, updated_at
  ) values (
    p_user_id, p_status, coalesce(p_plan, 'solo'), p_period_end,
    p_customer_id, p_sub_id, p_event_id, p_event_at, now()
  )
  on conflict (user_id) do update set
    status                 = excluded.status,
    plan                   = excluded.plan,
    current_period_end     = excluded.current_period_end,
    stripe_customer_id     = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
    last_event_id          = excluded.last_event_id,
    last_event_at          = excluded.last_event_at,
    updated_at             = now()
  -- THE GUARD. A strictly-older event matches nothing and writes nothing, so out-of-order delivery is
  -- harmless. Equal timestamps are also skipped, which makes an exact replay a no-op.
  where subscriptions.last_event_at is null
     or subscriptions.last_event_at < excluded.last_event_at;

  get diagnostics applied = row_count;
  -- FALSE means "correctly ignored as stale", not "failed". The caller returns 200 either way, or
  -- Stripe would retry a duplicate forever.
  return applied;
end $$;

revoke all on function apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz) from public;
