-- Runway — migration 031: advisors are billed, and the tier has a limit.
--
--   Advisor            $99   up to 3 companies
--   Advisor Unlimited  $199  no limit
--
-- A SECOND SUBSCRIPTION TABLE, keyed on the USER. `subscriptions` moved to `company_id` in 024 because
-- a company plan belongs to a company; an advisor plan belongs to a person and buys them capability
-- rather than entitling anybody else's company. Two products, two tables, and neither pretending to be
-- the other.
--
-- WHERE THE LIMIT IS ENFORCED: at ACCEPT, not at invite.
--
-- Enforcing at invite would put the refusal on a company, for a limit belonging to somebody else, at a
-- moment when the advisor cannot act on it. Enforcing at accept puts it in front of the person whose
-- plan it is, when they are the one who can upgrade — and it means every membership an advisor holds is
-- covered, always. There is no "which three companies" question, no ordering, and nobody silently loses
-- their exemption in one company by joining another. That ordering trap is exactly what the old
-- per-account company allowance had, and it is not worth repeating.

create table if not exists advisor_subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  plan                   text not null,          -- 'advisor' | 'advisor_unlimited'
  status                 text not null,          -- Stripe's vocabulary, verbatim
  current_period_end     timestamptz,
  -- FOR TASK 1.7. Stripe subscriptions renew by default, so what actually needs surfacing is the
  -- opposite: a subscription set to STOP. Stored rather than derived so a renewal notice can be sent
  -- without asking Stripe, and so "expires in under a month and will not renew" is a query.
  cancel_at_period_end   boolean not null default false,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  last_event_id          text,
  last_event_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table advisor_subscriptions enable row level security;
revoke all on advisor_subscriptions from anon, authenticated;

-- Your own, and only your own.
drop policy if exists advisor_sub_read on advisor_subscriptions;
create policy advisor_sub_read on advisor_subscriptions for select using (user_id = auth.uid());
grant select on advisor_subscriptions to authenticated;

create or replace function advisor_companies_allowed(p_plan text) returns int
language sql immutable as $$
  select case p_plan when 'advisor' then 3 when 'advisor_unlimited' then 1000000 else 0 end;
$$;

-- ---------------------------------------------------------------- the flag --
/** FLAG **OR** ACTIVE SUBSCRIPTION.
 *
 *  The boolean stays as a manual comp — somebody we have agreed to carry, set by hand with
 *  `set_advisor`. Without the subscription half, a lapsed advisor would keep free seats across every
 *  client forever, because nothing would ever take the flag away. */
create or replace function is_advisor(p_user_id uuid default auth.uid()) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select p.is_advisor from profiles p where p.user_id = p_user_id), false)
      or exists (select 1 from advisor_subscriptions a
                  where a.user_id = p_user_id
                    and (a.status in ('active', 'trialing', 'past_due')
                         or a.current_period_end > now()));
$$;

/** How many companies this advisor's plan covers. A comped advisor is unlimited: we granted it. */
create or replace function advisor_allowance(p_user_id uuid default auth.uid()) returns int
language sql security definer stable set search_path = public as $$
  select case
    when coalesce((select p.is_advisor from profiles p where p.user_id = p_user_id), false)
      then 1000000
    else coalesce((select advisor_companies_allowed(a.plan) from advisor_subscriptions a
                    where a.user_id = p_user_id
                      and (a.status in ('active', 'trialing', 'past_due')
                           or a.current_period_end > now())), 0)
  end;
$$;

/** Companies this advisor is already in, against what their plan covers. */
create or replace function advisor_usage(p_user_id uuid default auth.uid())
returns table (companies int, allowed int)
language sql security definer stable set search_path = public as $$
  select (select count(*)::int from memberships m
            join companies c on c.id = m.company_id
           where m.user_id = p_user_id and c.deleted_at is null),
         advisor_allowance(p_user_id);
$$;

revoke all on function advisor_companies_allowed(text) from public;
revoke all on function advisor_allowance(uuid)          from public;
revoke all on function advisor_usage(uuid)              from public;
grant execute on function advisor_companies_allowed(text) to authenticated;
grant execute on function advisor_allowance(uuid)         to authenticated;
grant execute on function advisor_usage(uuid)             to authenticated;

