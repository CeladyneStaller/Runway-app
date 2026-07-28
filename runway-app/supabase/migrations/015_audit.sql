-- Runway — migration 015: the audit log starts recording.
--
-- `audit_log` has existed since 001 with NOTHING INSERTING A ROW. That is worse than not having the
-- table: the schema implied a trail this product could not produce, and §5 of BACKEND-PLAN.md said
-- "every document save, membership change and connector action logged with actor, time and IP" —
-- the kind of sentence that ends up answering a security questionnaire. This migration makes it true
-- for the events worth having, and the plan is amended for the one it is not.
--
-- WHAT IS LOGGED: the administrative and destructive acts. A company created, renamed or deleted; an
-- account's data wiped; a subscription changing plan or status. All rare, all either irreversible or
-- entitlement-changing, none of them recorded anywhere else.
--
-- WHAT IS DELIBERATELY NOT LOGGED: DOCUMENT SAVES. `document_versions.created_by` already records who
-- saved what and when, with the body attached, so an audit row would duplicate it while carrying
-- strictly less. The volume is not close either — at the 30-second unsaved ceiling one active editor
-- produces hundreds of rows a day, against a handful of administrative events a year. The trigger for
-- revisiting is Phase 3 putting a SECOND EDITOR in a company, at which point "who changed this" stops
-- having one possible answer. A trigger, not a backlog item.
--
-- NO IP, though the column exists. It is personal data, and the privacy policy is at review right
-- now — quietly starting to collect a new category of it after sending the drafts to a lawyer is the
-- wrong order. `request.headers` is also only populated on PostgREST calls, so anything written by a
-- service-role path would leave it null, and a column that is populated for some rows and not others
-- is worse than one that is empty. The column stays; dropping it would be a migration for nothing.

