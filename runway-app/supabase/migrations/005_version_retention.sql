-- 005_version_retention.sql
--
-- `document_versions` grew without bound. `save_document` inserts a full copy of the document body on
-- every write, a document is 16-22 KB, and saves are debounced at 2.5s — so an hour of real editing
-- produced dozens of 20 KB rows. Roughly 1 MB per editing session per user, forever, in a table that
-- sits on the write path. Nothing ever deleted any of it.
--
-- Two changes, addressing two different problems:
--
--   RETENTION (storage): keep the most recent N snapshots per document, prune the rest on write.
--   COALESCING (write volume): only snapshot when the newest snapshot is older than a short window.
--
-- WHY LAST-N AND NOT A TIME WINDOW. A row count is a hard bound; "90 days" is not — a busy company
-- can still accumulate thousands of rows inside it, and a dormant one loses everything it had. N=20
-- is bounded, predictable, and trivially explained. Account deletion already cascades
-- (004_delete_account.sql), so time-based expiry is not needed for any compliance reason either.
--
-- WHY COALESCING IS SAFE HERE. These snapshots are a SAFETY NET, not a feature: nothing in the client
-- reads `document_versions`, so no user-visible history changes. Fifty snapshots one debounce apart is
-- useless granularity for recovery — you are not restoring a keystroke, you are restoring yesterday.
-- A snapshot every few minutes of continuous editing is both more useful and far cheaper.
--
-- The optimistic-concurrency contract is UNTOUCHED: `documents.version` still increments on every
-- write, and only the snapshot is skipped. Version numbers in `document_versions` simply become
-- sparse, which nothing depends on.

-- ------------------------------------------------------------------ policy --
-- Kept as functions so the numbers are visible in one place and changeable without editing the body
-- of save_document, which is the piece nobody wants to touch twice.

create or replace function version_keep_count() returns int
  language sql immutable as $$ select 20 $$;

create or replace function version_coalesce_window() returns interval
  language sql immutable as $$ select interval '5 minutes' $$;

-- --------------------------------------------------------------- the write --
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

  select * into cur from documents where company_id = p_company_id for update;

  -- first write for this company
  if cur.id is null then
    insert into documents (company_id, schema_version, body, updated_by)
      values (p_company_id, p_schema_version, p_body, auth.uid())
      returning version, updated_at into out_version, out_updated_at;
    return next;
    return;
  end if;

  -- a client older than the stored document must never write: it would silently drop fields it
  -- does not understand.
  if p_schema_version < cur.schema_version then
    raise exception 'stale_client' using errcode = 'P0001';
  end if;

  -- somebody else moved it since this client loaded
  if cur.version <> p_base_version then
    raise exception 'conflict' using errcode = 'P0002';
  end if;

  -- COALESCE. Snapshot only when the newest one has aged past the window. A burst of debounced saves
  -- then produces one checkpoint per window rather than one per keystroke-pause.
  select created_at into last_snap
    from document_versions where document_id = cur.id
   order by version desc limit 1;

  if last_snap is null or last_snap < now() - version_coalesce_window() then
    insert into document_versions (document_id, schema_version, body, version, created_by)
      values (cur.id, cur.schema_version, cur.body, cur.version, auth.uid());

    -- PRUNE. Find the version number of the (N+1)th newest snapshot and drop everything at or below
    -- it. Uses document_versions_doc_idx (document_id, version desc), and deletes one row in the
    -- steady state. When fewer than N+1 rows exist the subquery is NULL and nothing matches.
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

-- ------------------------------------------------------- one-time backfill --
-- Bring history that accumulated before this migration down to the same bound. Safe to re-run.
do $$
declare d record; cutoff bigint;
begin
  for d in select distinct document_id from document_versions loop
    select version into cutoff
      from document_versions where document_id = d.document_id
     order by version desc offset version_keep_count() limit 1;
    if cutoff is not null then
      delete from document_versions where document_id = d.document_id and version <= cutoff;
    end if;
  end loop;
end $$;
