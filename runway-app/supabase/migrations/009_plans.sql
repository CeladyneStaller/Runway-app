-- 009_plans.sql
--
-- Restructures 008's entitlement around the actual commercial model:
--
--   Solo       $40/mo    one company
--   Advisor    $99/mo    unlimited companies (and seats, once invites exist)
--   Connected  $149/mo   as Advisor, plus automatic ledger import
--
-- WHAT CHANGED FROM 008, AND WHY. 008 attached a subscription to a COMPANY and gave the oldest one
-- away free. That was the wrong shape twice over: the plans above are per-ACCOUNT with a company
-- allowance, and there is no free tier at all — the free thing is the demo. Since no subscription has
-- ever been written, the table is dropped and rebuilt rather than migrated.
--
-- THE TRIAL IS COMPUTED, NOT STORED, and that is the whole trick. Without one, signup leads to the
-- setup wizard, thirty minutes of entering real salaries, and then `payment_required` on the first
-- save — asking somebody to do the work before showing them it was worth doing. A stored trial needs
-- a row created at signup, which needs a hook, which is a thing that can fail and leave an account
-- unable to write. `auth.users.created_at` already exists, is set by Supabase, and cannot be missing.

drop table if exists subscriptions;

create table subscriptions (
  -- PER ACCOUNT. The owner pays; members reach a company through their owner's plan.
  user_id                uuid primary key references auth.users (id) on delete cascade,

  -- Stripe's own vocabulary, verbatim. A local enum needs updating whenever Stripe adds a status,
  -- and the failure mode of a missed one is granting or revoking access by accident.
  status                 text not null,
  plan                   text not null default 'solo',   -- solo | advisor | connected

  -- Access survives to the end of a paid period after cancellation: somebody who cancels on the 2nd
  -- has paid for the month.
  current_period_end     timestamptz,

  stripe_customer_id     text,
  stripe_subscription_id text unique,

  -- Webhook idempotency: Stripe retries, and events arrive out of order.
  last_event_id          text,
  last_event_at          timestamptz,
  updated_at             timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- Readable by its owner so the Account page can show the plan. NO insert, update or delete policy
-- anywhere: RLS denies by default, so a user cannot grant themselves a plan even having found the
-- table. Only the Stripe webhook writes, on the service role.
drop policy if exists sub_read on subscriptions;
create policy sub_read on subscriptions for select using (user_id = auth.uid());

grant select on subscriptions to authenticated;
create index if not exists subscriptions_customer_idx on subscriptions (stripe_customer_id);

-- ------------------------------------------------------------- the plans --
create or replace function plan_company_allowance(p_plan text) returns int
  language sql immutable as $$
  select case p_plan
    when 'solo'      then 1
    when 'advisor'   then 1000000
    when 'connected' then 1000000
    else 0
  end $$;

/** How long a new account may write before paying. Change here and nowhere else. */
create or replace function trial_days() returns int
  language sql immutable as $$ select 14 $$;

/** Trial allowance is SOLO, not the top tier. A trial is for finding out whether the product works
 *  for you, which one company answers; handing out the Advisor allowance for free would mostly serve
 *  the accountants who are the reason Advisor exists. */
create or replace function trial_allowance() returns int
  language sql immutable as $$ select 1 $$;

-- --------------------------------------------------------- the entitlement --
/**
 * May this company be written to?
 *
 * Entitled when ANY OWNER of it has an allowance that reaches it — so a member invited to somebody
 * else's company writes under that owner's plan and needs nothing of their own.
 *
 * WHICH companies an allowance covers is deterministic: the OLDEST N you own. Computed rather than
 * stored, because an `is_covered` column has to be maintained and every path that creates, deletes or
 * transfers a company becomes a place to corrupt it. Ordering by `created_at` cannot drift, needs no
 * migration when a plan's allowance changes, and is explainable in one sentence: downgrade from
 * Advisor to Solo and your first company keeps working.
 *
 * STRIPE STATUSES ARE READ GENEROUSLY. `past_due` still writes — a failing card is a dunning problem,
 * not a reason to lock somebody out of their payroll mid-edit while Stripe retries for days.
 */
create or replace function company_entitled(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from memberships m
      join auth.users u on u.id = m.user_id
      left join subscriptions s on s.user_id = m.user_id
     where m.company_id = p_company_id
       and m.role = 'owner'
       and p_company_id in (
         select c.id
           from memberships m2
           join companies c on c.id = m2.company_id
          where m2.user_id = m.user_id
            and m2.role = 'owner'
            and c.deleted_at is null
          order by c.created_at asc
          limit greatest(
            -- paying: whatever the plan allows
            case when s.status in ('active', 'trialing', 'past_due')
                   or s.current_period_end > now()
                 then plan_company_allowance(coalesce(s.plan, 'solo')) else 0 end,
            -- or still inside the trial window, measured from when the account was created
            case when u.created_at > now() - (trial_days() || ' days')::interval
                 then trial_allowance() else 0 end
          )
       )
  );
$$;

revoke all on function company_entitled(uuid) from public;
grant execute on function company_entitled(uuid) to authenticated;

-- ------------------------------------------------- what the app can see --
/** Everything the billing UI needs in one call: the plan, whether it is a trial, and when either
 *  runs out. `trial_ends_at` is derived here so the client never has to know the window. */
create or replace function my_plan()
returns table (plan text, status text, period_end timestamptz,
               trial_ends_at timestamptz, companies_allowed int)
language sql stable security definer set search_path = public as $$
  select coalesce(s.plan, 'none'),
         coalesce(s.status, 'none'),
         s.current_period_end,
         u.created_at + (trial_days() || ' days')::interval,
         greatest(
           case when s.status in ('active', 'trialing', 'past_due')
                  or s.current_period_end > now()
                then plan_company_allowance(coalesce(s.plan, 'solo')) else 0 end,
           case when u.created_at > now() - (trial_days() || ' days')::interval
                then trial_allowance() else 0 end
         )
    from auth.users u
    left join subscriptions s on s.user_id = u.id
   where u.id = auth.uid();
$$;

revoke all on function my_plan() from public;
grant execute on function my_plan() to authenticated;
