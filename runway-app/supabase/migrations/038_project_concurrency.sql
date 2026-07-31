-- Runway — migration 038: two people editing different projects stop colliding.
--
-- THE FIFTH STEP, and the one that pays off the driver 3.8 was justified by. Stages 1–4 moved projects
-- into rows; this makes those rows independently editable. It also fixes a data-loss path that has
-- existed since stage 2 and is worse than the concurrency problem it sits beside.
--
-- ============================ THE DELETION BUG, first, because it can lose work ==================
--
-- `sync_project_docs` deletes any project row not present in the body it is handed. That is correct
-- when the caller has seen every project — and the caller has NOT. A loads six projects. B adds a
-- seventh. A saves, its body still has six, and B's project is deleted. No conflict is raised because
-- the DOCUMENT version is what is checked, and A's edit to the blob was legitimate.
--
-- So deletion now requires that the client KNEW about the project: it deletes only rows the caller
-- listed in `p_known` and did not send back. A project the caller never saw is left alone, because a
-- client cannot intend to delete something it does not know exists.
--
-- ============================ THE CONCURRENCY CHANGE ============================================
--
-- Two halves, and the first is easy to miss:
--
--   1. AN UNCHANGED BLOB IS NOT A WRITE. `save_document` bumps `documents.version` on every save, so A
--      editing project X invalidates B's base version even though B is editing project Y and neither
--      touched the blob. Comparing the stored body to the incoming one — minus projects, which no
--      longer live there — means a project-only edit does not bump the document at all, and therefore
--      cannot conflict with another project-only edit.
--
--   2. EACH CHANGED PROJECT CHECKS ITS OWN VERSION. `p_known` carries what the client loaded; a project
--      whose row has moved on since raises `project_conflict` NAMING IT, rather than the whole
--      document reporting a collision the person cannot locate.
--
-- ALL OR NOTHING still. A conflict on one project abandons the save rather than writing the rest —
-- partial success would need the client to reconcile two states, and this schema has spent a lot of
-- effort making a write either happen or not.