-- --------------------------------------------------- the limit, at the door --
create or replace function accept_invitation(p_token text)
returns table (company_id uuid, company_name text, role member_role)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare inv invitations; me text; used int; allowed int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select lower(u.email) into me from auth.users u where u.id = auth.uid();

  select * into inv from invitations
   where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
     and accepted_at is null and revoked_at is null and declined_at is null;

  if inv.id is null or inv.expires_at < now() then
    raise exception 'invalid_invitation' using errcode = 'P0010';
  end if;

  if me is null or me <> inv.email then
    raise exception 'wrong_email' using errcode = 'P0011';
  end if;

  -- THE ADVISOR'S OWN LIMIT, checked at the moment they act on it, so the person who has to upgrade is
  -- the person reading the message. A company's seats are not consulted — an advisor never takes one.
  if is_advisor() then
    select companies, allowed into used, allowed from advisor_usage();
    if used >= allowed then
      raise exception 'advisor_limit' using errcode = 'P0017';
    end if;
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

-- ------------------------------------------------------------- the webhook --
/** Written only by the Stripe webhook, under the service role. Same ordering guard as
 *  `apply_subscription_event`: Stripe guarantees at-least-once delivery and not order, so an older
 *  event must not overwrite a newer one and a duplicate must be a no-op rather than an error. */
create or replace function apply_advisor_event(
  p_user_id uuid, p_status text, p_plan text, p_period_end timestamptz,
  p_cancel_at_period_end boolean, p_customer_id text, p_sub_id text,
  p_event_id text, p_event_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare applied boolean;
begin
  insert into advisor_subscriptions as t (user_id, plan, status, current_period_end,
                                          cancel_at_period_end, stripe_customer_id,
                                          stripe_subscription_id, last_event_id, last_event_at)
  values (p_user_id, coalesce(p_plan, 'advisor'), p_status, p_period_end,
          coalesce(p_cancel_at_period_end, false), p_customer_id, p_sub_id, p_event_id, p_event_at)
  on conflict (user_id) do update
     set plan = excluded.plan, status = excluded.status,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         stripe_customer_id = coalesce(excluded.stripe_customer_id, t.stripe_customer_id),
         stripe_subscription_id = coalesce(excluded.stripe_subscription_id, t.stripe_subscription_id),
         last_event_id = excluded.last_event_id, last_event_at = excluded.last_event_at,
         updated_at = now()
     where t.last_event_at is null or t.last_event_at < excluded.last_event_at
  returning true into applied;
  return coalesce(applied, false);
end $$;

revoke all on function apply_advisor_event(uuid, text, text, timestamptz, boolean, text, text, text, timestamptz) from public;
grant execute on function apply_advisor_event(uuid, text, text, timestamptz, boolean, text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------- task 1.7 --
-- THE COLUMN FIRST, because `expiring_subscriptions` below is `language sql` and is therefore PARSED
-- WHEN CREATED. A column referenced before it exists fails the migration outright. This is the second
-- time in this batch — 022 had it too — so `test/engine/migrations.test.js` now scans for it.
--
-- `subscriptions` never recorded this, so the company half of that query stays dead until the Stripe
-- webhook writes it.
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;

/** Subscriptions that will STOP, inside a month. Both tables, because a company losing its plan and an
 *  advisor losing theirs are the same surprise from different directions. Service role: this feeds a
 *  scheduled notice, not a screen. */
create or replace function expiring_subscriptions(p_within interval default interval '30 days')
returns table (kind text, subject_id uuid, plan text, ends_at timestamptz)
language sql security definer stable set search_path = public as $$
  select 'company', s.company_id, s.plan, s.current_period_end
    from subscriptions s
   where s.cancel_at_period_end
     and s.current_period_end between now() and now() + p_within
  union all
  select 'advisor', a.user_id, a.plan, a.current_period_end
    from advisor_subscriptions a
   where a.cancel_at_period_end
     and a.current_period_end between now() and now() + p_within;
$$;


revoke all on function expiring_subscriptions(interval) from public;
grant execute on function expiring_subscriptions(interval) to service_role;
