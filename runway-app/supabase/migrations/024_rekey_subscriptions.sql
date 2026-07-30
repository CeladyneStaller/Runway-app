-- Runway — migration 024: `subscriptions` is keyed on the COMPANY.
--
-- THE STEP THAT CAN BREAK BILLING. 022 and 023 were built so this one could be done separately, and it
-- changes three things that have to move together or not at all:
--
--   1. the table's key                  user_id  ->  company_id
--   2. what the webhook attributes by   metadata.user_id  ->  metadata.company_id
--   3. what `my_plan` answers about     the caller  ->  a company
--
-- `company_id` was added and backfilled in 022, so the row already knows which company it belongs to.
-- Its `user_id` is kept — renamed `purchased_by` — because a Stripe CUSTOMER is a person, not a company:
-- somebody paying for two companies has one customer id and two subscriptions, and the billing portal
-- has to be able to find the customer from either.
--
-- ONE ROW EXISTS TODAY, which is why this is the cheapest it will ever be.

-- ---------------------------------------------------------------- the key --
-- Refuse rather than guess if 022's backfill left anything unattached. A subscription with no company
-- after this migration is a paying customer entitled to nothing, and silently dropping the row or
-- defaulting it to somebody's oldest company are both worse than stopping here.
do $$
declare orphans int;
begin
  select count(*) into orphans from subscriptions where company_id is null;
  if orphans > 0 then
    raise exception 'CANNOT REKEY: % subscription(s) have no company_id. Run 022''s backfill first, or '
                    'set company_id by hand — do not let this migration choose.', orphans;
  end if;
end $$;

alter table subscriptions alter column company_id set not null;
alter table subscriptions drop constraint if exists subscriptions_pkey;
alter table subscriptions add primary key (company_id);

-- WHO BOUGHT IT, not who it is for. Nullable because an account can be deleted while the company and
-- its subscription live on with other owners.
alter table subscriptions rename column user_id to purchased_by;
alter table subscriptions alter column purchased_by drop not null;
create index if not exists subscriptions_purchaser_idx on subscriptions (purchased_by);

-- READ BY MEMBERSHIP, not by purchaser. Everybody in a company can see what plan it is on — they are
-- all affected by its seat count — but only the company's own row.
drop policy if exists sub_read on subscriptions;
create policy sub_read on subscriptions for select using (is_member(company_id));

-- ------------------------------------------------------- the webhook's RPC --
-- Recreated rather than altered: the parameter list changes, and a `create or replace` cannot change a
-- signature. The OLD one is dropped explicitly so a stale deployed webhook fails LOUDLY with "function
-- does not exist" instead of quietly writing rows nothing reads.
drop function if exists apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz);

create function apply_subscription_event(
  p_company_id    uuid,
  p_status        text,
  p_plan          text,
  p_period_end    timestamptz,
  p_customer_id   text,
  p_sub_id        text,
  p_event_id      text,
  p_event_at      timestamptz,
  p_purchased_by  uuid default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare applied boolean;
begin
  insert into subscriptions as t (company_id, purchased_by, status, plan, current_period_end,
                                  stripe_customer_id, stripe_subscription_id,
                                  last_event_id, last_event_at)
  values (p_company_id, p_purchased_by, p_status, coalesce(p_plan, 'solo'), p_period_end,
          p_customer_id, p_sub_id, p_event_id, p_event_at)
  on conflict (company_id) do update
     set status                 = excluded.status,
         plan                   = excluded.plan,
         current_period_end     = excluded.current_period_end,
         stripe_customer_id     = coalesce(excluded.stripe_customer_id, t.stripe_customer_id),
         stripe_subscription_id = coalesce(excluded.stripe_subscription_id, t.stripe_subscription_id),
         purchased_by           = coalesce(excluded.purchased_by, t.purchased_by),
         last_event_id          = excluded.last_event_id,
         last_event_at          = excluded.last_event_at,
         updated_at             = now()
     -- STRIPE DOES NOT GUARANTEE ORDER, only at-least-once delivery. An older event must not overwrite
     -- a newer one, and a duplicate must be a no-op rather than an error — a 4xx here makes Stripe
     -- retry the duplicate forever.
     where t.last_event_at is null or t.last_event_at < excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end $$;

revoke all on function apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz, uuid) from public;
grant execute on function apply_subscription_event(uuid, text, text, timestamptz, text, text, text, timestamptz, uuid) to service_role;

-- ------------------------------------------------------------ what a plan is --
/** The plan for ONE COMPANY, readable by any of its members. Seats replace the company allowance: the
 *  question is no longer "how many companies may I own" but "how many people may write to this one". */
create or replace function company_plan(p_company_id uuid)
returns table (plan text, status text, period_end timestamptz, trial_ends_at timestamptz,
               seats int, used int, pending int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select coalesce(s.plan, case when exists (select 1 from staff st where st.user_id = auth.uid())
                                then 'staff' else 'none' end),
           -- 014 made `my_plan` report the staff bypass so a comped account did not show "no plan"
           -- while writing freely, and the billing panel did not offer to sell it something it already
           -- has. `company_plan` inherits that.
           coalesce(s.status, case
             when exists (select 1 from staff st where st.user_id = auth.uid()) then 'staff'
             when c.trial_ends_at > now() then 'trial'
             else 'none' end),
           s.current_period_end,
           c.trial_ends_at,
           u.seats, u.used, u.pending
      from companies c
      left join subscriptions s on s.company_id = c.id
      cross join company_seat_usage(p_company_id) u
     where c.id = p_company_id;
end $$;

revoke all on function company_plan(uuid) from public;
grant execute on function company_plan(uuid) to authenticated;

-- `my_plan()` answered "what am I paying for", which is no longer a question with one answer: a person
-- can be in several companies on several plans. Dropped rather than left returning something plausible.
drop function if exists my_plan();

-- --------------------------------------------------- the retired allowance --
-- `plan_company_allowance` and `plan_seats` disagreed about what a plan grants the moment 022 landed.
-- The allowance is what the old model priced and nothing reads it now; leaving two functions that both
-- claim to say what a plan permits is how somebody wires up the wrong one in six months.
drop function if exists plan_company_allowance(text);

-- ------------------------------------------------------- the portal's lookup --
/** The Stripe customer paying for a company. Service role only.
 *
 *  An RPC rather than a table read, because `stripe-portal` used to select straight from
 *  `subscriptions` over PostgREST — the same shape that broke `qbo-sync`, where a missing grant came
 *  back as an error object and `?.[0]` turned it into "no subscription". A definer function cannot be
 *  quietly de-granted out from under a caller. */
create or replace function company_stripe_customer(p_company_id uuid)
returns text language sql security definer stable set search_path = public as $$
  select s.stripe_customer_id from subscriptions s where s.company_id = p_company_id;
$$;

revoke all on function company_stripe_customer(uuid) from public;
grant execute on function company_stripe_customer(uuid) to service_role;