-- ------------------------------------------------------------------ writer --
-- SECURITY DEFINER, and NOT granted to `authenticated`. The only callers are the definer functions
-- below, which execute as the owner. A client able to call this could forge entries, and a forgeable
-- audit log is not an audit log — it is a table that makes people feel audited.
create or replace function log_audit(p_company_id uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (company_id, user_id, action, detail)
  values (p_company_id, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
end $$;

-- No exception handler on purpose. If the audit insert fails, the operation it describes fails with
-- it. An audit trail that silently skips the entries it could not write is one you cannot reason
-- from, and these are administrative acts — failing loudly costs a retry, not a day's work.
revoke all on function log_audit(uuid, text, jsonb) from public;

-- ------------------------------------------------------------- append-only --
-- 002 granted only SELECT, so this already held BY OMISSION. Stated explicitly because the entire
-- value of an audit log rests on nobody being able to edit it, and a property that holds by accident
-- is one somebody removes by accident.
revoke insert, update, delete, truncate on audit_log from anon, authenticated;

-- ---------------------------------------------------------------- read side --
-- 001 let ANY MEMBER read; §5 said owners. An audit log is a management view — who did what, when —
-- rather than a colleague-facing one, so it narrows to owner and admin.
--
-- Plus your OWN actions, always. Without that clause the most important record in the table is
-- unreadable the instant it is written: `audit_log.company_id` is `on delete set null`, so deleting a
-- company empties the foreign key on the very row that recorded the deletion, and a policy keyed only
-- on company membership can never match it again.
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (
  user_id = auth.uid()
  or exists (
    select 1 from memberships m
     where m.company_id = audit_log.company_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'admin'))
);

-- ------------------------------------------------------- company lifecycle --
create or replace function create_company(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid; nm text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  nm := coalesce(nullif(btrim(p_name), ''), 'Untitled company');
  insert into companies (name) values (nm) returning id into c;
  insert into memberships (user_id, company_id, role) values (auth.uid(), c, 'owner');
  perform log_audit(c, 'company.create', jsonb_build_object('name', nm));
  return c;
end $$;

create or replace function rename_company(p_company_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare was text; became text;
begin
  if not can_edit(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select name into was from companies where id = p_company_id;
  update companies set name = coalesce(nullif(btrim(p_name), ''), name) where id = p_company_id
    returning name into became;
  -- Only when it actually changed. A rename to the same string is not an event, and a log full of
  -- non-events is how people learn to stop reading one.
  if became is distinct from was then
    perform log_audit(p_company_id, 'company.rename', jsonb_build_object('from', was, 'to', became));
  end if;
end $$;

create or replace function delete_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not exists (select 1 from memberships m
                 where m.company_id = p_company_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select name into nm from companies where id = p_company_id;
  -- WRITTEN BEFORE THE DELETE, with the company's identity duplicated into `detail`. The foreign key
  -- empties a moment later, so `detail` is the only place this record still knows what it is about.
  -- This row is also the sole surviving trace of the company: `delete_company` is a HARD delete.
  perform log_audit(p_company_id, 'company.delete',
                    jsonb_build_object('company_id', p_company_id, 'name', nm));
  delete from companies where id = p_company_id;   -- cascades to memberships, documents, versions
end $$;

-- --------------------------------------------------------- account deletion --
-- The single most consequential thing a person can do here, and until now it left no trace anywhere.
-- The row survives the deletion: `user_id` is `on delete set null` (013), so once the Edge Function
-- removes the auth row this entry stops naming anybody — which is also what keeps an erasure request
-- honest. What remains is that a deletion happened, and how much it took.
create or replace function delete_my_data()
returns table (companies_deleted int, memberships_removed int)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sole uuid[];
  n_del int := 0;
  n_left int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.company_id), '{}')
    into sole
    from (
      select m.company_id
        from memberships m
       where m.user_id = uid
         and m.role = 'owner'
         and not exists (
           select 1 from memberships other
            where other.company_id = m.company_id
              and other.user_id <> uid
              and other.role = 'owner'
         )
    ) c;

  -- Logged BEFORE anything is removed, for the same reason as `delete_company`: afterwards there is
  -- nothing left to describe. Company ids go in `detail` because the foreign key will be emptied.
  perform log_audit(null, 'account.delete',
                    jsonb_build_object('companies', to_jsonb(sole), 'count', coalesce(array_length(sole, 1), 0)));

  -- audit_log is NOT cascaded away with this: `company_id` and `user_id` are both `on delete set
  -- null`, so the entries outlive the account with their identifying columns emptied.
  delete from companies where id = any(sole);
  get diagnostics n_del = row_count;

  delete from memberships where user_id = uid;
  get diagnostics n_left = row_count;

  delete from profiles where user_id = uid;

  companies_deleted := n_del;
  memberships_removed := n_left;
  return next;
end $$;

-- -------------------------------------------------------------- billing --
-- A TRIGGER rather than an edit to `apply_subscription_event`. That function is the security boundary
-- billing depends on and it was already repaired once for its parameter names (011); rewriting it to
-- append two lines risks the thing it protects. A trigger also catches every writer, including a hand
-- correction made in the SQL editor at 2am, which is exactly the change somebody later wishes had
-- been recorded.
--
-- The actor comes from the ROW, not `auth.uid()`: this runs as the service role from the webhook, so
-- `auth.uid()` is null. Taking it from the row also means the customer can read their own billing
-- history under the policy above, which the `subscriptions` table cannot give them — it holds only
-- the current state, never how it got there.
create or replace function audit_subscription_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.plan   is distinct from old.plan then
    insert into audit_log (company_id, user_id, action, detail)
    values (null, new.user_id, 'billing.subscription',
            jsonb_build_object(
              'status',     new.status,
              'plan',       new.plan,
              'was_status', case when tg_op = 'UPDATE' then old.status end,
              'was_plan',   case when tg_op = 'UPDATE' then old.plan   end,
              'event_id',   new.last_event_id));
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_audit on subscriptions;
create trigger subscriptions_audit after insert or update on subscriptions
for each row execute function audit_subscription_change();
