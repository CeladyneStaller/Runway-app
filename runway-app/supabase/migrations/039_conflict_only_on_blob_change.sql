-- Runway — migration 039: a stale version is only a conflict if the blob actually changed.
--
-- 038 was wrong, and wrong in the ordering rather than the logic. It added a short circuit so that a
-- save which does not change the blob leaves `documents.version` alone — but placed it AFTER the
-- conflict check, which raises first:
--
--     if cur.version <> p_base_version then
--       raise exception 'conflict' ...        <- fires here
--     end if;
--     ...
--     if cur.body is not distinct from (p_body - 'projects') then   <- never reached
--
-- So two people editing different projects still collided, which is the entire thing stage 5 existed
-- to fix. The short circuit was correct and unreachable.
--
-- THE FIX IS TO ASK A BETTER QUESTION. A stale base version means somebody else wrote since you
-- loaded. That only matters if what you are about to write to the BLOB would overwrite what they
-- wrote — and after 037 the blob holds no projects, so a project-only edit overwrites nothing.
--
--     if cur.version <> p_base_version
--        and cur.body is distinct from (p_body - 'projects') then
--
-- Which is right in every case:
--
--   * A changes cash, B has a stale version and a stale blob copy -> the bodies differ -> CONFLICT,
--     as before, because B would overwrite A's cash.
--   * A changes only project X, B has a stale version -> A left the blob alone, so B's copy still
--     matches it -> no conflict, and B's own project write is checked on its own version.
--   * A and B both change only projects -> neither touches the blob -> per-project checks decide,
--     which is the point.
--
-- Reproduced from 038 with that one condition changed and the now-redundant short circuit removed —
-- the update below is only reached when the body genuinely differs, so a second test for it was two
-- statements saying the same thing.

create or replace function save_document(
  p_company_id     uuid,
  p_schema_version int,
  p_body           jsonb,
  p_base_version   bigint,
  p_known_projects jsonb default null
) returns table (out_version bigint, out_updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  cur       documents%rowtype;
  refusal   text;
  snap      uuid;
  last_snap timestamptz;
  cutoff    bigint;
  blob_new  jsonb;
begin
  if exists (select 1 from companies where id = p_company_id and deleted_at is not null) then
    raise exception 'company_deleted' using errcode = 'P0004';
  end if;

  refusal := write_refusal(p_company_id);
  if refusal = 'forbidden' then
    raise exception 'forbidden' using errcode = '42501';
  elsif refusal = 'payment_required' then
    raise exception 'payment_required' using errcode = 'P0003';
  elsif refusal = 'no_seat' then
    raise exception 'no_seat' using errcode = 'P0013';
  end if;

  -- Computed once: it is the blob as it will be stored, and it is what the conflict test compares.
  blob_new := p_body - 'projects';

  select * into cur from documents where company_id = p_company_id for update;

  if cur.id is null then
    insert into document_snapshots (company_id, created_by, reason)
      values (p_company_id, auth.uid(), 'save') returning id into snap;
    insert into documents (company_id, schema_version, body, updated_by, snapshot_id)
      values (p_company_id, p_schema_version, blob_new, auth.uid(), snap)
      returning version, updated_at into out_version, out_updated_at;
    perform sync_project_docs(p_company_id, p_body, snap, p_known_projects);
    return next;
    return;
  end if;

  if p_schema_version < cur.schema_version then
    raise exception 'stale_client' using errcode = 'P0001';
  end if;

  -- THE CHANGE. A stale version alone is not a conflict; a stale version about to overwrite somebody
  -- else's blob is.
  if cur.version <> p_base_version and cur.body is distinct from blob_new then
    raise exception 'conflict' using errcode = 'P0002';
  end if;

  insert into document_snapshots (company_id, created_by, reason)
    values (p_company_id, auth.uid(), 'save') returning id into snap;

  -- Projects first, so a project conflict abandons the whole save before the document is touched.
  perform sync_project_docs(p_company_id, p_body, snap, p_known_projects);

  if cur.body is not distinct from blob_new and cur.schema_version = p_schema_version then
    -- Nothing in the blob moved. No version bump, no history row: this save belonged to the projects.
    update documents set snapshot_id = snap, updated_at = now(), updated_by = auth.uid()
     where id = cur.id
     returning version, updated_at into out_version, out_updated_at;
    return next;
    return;
  end if;

  select created_at into last_snap
    from document_versions where document_id = cur.id
   order by version desc limit 1;

  -- Coalescing: rapid successive saves share one history row rather than filling the table.
  if last_snap is null or last_snap < now() - version_coalesce_window() then
    insert into document_versions (document_id, schema_version, body, version, created_by, snapshot_id)
      values (cur.id, cur.schema_version, cur.body, cur.version, auth.uid(), cur.snapshot_id);

    select version into cutoff
      from document_versions where document_id = cur.id
     order by version desc offset version_keep_count() limit 1;

    if cutoff is not null then
      delete from document_versions
       where document_id = cur.id and version <= cutoff;
    end if;
  end if;

  update documents
     set snapshot_id = snap, body = blob_new, schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning version, updated_at into out_version, out_updated_at;
  return next;
end $$;

revoke all on function save_document(uuid, int, jsonb, bigint, jsonb) from public;
grant execute on function save_document(uuid, int, jsonb, bigint, jsonb) to authenticated;
