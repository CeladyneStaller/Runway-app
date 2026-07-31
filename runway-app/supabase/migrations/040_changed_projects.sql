-- Runway — migration 040: the client says which projects it changed.
--
-- 038/039 CONFLICTED ON PROJECTS NOBODY EDITED, and the reason is structural rather than a slip. The
-- client sends the WHOLE document on every save. B loads six projects, A edits project X, B edits
-- project Y and saves — B's payload still carries its own stale copy of X. The server sees X's body
-- differs from what is stored, checks X's version, finds it moved on, and raises
-- `project_conflict:X` for a project B never opened.
--
-- THE CHECK WAS RIGHT TO FIRE. Without it, B's stale X would have silently overwritten A's edit — the
-- same class of loss the deletion guard fixed. What was wrong is that the server cannot tell "B did not
-- touch X" from "B changed X", because it has X's VERSION and not the body B loaded. Only the client
-- knows that, so the client has to say it.
--
-- `p_changed` is that list. A project on it is written and version-checked; a project off it is left
-- alone entirely, however stale the copy in the payload. Absence still means deletion, so a project
-- removed from the document is removed from the rows — which is why the list is of CHANGED ids rather
-- than of everything present.
--
--   B sends changed = [Y]           -> Y checked and written, X untouched, no conflict
--   B sends changed = [X] stale     -> CONFLICT on X, correctly: B really is overwriting A
--   B deletes X, changed = []       -> X absent from the body and in `p_known` -> deleted
--   old client sends no list        -> null, and every project is treated as changed, exactly as before
--
-- POSITION IS NOT CONTENT and is applied for every project regardless. Reordering the list is not an
-- edit to any project in it, and treating it as one would conflict on all six because somebody dragged
-- one to the top.

create or replace function sync_project_docs(p_company_id uuid, p_body jsonb, p_snapshot uuid,
                                             p_known jsonb default null,
                                             p_changed jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj     jsonb;
  pos      int := 0;
  existing project_docs%rowtype;
  seen     text[] := '{}';
  pid      text;
  knew     bigint;
  touched  boolean;
begin
  for proj in select value from jsonb_array_elements(coalesce(p_body->'projects', '[]'::jsonb)) loop
    pid := coalesce(proj->>'id', '');
    if pid <> '' then
      seen := seen || pid;
      select * into existing from project_docs
       where company_id = p_company_id and project_id = pid;

      -- A null list means a client that does not compute the difference — every project is treated as
      -- changed, which is the pre-040 behaviour and is safe, just noisier.
      touched := p_changed is null or (p_changed @> to_jsonb(pid));

      if existing.project_id is null then
        -- New here regardless of what the client claims: a row that does not exist cannot be left
        -- alone, and inserting it cannot overwrite anybody.
        insert into project_docs (company_id, project_id, body, position, version, snapshot_id,
                                  updated_by)
        values (p_company_id, pid, proj, pos, 1, p_snapshot, auth.uid());
        insert into project_versions (company_id, project_id, version, body, position, snapshot_id,
                                      created_by)
        values (p_company_id, pid, 1, proj, pos, p_snapshot, auth.uid());

      elsif touched and existing.body is distinct from proj then
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
        -- POSITION ONLY, and for untouched projects too. Dragging one project to the top moves the
        -- other five; treating that as an edit would conflict on all of them.
        update project_docs set position = pos, updated_at = now()
         where company_id = p_company_id and project_id = pid;
      end if;
    end if;
    pos := pos + 1;
  end loop;

  if p_known is null then
    delete from project_docs
     where company_id = p_company_id and not (project_id = any(seen));
  else
    -- Only rows the caller knew about. A project it never saw cannot have been deleted by it.
    delete from project_docs
     where company_id = p_company_id
       and not (project_id = any(seen))
       and p_known ? project_id;
  end if;
end $$;

revoke all on function sync_project_docs(uuid, jsonb, uuid, jsonb, jsonb) from public;

-- The old four-argument version is dropped so a stale `save_document` cannot keep calling it and
-- quietly retain the conflicting behaviour.
drop function if exists sync_project_docs(uuid, jsonb, uuid, jsonb);

-- ------------------------------------------------------------ save_document --
-- Reproduced from 039 with `p_changed` added and threaded through. Everything else — the conditional
-- conflict test, the unchanged-blob short circuit, permissions, coalescing, retention — is unchanged.
drop function if exists save_document(uuid, int, jsonb, bigint, jsonb);

create function save_document(
  p_company_id     uuid,
  p_schema_version int,
  p_body           jsonb,
  p_base_version   bigint,
  p_known_projects jsonb default null,
  p_changed_projects jsonb default null
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

  blob_new := p_body - 'projects';

  select * into cur from documents where company_id = p_company_id for update;

  if cur.id is null then
    insert into document_snapshots (company_id, created_by, reason)
      values (p_company_id, auth.uid(), 'save') returning id into snap;
    insert into documents (company_id, schema_version, body, updated_by, snapshot_id)
      values (p_company_id, p_schema_version, blob_new, auth.uid(), snap)
      returning version, updated_at into out_version, out_updated_at;
    perform sync_project_docs(p_company_id, p_body, snap, p_known_projects, p_changed_projects);
    return next;
    return;
  end if;

  if p_schema_version < cur.schema_version then
    raise exception 'stale_client' using errcode = 'P0001';
  end if;

  -- A stale version is only a conflict if this write would overwrite somebody else's BLOB.
  if cur.version <> p_base_version and cur.body is distinct from blob_new then
    raise exception 'conflict' using errcode = 'P0002';
  end if;

  insert into document_snapshots (company_id, created_by, reason)
    values (p_company_id, auth.uid(), 'save') returning id into snap;

  perform sync_project_docs(p_company_id, p_body, snap, p_known_projects, p_changed_projects);

  if cur.body is not distinct from blob_new and cur.schema_version = p_schema_version then
    update documents set snapshot_id = snap, updated_at = now(), updated_by = auth.uid()
     where id = cur.id
     returning version, updated_at into out_version, out_updated_at;
    return next;
    return;
  end if;

  select created_at into last_snap
    from document_versions where document_id = cur.id
   order by version desc limit 1;

  if last_snap is null or last_snap < now() - version_coalesce_window() then
    insert into document_versions (document_id, schema_version, body, version, created_by, snapshot_id)
      values (cur.id, cur.schema_version, cur.body, cur.version, auth.uid(), cur.snapshot_id);

    select version into cutoff
      from document_versions where document_id = cur.id
     order by version desc offset version_keep_count() limit 1;

    if cutoff is not null then
      delete from document_versions where document_id = cur.id and version <= cutoff;
    end if;
  end if;

  update documents
     set snapshot_id = snap, body = blob_new, schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning version, updated_at into out_version, out_updated_at;
  return next;
end $$;

revoke all on function save_document(uuid, int, jsonb, bigint, jsonb, jsonb) from public;
grant execute on function save_document(uuid, int, jsonb, bigint, jsonb, jsonb) to authenticated;
