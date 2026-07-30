-- Runway — migration 022: the commercial model moves to the COMPANY, and seats become real.
--
--   Solo           1 seat
--   Collaborative  3 seats
--   Connected      5 seats + the QuickBooks connection
--
--   Advisor        a USER ATTRIBUTE, not a plan. Invited to any number of companies, consumes no seat.
--
-- WHY THIS REVERSES 009. That migration moved subscriptions from company to user because the plans were
-- per-account with a company allowance. Two things broke that: `company_entitled` only ever consults
-- members whose role is OWNER, and an advisor is invited as an admin or a viewer — so the Advisor tier
-- sold an unlimited-companies allowance that applied to the zero companies an advisor owns. The
-- workaround, making the advisor an owner, became actively dangerous with 021: an owner can delete the
-- company, remove you and demote you.
--
-- 009'S OTHER TWO REASONS STILL STAND and are respected here:
--   * There is no free tier. The free thing is the demo. Nothing below grants a free company.
--   * "A stored trial needs a row created at signup, which needs a hook, which can fail and leave an
--     account unable to write." That objection is real and it is why `trial_ends_at` below is NOT NULL
--     WITH A DEFAULT. Two paths create companies — `create_company()` and the bootstrap inside
--     `current_company()` — and a path that forgets to set a trial now hands out an extra fourteen days
--     instead of creating a company nobody can ever write to. The failure falls towards costing money
--     rather than towards locking somebody out.
--
-- THIS MIGRATION IS ADDITIVE. `subscriptions.user_id` keeps its primary key and the Stripe webhook keeps
-- working unchanged; `company_id` is added and backfilled beside it. Rekeying, the checkout metadata and
-- the webhook are a separate step, because that step is the only one that can break a paying customer.

-- ------------------------------------------------------------------- seats --
create or replace function plan_seats(p_plan text) returns int
  language sql immutable as $$
  select case p_plan
    when 'solo'          then 1
    when 'collaborative' then 3
    when 'connected'     then 5
    -- 'advisor' was a plan and is now a user attribute. Anyone still on it is treated as Collaborative
    -- rather than as zero: a live subscriber must never be reduced to no seats by a migration.
    when 'advisor'       then 3
    else 0
  end $$;

revoke all on function plan_seats(text) from public;
grant execute on function plan_seats(text) to authenticated;

-- ------------------------------------------------------------- the company --
alter table companies add column if not exists created_by uuid references auth.users (id) on delete set null;

-- NOT NULL WITH A DEFAULT, for the reason in the header: a forgotten path over-grants rather than
-- bricking a company. The default is deliberately generous and the RULE is applied by CLEARING it.
alter table companies add column if not exists trial_ends_at timestamptz not null
  default (now() + interval '14 days');

-- Backfill reproduces today's COMPUTED behaviour exactly, so no existing company changes state when the
-- new entitlement lands: the trial ran fourteen days from the earliest owner's signup.
update companies c
   set trial_ends_at = coalesce((
         select u.created_at + interval '14 days'
           from memberships m join auth.users u on u.id = m.user_id
          where m.company_id = c.id and m.role = 'owner'
          order by m.created_at asc limit 1), c.created_at + interval '14 days'),
       created_by = coalesce(c.created_by, (
         select m.user_id from memberships m
          where m.company_id = c.id and m.role = 'owner'
          order by m.created_at asc limit 1))
 where c.trial_ends_at > now() + interval '13 days';   -- i.e. only rows that just took the default

-- ------------------------------------------------------------- the advisor --
alter table profiles add column if not exists is_advisor boolean not null default false;

/** Advisors are set by us, never by the customer — it is a commercial arrangement, and a flag a user
 *  could set for themselves would be a free unlimited plan. No `authenticated` grant. */
create or replace function set_advisor(p_user_id uuid, p_is_advisor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, is_advisor) values (p_user_id, p_is_advisor)
  on conflict (user_id) do update set is_advisor = excluded.is_advisor;
end $$;

