-- 008_entitlement.sql
--
-- Billing enforcement. Three principles, and the first two decide the shape of everything here.
--
-- 1. ENFORCED IN THE DATABASE, NEVER THE CLIENT. This is a JavaScript app; anything gated in React is
--    gated in name only. Every write already funnels through `save_document`, so there is exactly one
--    place the check belongs and exactly one place to get it right.
--
-- 2. READS ARE NEVER GATED. An expired or unpaid account can still open and EXPORT its model. This is
--    a commitment the terms of service already make, not a preference — and it is also self-interest:
--    holding somebody's own financial data hostage over a lapsed card generates furious support and
--    makes reactivation adversarial. Nothing in this file touches select.
--
-- 3. THE POLICY IS ONE FUNCTION. `company_entitled()` is the only place that decides who may write.
--    Changing the commercial model — per seat, per company, a trial, a feature limit — should mean
--    editing that function and nothing else. Everything around it is mechanism.

-- ------------------------------------------------------------ subscriptions --
-- WRITTEN ONLY BY THE STRIPE WEBHOOK, using the service role. There is deliberately no insert, update
-- or delete policy: an authenticated user cannot grant themselves a subscription even if they find
-- the table, because RLS denies by default and no policy ever permits it.
create table if not exists subscriptions (
  company_id             uuid primary key references companies (id) on delete cascade,

  -- Stripe's own vocabulary, stored verbatim rather than mapped to ours. A local enum would need
  -- updating every time Stripe adds a status, and the failure mode of a missed one is granting or
  -- revoking access by accident.
  status                 text not null,
  plan                   text,

  -- Access survives to the end of a paid period even after cancellation. Somebody who cancels on the
  -- 2nd has paid for the month and should keep it.
  current_period_end     timestamptz,

  stripe_customer_id     text,
  stripe_subscription_id text unique,

  -- For webhook idempotency: Stripe retries, and events can arrive out of order.
  last_event_id          text,
  last_event_at          timestamptz,
  updated_at             timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- Members may SEE their company's subscription, so the Account page can show the plan and its state.
-- Reading is safe; writing is not exposed at all.
drop policy if exists sub_read on subscriptions;
create policy sub_read on subscriptions for select
  using (exists (
    select 1 from memberships m
     where m.company_id = subscriptions.company_id and m.user_id = auth.uid()
  ));

grant select on subscriptions to authenticated;

create index if not exists subscriptions_customer_idx on subscriptions (stripe_customer_id);

-- ------------------------------------------------------------- the policy --
/**
 * May this company be written to?
 *
 * THE FREE TIER IS THE OLDEST COMPANY YOU OWN. Computed rather than stored, deliberately: a
 * `is_free_slot` column has to be maintained, and every path that creates or deletes a company
 * becomes a place to corrupt it. `order by created_at limit 1` cannot drift, needs no migration when
 * the rule changes, and is trivially explainable to a customer — "your first company is free".
 *
 * STRIPE STATUSES ARE READ GENEROUSLY. `past_due` still writes: a card failing is a dunning problem,
 * not a reason to lock somebody out of their payroll mid-edit, and Stripe retries for days. Only a
 * subscription that is both non-paying AND past its period end stops being entitled.
 */
create or replace function company_entitled(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- an active subscription, generously interpreted
    exists (
      select 1 from subscriptions s
       where s.company_id = p_company_id
         and (s.status in ('active', 'trialing', 'past_due')
              or s.current_period_end > now())
    )
    -- ...or the free slot: the oldest company owned by whoever is asking
    or p_company_id = (
      select m.company_id
        from memberships m
        join companies c on c.id = m.company_id
       where m.user_id = auth.uid()
         and m.role = 'owner'
         and c.deleted_at is null
       order by c.created_at asc
       limit 1
    );
$$;

revoke all on function company_entitled(uuid) from public;
grant execute on function company_entitled(uuid) to authenticated;

-- ------------------------------------------------------------- the write --
-- Identical to 005 except for the entitlement check. Repeated in full because Postgres has no way to
-- patch a function body, and a half-copied one is how a retention policy silently disappears.
create or replace function save_document(
  p_company_id     uuid,
  p_schema_version int,
  p_body           jsonb,
  p_base_version   bigint
) returns table (out_version bigint, out_updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  cur       documents%rowtype;
  last_snap timestamptz;
  cutoff    bigint;
begin
  if not can_edit(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- THE ONLY PLACE BILLING IS ENFORCED. Distinct SQLSTATE from `forbidden`, because "you are not a
  -- member of this company" and "this company needs a subscription" want completely different words
  -- on screen — one is a mistake, the other is a purchase.
  if not company_entitled(p_company_id) then
    raise exception 'payment_required' using errcode = 'P0003';
  end if;

  select * into cur from documents where company_id = p_company_id for update;

  if cur.id is null then
    insert into documents (company_id, schema_version, body, updated_by)
      values (p_company_id, p_schema_version, p_body, auth.uid())
      returning version, updated_at into out_version, out_updated_at;
    return next;
    return;
  end if;

  if p_schema_version < cur.schema_version then
    raise exception 'stale_client' using errcode = 'P0001';
  end if;

  if cur.version <> p_base_version then
    raise exception 'conflict' using errcode = 'P0002';
  end if;

  select created_at into last_snap
    from document_versions where document_id = cur.id
   order by version desc limit 1;

  if last_snap is null or last_snap < now() - version_coalesce_window() then
    insert into document_versions (document_id, schema_version, body, version, created_by)
      values (cur.id, cur.schema_version, cur.body, cur.version, auth.uid());

    select version into cutoff
      from document_versions where document_id = cur.id
     order by version desc offset version_keep_count() limit 1;

    if cutoff is not null then
      delete from document_versions
       where document_id = cur.id and version <= cutoff;
    end if;
  end if;

  update documents
     set body = p_body, schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning version, updated_at into out_version, out_updated_at;
  return next;
end $$;

-- ------------------------------------------------- what the app can see --
-- `list_companies` gains the entitlement state so the UI can show a lock, a plan and a renewal date
-- without a second round trip. Dropped and recreated because the return type changes.
drop function if exists list_companies();

create or replace function list_companies()
returns table (id uuid, name text, role member_role, created_at timestamptz,
               has_document boolean, stats_optout boolean,
               entitled boolean, plan text, sub_status text, period_end timestamptz)
language sql security definer set search_path = public as $$
  select c.id, c.name, m.role, c.created_at,
         exists (select 1 from documents d where d.company_id = c.id),
         c.stats_optout,
         company_entitled(c.id),
         s.plan, s.status, s.current_period_end
    from memberships m
    join companies c on c.id = m.company_id
    left join subscriptions s on s.company_id = c.id
   where m.user_id = auth.uid()
     and c.deleted_at is null
   order by c.created_at asc;
$$;

revoke all on function list_companies() from public;
grant execute on function list_companies() to authenticated;
