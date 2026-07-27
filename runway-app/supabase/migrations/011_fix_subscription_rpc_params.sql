-- 011_fix_subscription_rpc_params.sql
--
-- Repairs a project where 010 was applied in its FIRST form, whose parameters were named
-- `p_customer` / `p_subscription` while the webhook sends `p_customer_id` / `p_sub_id`. PostgREST
-- matches RPC arguments BY NAME, so the call 404s with PGRST202 and the handler returns 500.
--
-- WHY THIS IS A NEW FILE RATHER THAN AN EDIT TO 010. Once a migration is applied its version is in
-- `supabase_migrations.schema_migrations`, and `db push` refuses to run that version again — so an
-- edited 010 is simply never executed, silently. Migrations are immutable after they run; a fix is
-- always a new number. (A fresh project runs the corrected 010 and this becomes a harmless no-op.)
--
-- The DROP is required, not tidiness: Postgres identifies a function by its argument TYPES, so
-- `create or replace` with different parameter NAMES is rejected outright — you cannot rename an
-- argument in place.

drop function if exists apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz);

create function apply_subscription_event(
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
   -- Stripe guarantees at-least-once delivery and NOT ordering, so an update from before a
   -- cancellation can arrive after it. Older events match nothing. A replay is older-or-equal, so
   -- idempotency comes free.
   where subscriptions.last_event_at is null
      or subscriptions.last_event_at < excluded.last_event_at;

  get diagnostics applied = row_count;
  return applied;
end $$;

-- EXECUTE only, and only for the webhook's role. `authenticated` is deliberately absent: a signed-in
-- user calling this would be granting themselves a plan.
revoke all on function apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz) from public;
grant execute on function apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz) to service_role;
