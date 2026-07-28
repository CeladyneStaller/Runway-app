-- Runway — migration 016: delete_company becomes recoverable, and "deleted" starts meaning it.
--
-- `companies.deleted_at` has existed since 001, is filtered on in SEVEN queries, and was SET BY
-- NOTHING: `delete_company` hard-deleted, cascading away memberships, documents and every version.
-- The read side was already built for soft delete; only the write disagreed. A mis-click was
-- irreversible and the audit row added in 015 was the sole surviving trace.
--
-- THREE THINGS HAD TO BE TRUE AT ONCE for soft delete to be honest rather than merely gentler:
--   1. A deleted company must be UNREACHABLE, not just unlisted (see is_member/can_edit below).
--   2. There must be a way back that a customer can reach without asking us (`restore_company`).
--   3. It must eventually really go (`purge_deleted_companies`), or "deleted" is a lie with a longer
--      fuse — and a data-protection answer nobody wants to give.

-- ------------------------------------------------------------ the window --
-- A function, like `trial_days()` and `version_keep_count()`, so the number is one edit away and
-- readable from SQL rather than buried in a body.
create or replace function company_purge_window() returns interval
language sql immutable as $$ select interval '30 days' $$;

-- ------------------------------------------------------ reachability --
-- THE ABUSE SURFACE THIS CLOSES. Membership rows survive a soft delete — they must, or restore could
-- not put things back — so without this, anyone who still knows a company id could read its document
-- straight from PostgREST for the whole retention window, while every list in the product showed it
-- as gone. "Hidden" is not a security property.
--
-- The cost is one extra index probe: `memberships` is keyed (user_id, company_id) and `companies` is
-- joined on its primary key, inside a `stable` function whose result Postgres caches per statement.
-- These sit under every RLS policy in the schema, so it was worth checking; it is not measurable.
create or replace function is_member(c uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1
                   from memberships m
                   join companies co on co.id = m.company_id and co.deleted_at is null
                  where m.company_id = c and m.user_id = auth.uid());
$$;

create or replace function can_edit(c uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1
                   from memberships m
                   join companies co on co.id = m.company_id and co.deleted_at is null
                  where m.company_id = c and m.user_id = auth.uid()
                    and m.role in ('owner','admin','editor'));
$$;

-- --------------------------------------------------------------- delete --
create or replace function delete_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not exists (select 1 from memberships m
                 where m.company_id = p_company_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select name into nm from companies where id = p_company_id and deleted_at is null;
  if nm is null then
    return;   -- already deleted. Deleting twice is not an error, and not an event either.
  end if;
  perform log_audit(p_company_id, 'company.delete',
                    jsonb_build_object('company_id', p_company_id, 'name', nm));
  update companies set deleted_at = now() where id = p_company_id;
end $$;

-- NOTE for anyone reading 015 next to this: its comment says the foreign key on the audit row empties
-- "a moment later". That was true of a hard delete and is now only true at PURGE. The identity is
-- still duplicated into `detail`, because purge day comes.

-- -------------------------------------------------------------- restore --
-- Its own membership query rather than `can_edit`, which now answers false for exactly the companies
-- this function exists to bring back.
create or replace function restore_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nm text; prior int;
begin
  if not exists (select 1 from memberships m
                 where m.company_id = p_company_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select name into nm from companies
   where id = p_company_id and deleted_at is not null
     and deleted_at > now() - company_purge_window();
  if nm is null then
    -- Not deleted, or deleted so long ago it is past recovery. Distinct from `forbidden`: the caller
    -- is entitled to this company, there is simply nothing to restore.
    raise exception 'not_restorable' using errcode = 'P0005';
  end if;

  -- COUNTED BEFORE THE NEW ROW IS WRITTEN, so `prior >= 1` means this is the second or later restore
  -- inside the window.
  select count(*) into prior
    from audit_log
   where company_id = p_company_id
     and action = 'company.restore'
     and created_at > now() - company_purge_window();

  update companies set deleted_at = null where id = p_company_id;
  perform log_audit(p_company_id, 'company.restore', jsonb_build_object('name', nm));

  -- THE FLAG. Deleting and restoring repeatedly is not itself forbidden, and blocking it would strand
  -- somebody mid-mistake — but it is a shape worth being able to see. A company is only entitled while
  -- it is among the oldest N you own that are NOT deleted, so delete-and-restore is a way to rotate
  -- which company is writable without paying for a second one. One row, so the pattern shows up
  -- wherever the log is read rather than needing somebody to think to look for it.
  if prior >= 1 then
    perform log_audit(p_company_id, 'company.restore.repeated',
                      jsonb_build_object('name', nm, 'restores_in_window', prior + 1,
                                         'window', company_purge_window()::text));
  end if;
end $$;

-- ---------------------------------------------------- what is recoverable --
-- SECURITY DEFINER because `is_member` now hides these rows, which is the point. Owners only: the
-- delete was owner-only, so the way back is too.
create or replace function list_deleted_companies()
returns table (id uuid, name text, deleted_at timestamptz,
               purges_at timestamptz, restores_in_window int)
language sql security definer stable set search_path = public as $$
  select c.id, c.name, c.deleted_at,
         c.deleted_at + company_purge_window(),
         (select count(*)::int from audit_log a
           where a.company_id = c.id and a.action = 'company.restore'
             and a.created_at > now() - company_purge_window())
    from companies c
    join memberships m on m.company_id = c.id
   where m.user_id = auth.uid()
     and m.role = 'owner'
     and c.deleted_at is not null
     and c.deleted_at > now() - company_purge_window()
   order by c.deleted_at desc;
$$;

-- ---------------------------------------------------------------- purge --
-- SERVICE ROLE ONLY, and deliberately not scheduled from inside the database: run it from the same
-- place the stats job runs. A destructive job that fires on a timer nobody can see is how you find out
-- about a bug in it afterwards.
create or replace function purge_deleted_companies(p_older_than interval default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; win interval := coalesce(p_older_than, company_purge_window());
begin
  for r in select id, name, deleted_at from companies
            where deleted_at is not null and deleted_at < now() - win
  loop
    -- Written before the delete; `company_id` is emptied by the cascade a line later, so `detail` is
    -- the only thing that still knows what was removed. `user_id` is null: nobody did this, a job did.
    insert into audit_log (company_id, user_id, action, detail)
      values (r.id, null, 'company.purge',
              jsonb_build_object('company_id', r.id, 'name', r.name, 'deleted_at', r.deleted_at));
    delete from companies where id = r.id;   -- cascades to memberships, documents, versions
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------- saving into a ghost --
-- `can_edit` already answers false for a deleted company, so this would refuse anyway — with
-- `forbidden`, which says "you are not a member" to somebody who is. That is the same misdiagnosis
-- that sent a whole afternoon at RLS when the real fault was a stale company id on the client. The
-- check goes FIRST and has its own SQLSTATE so the client can say the true thing.
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
  if exists (select 1 from companies where id = p_company_id and deleted_at is not null) then
    raise exception 'company_deleted' using errcode = 'P0004';
  end if;

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

-- ---------------------------------------------------------------- grants --
grant execute on function restore_company(uuid)        to authenticated;
grant execute on function list_deleted_companies()     to authenticated;
grant execute on function company_purge_window()       to authenticated;

revoke all on function purge_deleted_companies(interval) from public;
grant execute on function purge_deleted_companies(interval) to service_role;
