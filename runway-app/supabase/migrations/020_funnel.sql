-- Runway — migration 020: the activation funnel.
--
-- Counts how many visitors reach each of eight steps, and nothing else. There is no user id, no company
-- id, no email, no URL and no properties column — not "we do not populate them", they do not exist. A
-- schema with nowhere to put a number from somebody's model cannot later be used to put one there, and
-- this table is written by ANON, from a browser, over the public internet.
--
-- WHY A TABLE AND NOT A VENDOR. `state/funnel.js` says the client half; the server half is that a
-- subprocessor holding behavioural data about people who look at a runway tool is a thing that has to
-- be disclosed, reviewed, and explained to a customer's security questionnaire. Keeping it in the
-- project that already holds the documents adds no new party to that conversation.

create table if not exists funnel_events (
  id       bigint generated always as identity primary key,
  -- A RANDOM value from the browser, not a fingerprint and not a user id. It exists so "landed" and
  -- "signup_completed" can be recognised as the same visitor; it cannot be resolved to a person by
  -- anything in this database, because nothing else stores it.
  anon_id  uuid not null,
  event    text not null,
  at       timestamptz not null default now(),

  -- IDEMPOTENT BY CONSTRAINT. A funnel step is "did this visitor reach it", not "how many times", so a
  -- reload, a double click or a retry cannot inflate a count. It also caps what an abusive caller can
  -- write per id, which matters because the insert below has to be reachable by `anon` — the top of the
  -- funnel happens before anybody signs in, and instrumenting only authenticated users would measure
  -- exactly the half that is not the problem.
  unique (anon_id, event),

  -- THE ALLOWLIST, in the schema. `funnel.js` checks the same list before sending; this is what makes
  -- it a guarantee rather than a convention, and it means a stray or hostile POST cannot invent a step.
  constraint funnel_event_known check (event in (
    'landed', 'demo_started', 'signup_started', 'signup_completed',
    'setup_completed', 'first_save', 'checkout_started', 'checkout_completed'))
);

create index if not exists funnel_events_at_idx on funnel_events (at desc);
create index if not exists funnel_events_event_idx on funnel_events (event);

-- ---------------------------------------------------------------------- RLS --
-- NOBODY READS THIS FROM A CLIENT. Not the person who generated the rows, not an authenticated user,
-- not an owner. The only consumer is the aggregate below, run by the service role. Behavioural data
-- readable by the browser that produced it is one join away from being readable about somebody else.
alter table funnel_events enable row level security;
revoke all on funnel_events from anon, authenticated;

-- --------------------------------------------------------------- the write --
-- SECURITY DEFINER, granted to `anon`, and it accepts exactly two arguments with no way to pass a
-- third. `on conflict do nothing` makes a repeat a no-op rather than an error, because the caller is
-- instrumentation and must never see a failure it would have to handle.
create or replace function record_funnel_event(p_event text, p_anon uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into funnel_events (anon_id, event) values (p_anon, p_event)
  on conflict (anon_id, event) do nothing;
exception
  -- A bad event name violates the CHECK. Swallowed on purpose: the client already validates, so this is
  -- either a stale bundle or somebody poking at the endpoint, and neither deserves a 500 or a log line
  -- per request.
  when check_violation then null;
end $$;

revoke all on function record_funnel_event(text, uuid) from public;
grant execute on function record_funnel_event(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------- the read --
-- What actually gets looked at: how many DISTINCT visitors reached each step in a window, in funnel
-- order rather than alphabetically, so the drop-off is visible by reading down the column.
create or replace function funnel_summary(p_since timestamptz default now() - interval '30 days')
returns table (step int, event text, visitors bigint)
language sql security definer set search_path = public as $$
  with steps(step, event) as (values
    (1, 'landed'), (2, 'demo_started'), (3, 'signup_started'), (4, 'signup_completed'),
    (5, 'setup_completed'), (6, 'first_save'), (7, 'checkout_started'), (8, 'checkout_completed'))
  select s.step, s.event, count(distinct f.anon_id)
    from steps s
    left join funnel_events f on f.event = s.event and f.at >= p_since
   group by s.step, s.event
   order by s.step;
$$;

revoke all on function funnel_summary(timestamptz) from public;
grant execute on function funnel_summary(timestamptz) to service_role;

-- ------------------------------------------------------------- retention --
-- Ninety days. The funnel is a rate, not a history: nobody will ask what happened on a Tuesday last
-- year, and behavioural rows kept forever are rows that have to be disclosed forever.
create or replace function purge_funnel_events(p_older_than interval default interval '90 days')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from funnel_events where at < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function purge_funnel_events(interval) from public;
grant execute on function purge_funnel_events(interval) to service_role;