create or replace function sync_project_docs(p_company_id uuid, p_body jsonb, p_snapshot uuid,
                                             p_known jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj     jsonb;
  pos      int := 0;
  existing project_docs%rowtype;
  seen     text[] := '{}';
  pid      text;
  knew     bigint;
begin
  for proj in select value from jsonb_array_elements(coalesce(p_body->'projects', '[]'::jsonb)) loop
    pid := coalesce(proj->>'id', '');
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
        -- THE PER-PROJECT PRECONDITION. `p_known` is what the caller loaded; null means a caller that
        -- does not send versions yet, and those keep the old behaviour rather than being refused.
        if p_known is not null then
          knew := (p_known->>pid)::bigint;
          if knew is null or knew <> existing.version then
            raise exception 'project_conflict:%', pid using errcode = 'P0018';
          end if;
        end if;

        update project_docs
           set body = proj, position = pos, version = existing.version + 1,
               snapshot_id = p_snapshot, updated_at = now(), updated_by = auth.uid()
         where company_id = p_company_id and project_id = pid;
        insert into project_versions (company_id, project_id, version, body, position, snapshot_id,
                                      created_by)
        values (p_company_id, pid, existing.version + 1, proj, pos, p_snapshot, auth.uid());

        delete from project_versions v
         where v.company_id = p_company_id and v.project_id = pid
           and v.version <= (select max(version) from project_versions
                              where company_id = p_company_id and project_id = pid)
                            - version_keep_count();

      elsif existing.position is distinct from pos then
        update project_docs set position = pos, updated_at = now()
         where company_id = p_company_id and project_id = pid;
      end if;
    end if;
    pos := pos + 1;
  end loop;

  -- ONLY WHAT THE CALLER KNEW ABOUT. A row the client never saw is left alone: it cannot have intended
  -- to delete something it does not know exists, and treating absence as deletion is how one person's
  -- save quietly removes another's project.
  if p_known is null then
    delete from project_docs
     where company_id = p_company_id and not (project_id = any(seen));
  else
    delete from project_docs
     where company_id = p_company_id
       and not (project_id = any(seen))
       and p_known ? project_id;
  end if;
end $$;

revoke all on function sync_project_docs(uuid, jsonb, uuid, jsonb) from public;

-- Runway — migration 038b: `save_document` takes the project versions the client loaded.
--
-- Reproduced from 037 with three changes: the new `p_known_projects` parameter, passing it to
-- `sync_project_docs`, and the unchanged-blob short circuit that stops a project-only edit from
-- bumping the document and colliding with another project-only edit.
--
-- THE OLD SIGNATURE IS DROPPED. A deployed client calling the four-argument version would otherwise
-- keep the old behaviour silently — including the deletion bug 038 fixes — and a signature that
-- quietly persists is how two code paths survive a migration nobody realised was partial.

drop function if exists save_document(uuid, int, jsonb, bigint);

create or replace function save_document(
  p_company_id     uuid,
  p_schema_version int,
  p_body           jsonb,
  p_base_version   bigint,
  -- WHAT THE CLIENT LOADED: {project_id: version}. Null from a client that does not send them yet,
  -- which keeps the previous behaviour rather than refusing the save.
  p_known_projects jsonb default null
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
    -- THE ROWS GET THE WHOLE BODY, the blob gets it stripped. Order matters only in that `sync` must
    -- be handed the projects before they are removed — which is why it takes `p_body` and not the
    -- column.
    insert into documents (company_id, schema_version, body, updated_by, snapshot_id)
      values (p_company_id, p_schema_version, p_body - 'projects', auth.uid(), snap)
      returning version, updated_at into out_version, out_updated_at;
    perform sync_project_docs(p_company_id, p_body, snap, p_known_projects);
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

  -- AN UNCHANGED BLOB IS NOT A WRITE. Without this, A editing project X bumps `documents.version` and
  -- invalidates B's base version even though B is editing project Y and neither touched the blob —
  -- which would make per-project concurrency pointless, since every save would still collide on the
  -- document. A project-only edit now leaves the document row's version exactly where it was.
  if cur.body is not distinct from (p_body - 'projects')
     and cur.schema_version = p_schema_version then
    perform sync_project_docs(p_company_id, p_body, snap, p_known_projects);
    update documents set snapshot_id = snap, updated_at = now(), updated_by = auth.uid()
     where id = cur.id
     returning version, updated_at into out_version, out_updated_at;
    return next;
    return;
  end if;

  update documents
     set snapshot_id = snap, body = p_body - 'projects', schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning version, updated_at into out_version, out_updated_at;
  perform sync_project_docs(p_company_id, p_body, snap, p_known_projects);
  return next;
end $$;


-- ------------------------------------------------- the versions to send back --
-- `load_document` returned project BODIES; the client now also needs their VERSIONS, or it has nothing
-- to put in `p_known_projects` and per-project checking cannot happen. Returned as a map rather than
-- alongside each body so that assembling a document — which the client does with the tested
-- `assembleDocument` — is not entangled with concurrency bookkeeping.
drop function if exists load_document(uuid);

create function load_document(p_company_id uuid)
returns table (body jsonb, schema_version int, version bigint, updated_at timestamptz,
               projects jsonb, project_versions jsonb, snapshot_id uuid)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select d.body, d.schema_version, d.version, d.updated_at,
           coalesce((select jsonb_agg(p.body order by p.position, p.project_id)
                       from project_docs p where p.company_id = d.company_id), '[]'::jsonb),
           coalesce((select jsonb_object_agg(p.project_id, p.version)
                       from project_docs p where p.company_id = d.company_id), '{}'::jsonb),
           d.snapshot_id
      from documents d
     where d.company_id = p_company_id;
end $$;

revoke all on function load_document(uuid) from public;
grant execute on function load_document(uuid) to authenticated;
