-- 045 · ONE TRIAL CLOCK PER ACCOUNT
--
-- THE HOLE: 008 entitled "the oldest company you own" — an account-level free slot. 022 replaced that
-- clause with `c.trial_ends_at > now()`, which is correct for a per-company subscription model and
-- silently removed the account-level limit the old clause had been providing. `trial_ends_at` is NOT
-- NULL with a default, so every company created got a fresh fourteen days.
--
-- Limiting it to one unpaid company at a time does not close it either: create on day 1, delete on day
-- 13, create again, get another fourteen days. The clock has to belong to the ACCOUNT, not to a row the
-- user can delete.
--
-- THE SHAPE OF THE FIX: `profiles.trial_started_at` is the clock. `create_company` writes the ACCOUNT'S
-- end date into `companies.trial_ends_at` rather than letting the column default. `company_entitled` is
-- NOT TOUCHED — it already reads `c.trial_ends_at > now()`, and a company created after the account
-- clock has run out is simply born expired. The whole fix lives in what value gets written.

alter table profiles add column if not exists trial_started_at timestamptz;

comment on column profiles.trial_started_at is
  'When this account first created a company. The trial clock. Never reset — deleting a company does '
  'not buy another fourteen days.';

-- BACKFILL FROM THE OLDEST OWNED COMPANY, not from signup. Somebody mid-trial today keeps the time they
-- have left; somebody who signed up months ago and never made a company is not retroactively burned.
update profiles p
   set trial_started_at = sub.first_created
  from (
    select m.user_id, min(c.created_at) as first_created
      from memberships m
      join companies c on c.id = m.company_id
     where m.role = 'owner'
     group by m.user_id
  ) sub
 where p.user_id = sub.user_id
   and p.trial_started_at is null;

-- ------------------------------------------------------------------ helpers --

/** When this account's trial ends. Null when the clock has never started.
 *
 *  DELIBERATELY NOT `security definer` on someone else's account: it reads `profiles`, which RLS already
 *  scopes, and the only caller that needs another user's clock is `create_company`, which is definer
 *  and passes auth.uid() anyway.
 */
create or replace function account_trial_ends(p_user_id uuid default auth.uid())
returns timestamptz
language sql stable security definer set search_path = public as $$
  select p.trial_started_at + (trial_days() || ' days')::interval
    from profiles p
   where p.user_id = p_user_id;
$$;

revoke all on function account_trial_ends(uuid) from public;
grant execute on function account_trial_ends(uuid) to authenticated;

/** Is this account inside its trial? Null clock means it has not started, which counts as inside —
 *  a user who has created nothing has not used anything up. */
create or replace function account_in_trial(p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(account_trial_ends(p_user_id) > now(), true);
$$;

revoke all on function account_in_trial(uuid) from public;
grant execute on function account_in_trial(uuid) to authenticated;

-- ------------------------------------------------------- create_company --

/** Create a company, subject to the trial rules.
 *
 *  TWO RULES, both needed and neither sufficient alone:
 *
 *    1. ONE CLOCK PER ACCOUNT. Fourteen days total, starting at the first company. Deleting a company
 *       does not restart it. This is what stops create-delete-create.
 *
 *    2. ONE UNPAID COMPANY AT A TIME. Otherwise a single trial could carry ten companies at once, and
 *       then expire into ten separate subscription decisions.
 */
create or replace function create_company(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid; nm text; blocking uuid; ends timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  nm := coalesce(nullif(btrim(p_name), ''), 'Untitled company');

  -- STAFF ARE EXEMPT, CHECKED FIRST — the same ordering `company_entitled` uses, and for the same
  -- reason: 022 nearly lost that bypass by rewriting a function from an older copy of itself.
  if not exists (select 1 from staff st where st.user_id = auth.uid()) then

    -- OWNED, NOT MEMBER OF. An advisor sitting in five client companies owns none of them and must
    -- still be able to start their own. Counting memberships here would be the `advisor_usage.companies`
    -- mistake again: a membership count read as though it meant something else.
    select c2.id into blocking
      from memberships m
      join companies c2 on c2.id = m.company_id
     where m.user_id = auth.uid()
       and m.role = 'owner'
       -- SOFT-DELETED COMPANIES MUST NOT BLOCK. `delete_company` was a hard delete once and the rest of
       -- the schema filters on `deleted_at`; without this clause a company that no longer exists would
       -- stop somebody starting again, with nothing on screen to explain why.
       and c2.deleted_at is null
       and not exists (
         select 1 from subscriptions s
          where s.company_id = c2.id
            -- `trialing` is DELIBERATELY ABSENT. That is Stripe's own trial vocabulary, not this
            -- product's trial, and accepting it would let a card-less checkout unlock a second company.
            and (s.status in ('active', 'past_due') or s.current_period_end > now())
       )
     limit 1;

    if blocking is not null then
      -- The blocking company travels with the error so the client can name it and link to its billing
      -- page. "You cannot do that", with no object, is a support email.
      raise exception 'trial_limit:%', blocking using errcode = 'P0001';
    end if;
  end if;

  -- START THE CLOCK ON THE FIRST COMPANY, not at signup. Somebody who signs up, is invited to a
  -- colleague's company, and comes back a month later to start their own has not used anything up.
  update profiles set trial_started_at = now()
   where user_id = auth.uid() and trial_started_at is null;

  ends := account_trial_ends(auth.uid());

  -- THE ACCOUNT'S END DATE, NOT A FRESH FOURTEEN DAYS. A company created on day 10 gets four days. A
  -- company created on day 20 is born expired, which is exactly what closes the delete-and-recreate
  -- loop — and it needs no change to `company_entitled`, which already reads this column.
  insert into companies (name, trial_ends_at) values (nm, ends) returning id into c;
  insert into memberships (user_id, company_id, role) values (auth.uid(), c, 'owner');
  perform log_audit(c, 'company.create', jsonb_build_object('name', nm, 'trial_ends_at', ends));
  return c;
end $$;

revoke all on function create_company(text) from public;
grant execute on function create_company(text) to authenticated;
