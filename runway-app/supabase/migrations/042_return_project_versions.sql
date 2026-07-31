-- Runway — migration 042: a save returns the versions it wrote.
--
-- FIXING A DATA-LOSS PATH I INTRODUCED IN 038 AND ARGUED FOR IN A TEST. After a successful write the
-- client discarded its version map, on the reasoning that the rows it had just written were now at
-- versions it did not know, and guessing them would be asserting a precondition nobody checked. The
-- reasoning was fine; the consequence was not, because a NULL map does not mean "check nothing" — it
-- means the pre-040 behaviour:
--
--   p_known is null    -> no per-project version check at all
--   p_changed is null  -> every project in the payload is treated as changed
--
-- So the second save after a load rewrote every project from the client's own copy, including stale
-- ones somebody else had edited. Observed exactly that way: A edits project 1, B edits project 2 and
-- saves, B edits project 2 again — and A's project 1 is gone.
--
-- The answer is not to guess the versions. It is to be TOLD them. `sync_project_docs` now returns
-- {id: version} for the rows it actually wrote, and the client merges that into the map it already
-- holds. Projects it did not write keep the version its copy is based on, which is what makes a later
-- edit to a stale project raise a conflict rather than silently win.
--
-- WHY NOT RETURN EVERY PROJECT'S CURRENT VERSION. Because the map means "the version MY copy is based
-- on", not "the newest version". Handing back the current version of a project this client never
-- adopted would let it overwrite that project on its next save without ever being asked — the same
-- loss, arriving through the front door.

-- DROPPED FIRST: this goes from `void` to `jsonb`, and `create or replace` cannot change a return type.
-- Caught by `migrations.test.js` rather than by a failed apply, which is the third time that scanner
-- has earned its place.
drop function if exists sync_project_docs(uuid, jsonb, uuid, jsonb, jsonb);

create function sync_project_docs(p_company_id uuid, p_body jsonb, p_snapshot uuid,
                                  p_known jsonb default null,
                                  p_changed jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  proj     jsonb;
  pos      int := 0;
  existing project_docs%rowtype;
  seen     text[] := '{}';
  pid      text;
  knew     bigint;
  touched  boolean;
  written  jsonb := '{}'::jsonb;    -- {id: new version} for rows this call actually wrote
begin
  for proj in select value from jsonb_array_elements(coalesce(p_body->'projects', '[]'::jsonb)) loop
    pid := coalesce(proj->>'id', '');
    if pid <> '' then
      seen := seen || pid;
      select * into existing from project_docs
       where company_id = p_company_id and project_id = pid;

      touched := p_changed is null or (p_changed @> to_jsonb(pid));

      if existing.project_id is null then
        insert into project_docs (company_id, project_id, body, position, version, snapshot_id,
                                  updated_by)
        values (p_company_id, pid, proj, pos, 1, p_snapshot, auth.uid());
        insert into project_versions (company_id, project_id, version, body, position, snapshot_id,
                                      created_by)
        values (p_company_id, pid, 1, proj, pos, p_snapshot, auth.uid());
        written := written || jsonb_build_object(pid, 1);

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
        written := written || jsonb_build_object(pid, existing.version + 1);

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

  if p_known is null then
    delete from project_docs
     where company_id = p_company_id and not (project_id = any(seen));
  else
    delete from project_docs
     where company_id = p_company_id
       and not (project_id = any(seen))
       and p_known ? project_id;
  end if;

  return written;
end $$;

revoke all on function sync_project_docs(uuid, jsonb, uuid, jsonb, jsonb) from public;

-- ------------------------------------------------------------ save_document --
-- Dropped BEFORE `sync_project_docs` would be, in a fresh database — but the drop above runs first in
-- this file, so `save_document` briefly references a function that does not exist. plpgsql resolves at
-- CALL time, so that is fine: nothing calls it between these two statements.
drop function if exists save_document(uuid, int, jsonb, bigint, jsonb, jsonb);

create function save_document(
  p_company_id       uuid,
  p_schema_version   int,
  p_body             jsonb,
  p_base_version     bigint,
  p_known_projects   jsonb default null,
  p_changed_projects jsonb default null
) returns table (out_version bigint, out_updated_at timestamptz,
                 out_stale_projects jsonb, out_project_versions jsonb)
language plpgsql security definer set search_path = public as $$
declare
  cur       documents%rowtype;
  refusal   text;
  snap      uuid;
  last_snap timestamptz;
  cutoff    bigint;
  blob_new  jsonb;
  stale     jsonb := '{}'::jsonb;
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

  -- Before the sync: afterwards the projects this client just edited have moved past what it knew, and
  -- reporting those would tell somebody their own edit was made by somebody else.
  if p_known_projects is not null then
    stale := stale_projects_for(p_company_id, p_known_projects);
  end if;

  if cur.id is null then
    insert into document_snapshots (company_id, created_by, reason)
      values (p_company_id, auth.uid(), 'save') returning id into snap;
    insert into documents (company_id, schema_version, body, updated_by, snapshot_id)
      values (p_company_id, p_schema_version, blob_new, auth.uid(), snap)
      returning version, updated_at into out_version, out_updated_at;
    out_project_versions := sync_project_docs(p_company_id, p_body, snap,
                                              p_known_projects, p_changed_projects);
    out_stale_projects := stale;
    return next;
    return;
  end if;

  if p_schema_version < cur.schema_version then
    raise exception 'stale_client' using errcode = 'P0001';
  end if;

  if cur.version <> p_base_version and cur.body is distinct from blob_new then
    raise exception 'conflict' using errcode = 'P0002';
  end if;

  insert into document_snapshots (company_id, created_by, reason)
    values (p_company_id, auth.uid(), 'save') returning id into snap;

  out_project_versions := sync_project_docs(p_company_id, p_body, snap,
                                            p_known_projects, p_changed_projects);
  out_stale_projects := stale;

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