revoke all on function set_advisor(uuid, boolean) from public;
grant execute on function set_advisor(uuid, boolean) to service_role;

create or replace function is_advisor(p_user_id uuid default auth.uid()) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select p.is_advisor from profiles p where p.user_id = p_user_id), false);
$$;

revoke all on function is_advisor(uuid) from public;
grant execute on function is_advisor(uuid) to authenticated;

-- -------------------------------------------------------- subscription link --
alter table subscriptions add column if not exists company_id uuid
  references companies (id) on delete cascade;

-- One row today, and its company is the one the old allowance actually covered: the oldest non-deleted
-- company that user owns.
update subscriptions s
   set company_id = (
     select c.id from memberships m join companies c on c.id = m.company_id
      where m.user_id = s.user_id and m.role = 'owner' and c.deleted_at is null
      order by c.created_at asc limit 1)
 where s.company_id is null;

create index if not exists subscriptions_company_idx on subscriptions (company_id);

-- ------------------------------------------------------------- declining --
-- MOVED ABOVE `company_seat_usage`, WHICH READS IT. A `language sql` function is parsed when it is
-- created, so a column referenced before it exists fails the migration outright — plpgsql defers the
-- same reference to runtime and would have let it through until somebody called it.
alter table invitations add column if not exists declined_at timestamptz;

-- The partial unique index has to learn about declining, or a declined invitation blocks re-inviting.
drop index if exists invitations_pending_uniq;
create unique index if not exists invitations_pending_uniq
  on invitations (company_id, email)
  where accepted_at is null and revoked_at is null and declined_at is null;


-- ------------------------------------------------------- IS IT PAID FOR? --
/** Does this COMPANY have a right to be written to? Nothing about who is asking.
 *
 *  Split from the seat question on purpose: "this company is not paid for" and "you do not hold one of
 *  its seats" are different problems with different fixes, and one message covering both would send
 *  half the people who see it to the wrong place. */
