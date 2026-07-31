-- Runway — migration 035: every save also writes project rows, and stamps a snapshot.
--
-- STAGE 2 OF FOUR: DUAL WRITE. The blob is still the source of truth and reads are untouched, so this
-- can be reverted by re-applying 023. What it buys is that `project_docs` stops being a snapshot of one
-- moment and starts tracking every write — which is what makes stage 3's flip a one-line change rather
-- than a leap.
--
-- ENTIRELY SERVER-SIDE. `save_document` already receives the whole document, so it splits `projects`
-- out itself and the client never changes. That removes the largest source of risk from the migration —
-- but it also means THESE FOUR STAGES DELIVER NO CONCURRENCY WIN. The client still sends one
-- `p_base_version` for the whole document, so two people editing different projects still collide.
-- Per-project concurrency is a fifth step, where the client tracks a version per project and this
-- function takes them. Worth being explicit about rather than letting it be assumed from "we split the
-- document".
--
-- A VERSION ROW PER PROJECT PER SAVE WOULD BE WORSE THAN TODAY. Eight projects would mean eight history
-- rows for every debounced write, against one now. So a project's version is bumped and its history
-- appended ONLY WHEN ITS BODY CHANGED — which for a normal edit is one project out of eight, and is
-- the actual write-volume win.
--
-- Reproduced from 023 with three blocks added: the snapshot, the project sync, and the stamp. The
-- permission checks, projection, version coalescing, retention and conflict handling are unchanged.

/** Bring `project_docs` into line with a document body, and record what changed.
 *
 *  SECURITY DEFINER and never granted: it is called only from `save_document`, which has already
 *  decided the caller may write. Exposing it would be a second way into the document, and this schema
 *  has spent a lot of effort having one. */
create or replace function sync_project_docs(p_company_id uuid, p_body jsonb, p_snapshot uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj     jsonb;
  pos      int := 0;
  existing project_docs%rowtype;
  seen     text[] := '{}';
  pid      text;
begin
  for proj in select value from jsonb_array_elements(coalesce(p_body->'projects', '[]'::jsonb)) loop
    pid := coalesce(proj->>'id', '');
    -- A project with no id cannot be addressed and is left to the blob, exactly as the 034 backfill
    -- did. Minting one here would orphan `pos[].projectId`, `lines[].projectId` and both maps.
    if pid <> '' then
      seen := seen || pid;
      select * into existing from project_docs
       where company_id = p_company_id and project_id = pid;

      if existing.project_id is null then
        insert into project_docs (company_id, project_id, body, position, version, snapshot_id,
                                  updated_by)
        values (p_company_id, pid, proj, pos, 1, p_snapshot, auth.uid());
        insert into project_versions (company_id, project_id, version, body, position, snapshot_id,
                                      created_by)
        values (p_company_id, pid, 1, proj, pos, p_snapshot, auth.uid());

      elsif existing.body is distinct from proj then
        -- CHANGED: bump and record. This test is the write-volume win — a normal edit touches one
        -- project out of eight, and the other seven cost nothing but a position check.
        update project_docs
           set body = proj, position = pos, version = existing.version + 1,
               snapshot_id = p_snapshot, updated_at = now(), updated_by = auth.uid()
         where company_id = p_company_id and project_id = pid;
        insert into project_versions (company_id, project_id, version, body, position, snapshot_id,
                                      created_by)
        values (p_company_id, pid, existing.version + 1, proj, pos, p_snapshot, auth.uid());

        -- Same retention as documents, per project rather than per company: twenty versions of one
        -- project is far more of what somebody wants to undo than twenty of the whole document.
        delete from project_versions v
         where v.company_id = p_company_id and v.project_id = pid
           and v.version <= (select max(version) from project_versions
                              where company_id = p_company_id and project_id = pid)
                            - version_keep_count();

      elsif existing.position is distinct from pos then
        -- MOVED BUT NOT EDITED. Position is not part of the project's content, so reordering the list
        -- does not deserve a version row for every project that shifted.
        update project_docs set position = pos, updated_at = now()
         where company_id = p_company_id and project_id = pid;
      end if;
    end if;
    pos := pos + 1;
  end loop;

  -- GONE FROM THE DOCUMENT, so gone from the rows. History survives: `project_versions` keeps its rows
  -- and the snapshot that removed it is still on the document, so a restore can put it back.
  delete from project_docs
   where company_id = p_company_id and not (project_id = any(seen));
end $$;

revoke all on function sync_project_docs(uuid, jsonb, uuid) from public;

create or replace function save_document(
  p_company_id     uuid,
  p_schema_version int,
  p_body           jsonb,
  p_base_version   bigint
) returns table (out_version bigint, out_updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  cur       documents%rowtype;
  refusal   text;
  snap      uuid;
  last_snap timestamptz;
  cutoff    bigint;
begin
  if exists (select 1 from companies where id = p_company_id and deleted_at is not null) then
    raise exception 'company_deleted' using errcode = 'P0004';
  end if;

  -- ONE CALL, THREE POSSIBLE REFUSALS, each with its own SQLSTATE because each needs a different action
  -- from whoever reads it: fix your role, buy a subscription, or ask somebody for a seat. Collapsing
  -- them into one message would send two thirds of the people who see it somewhere useless.
  --
  -- The order matters. Role first, because somebody with no business writing here should not be told
  -- what the company's billing status is. Then payment, then seats — a company nobody has paid for has
  -- no seats to be short of, so reporting `no_seat` first would describe a consequence as the cause.
  refusal := write_refusal(p_company_id);
  if refusal = 'forbidden' then
    raise exception 'forbidden' using errcode = '42501';
  elsif refusal = 'payment_required' then
    raise exception 'payment_required' using errcode = 'P0003';
  elsif refusal = 'no_seat' then
    -- NEW IN 023. The company is paid for and this person may edit, but the plan's seats are taken by
    -- others. Non-destructive by design: a downgrade leaves everybody a member and takes away write
    -- access, so upgrading restores them without anybody re-inviting anybody.
    raise exception 'no_seat' using errcode = 'P0013';
  end if;

  select * into cur from documents where company_id = p_company_id for update;

  if cur.id is null then
    insert into document_snapshots (company_id, created_by, reason)
      values (p_company_id, auth.uid(), 'save') returning id into snap;
    insert into documents (company_id, schema_version, body, updated_by, snapshot_id)
      values (p_company_id, p_schema_version, p_body, auth.uid(), snap)
      returning version, updated_at into out_version, out_updated_at;
    perform sync_project_docs(p_company_id, p_body, snap);
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
    -- THE SNAPSHOT THAT CREATED IT, not the one replacing it. This row is the PREVIOUS body being
    -- archived, so it belongs to the moment it was written — which is what makes "restore everything
    -- carrying snapshot X" pick up a coherent set rather than a mixture.
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

  -- ONE SNAPSHOT PER SAVE, stamped on the document and on every project row it touches. That grouping
  -- is what makes "put it back to yesterday" a rule rather than a guess, and it is defined now — with
  -- only two kinds of row — because retrofitting it across three or four kinds is meaningfully worse.
  insert into document_snapshots (company_id, created_by, reason)
    values (p_company_id, auth.uid(), 'save') returning id into snap;

  update documents
     set snapshot_id = snap, body = p_body, schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning version, updated_at into out_version, out_updated_at;
  perform sync_project_docs(p_company_id, p_body, snap);
  return next;
end $$;

