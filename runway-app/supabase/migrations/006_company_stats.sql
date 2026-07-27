-- 006_company_stats.sql
--
-- Aggregate statistics — "N companies use Waterline", "$X billion in runway modelled".
--
-- THIS IS THE ONE DELIBERATE HOLE IN TENANT ISOLATION, and the shape of this migration is about
-- keeping it exactly one. Computing a cross-company figure requires reading every company's document,
-- which requires the service role, which bypasses RLS. That is unavoidable. What is avoidable is
-- having that capability sitting loose:
--
--   * The job is the ONLY thing that reads across tenants. It runs on a schedule, writes one row
--     here, and holds nothing. No ad-hoc cross-tenant queries against live documents, ever.
--   * `company_stats` is written by the service role alone. There is no insert or update policy, so
--     an authenticated user cannot write a row even if they find the table.
--   * The public surface is a VIEW exposing the latest UNSUPPRESSED snapshot, not the table. If the
--     cohort floor was not met, the view is empty rather than serving a small-sample figure.
--
-- The figures themselves are computed in `src/engine/stats.js`, deliberately NOT in SQL: runway is
-- the most heavily tested calculation in the product and reimplementing it here would create a second
-- source of truth that drifts from the one the customer sees.

-- ---------------------------------------------------------------- opt-out --
-- Honoured in the job's QUERY, not filtered afterwards: a company that opted out is never read.
alter table companies add column if not exists stats_optout boolean not null default false;

comment on column companies.stats_optout is
  'When true this company is excluded from aggregate statistics before its document is read.';

-- --------------------------------------------------------------- snapshots --
create table if not exists company_stats (
  id                       bigserial primary key,
  computed_at              timestamptz not null default now(),

  -- always published: a count says nothing about any individual company
  companies                int  not null,

  -- the cohort that produced the figures, kept WITH them: a published number without its sample
  -- size is unfalsifiable, and six months later nobody remembers what N was
  sample_size              int  not null,
  min_cohort               int  not null,
  suppressed               boolean not null,

  -- null whenever `suppressed` is true. Absent, not rounded or fuzzed — a blurred figure still
  -- carries information.
  total_cash               numeric,
  total_funding_raised     numeric,
  total_annual_revenue     numeric,
  total_headcount          int,
  median_runway_months     numeric,
  mean_runway_months       numeric,
  runway_sample_size       int,
  companies_beyond_horizon int,
  horizon_months           int
);

create index if not exists company_stats_at_idx on company_stats (computed_at desc);

alter table company_stats enable row level security;

-- No insert/update/delete policy anywhere: writes are service-role only.
-- No select policy either — authenticated users read the view below, not the table.

-- ------------------------------------------------------------ public view --
-- What a marketing page may read. `security_invoker = off` so the view can see the table the caller
-- cannot, which is the point of having a view rather than a policy.
create or replace view public_stats
  with (security_invoker = off) as
  select computed_at, companies, sample_size,
         total_cash, total_funding_raised, total_annual_revenue, total_headcount,
         median_runway_months, mean_runway_months, runway_sample_size,
         companies_beyond_horizon, horizon_months
    from company_stats
   where suppressed = false
   order by computed_at desc
   limit 1;

-- Readable without an account: these are the figures intended for publication.
grant select on public_stats to anon, authenticated;

comment on view public_stats is
  'Latest publishable aggregate snapshot. Empty when the cohort floor was not met.';