create or replace function company_entitled(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  -- STAFF FIRST, and this clause was nearly lost. 014 redefined `company_entitled` to add a billing
  -- bypass for comped accounts, so 014 — not 009 — held the live definition. Rewriting the function
  -- from 009's version silently removed the bypass, which would have started charging the author for
  -- his own companies. `create or replace` gives no warning when it replaces something that grew.
  --
  -- It bypasses BILLING, NOT ISOLATION or SEATS: `write_refusal` still calls `can_edit` first, and a
  -- staff member still needs a seat. What they skip is paying.
  select exists (select 1 from staff st where st.user_id = auth.uid())
  or exists (
    select 1 from companies c
     left join subscriptions s on s.company_id = c.id
     where c.id = p_company_id
       and c.deleted_at is null
       and (
         -- Paid. Stripe's vocabulary verbatim; `past_due` still counts, because a failed card is a
         -- dunning problem and locking the model is not how you get paid.
         s.status in ('active', 'trialing', 'past_due')
         -- Or cancelled but still inside the period already paid for.
         or s.current_period_end > now()
         -- Or inside the trial this company was created with.
         or c.trial_ends_at > now()
       )
  );
$$;

-- --------------------------------------------------------- DO YOU HAVE A SEAT? --
/** Seats in order: the OWNER first, then by when each membership was created.
 *
 *  This is what makes a downgrade non-destructive. Collaborative to Solo leaves the owner writing and
 *  everyone else read-only WITHOUT DELETING ANY MEMBERSHIP, so upgrading restores them exactly. The
 *  trigger for a downgrade is a billing event — a card expiring on holiday — and removing three
 *  people's access irreversibly over a payment blip is not a thing this product should do. Removing
 *  somebody stays a deliberate act by an owner (`remove_member`).
 *
 *  ADVISORS ARE EXEMPT FROM THE COUNT AND FROM THE LIMIT. They neither consume a seat nor need one,
 *  which is the whole point of the attribute. */
create or replace function holds_seat(p_company_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_user_id is null then false
    when is_advisor(p_user_id) then true
    -- Staff hold no seat and consume none, for the same reason advisors do not: the flag exists so
    -- support and demo accounts can work inside a customer's company without the customer paying for
    -- the privilege of being helped.
    when exists (select 1 from staff st where st.user_id = p_user_id) then true
    else p_user_id in (
      select m.user_id
        from memberships m
        left join profiles p on p.user_id = m.user_id
       where m.company_id = p_company_id
         and not coalesce(p.is_advisor, false)
         and not exists (select 1 from staff st where st.user_id = m.user_id)
       order by (m.role = 'owner') desc, m.created_at asc, m.user_id
       limit (select plan_seats(coalesce(s.plan, case when c.trial_ends_at > now() then 'solo' else '' end))
                from companies c left join subscriptions s on s.company_id = c.id
               where c.id = p_company_id)
    )
  end;
$$;

/** How many seats are taken and how many exist — for the members screen, and for refusing an invitation
 *  when there is nowhere to put the person. Advisors are excluded from `used`. */
create or replace function company_seat_usage(p_company_id uuid)
returns table (seats int, used int, pending int)
language sql security definer stable set search_path = public as $$
  select
    coalesce((select plan_seats(coalesce(s.plan,
               case when c.trial_ends_at > now() then 'solo' else '' end))
                from companies c left join subscriptions s on s.company_id = c.id
               where c.id = p_company_id), 0),
    (select count(*)::int from memberships m
       left join profiles p on p.user_id = m.user_id
      where m.company_id = p_company_id
        and not coalesce(p.is_advisor, false)
        and not exists (select 1 from staff st where st.user_id = m.user_id)),
    -- A PENDING INVITATION HOLDS A SEAT. Otherwise a three-seat company sends fifty invitations and
    -- the first three to accept win, which is a race nobody asked to be in. Expired and revoked ones
    -- release it — the same predicate `list_invitations` uses, or one forgotten invite holds a seat
    -- forever.
    (select count(*)::int from invitations i
      where i.company_id = p_company_id
        and i.accepted_at is null and i.revoked_at is null and i.declined_at is null
        and i.expires_at > now());
$$;

revoke all on function company_entitled(uuid) from public;
revoke all on function holds_seat(uuid, uuid) from public;
revoke all on function company_seat_usage(uuid) from public;
grant execute on function company_entitled(uuid) to authenticated;
grant execute on function holds_seat(uuid, uuid) to authenticated;
grant execute on function company_seat_usage(uuid) to authenticated;

/** The INVITEE says no. Distinct from `revoke_invitation`, which is the inviter withdrawing it: the
 *  audit trail should be able to tell "they said no" from "we changed our mind", and only one of those
 *  means stop asking. */
create or replace function decline_invitation(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare inv invitations; me text;
begin
  select lower(u.email) into me from auth.users u where u.id = auth.uid();
  select * into inv from invitations
   where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
     and accepted_at is null and revoked_at is null and declined_at is null;
  if inv.id is null then return; end if;               -- nothing to decline is not an error
  if me is null or me <> inv.email then
    raise exception 'wrong_email' using errcode = 'P0011';
  end if;
  update invitations set declined_at = now() where id = inv.id;
  perform log_audit(inv.company_id, 'member.decline', jsonb_build_object('email', inv.email));
end $$;

revoke all on function decline_invitation(text) from public;
grant execute on function decline_invitation(text) to authenticated;

-- ------------------------------------------------------------ the writes --
/** Three refusals, three codes, because they need three different actions from whoever reads them:
 *  fix your role, buy a subscription, or ask for a seat. `save_document` raises them in that order. */
create or replace function write_refusal(p_company_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not can_edit(p_company_id)       then 'forbidden'
    when not company_entitled(p_company_id) then 'payment_required'
    when not holds_seat(p_company_id)     then 'no_seat'
    else null
  end;
$$;

revoke all on function write_refusal(uuid) from public;
grant execute on function write_refusal(uuid) to authenticated;
