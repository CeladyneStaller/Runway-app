-- Runway — migration 041: a save tells you which projects somebody else changed.
--
-- THE GAP 040 LEFT. Per-project concurrency means B's save no longer collides with A's edit to a
-- different project — which is the point, and which also means B is never told about it. B's screen
-- keeps showing A's project as it was at load, indefinitely, until something makes B reload. The
-- conflict that used to be an obstruction was also, accidentally, the notification.
--
-- The server already holds both numbers at save time: what the client knew (`p_known_projects`) and
-- what is stored. Reporting the difference costs one query and no new bookkeeping.
--
-- COMPUTED BEFORE THE WRITE, which is the whole subtlety. After `sync_project_docs` runs, the projects
-- this client just edited have also moved past what it knew — and reporting those would tell somebody
-- their own edit was made by somebody else.
--
-- IT RETURNS THE BODY, not just a flag. A flag makes the client fetch, which is a second round trip and
-- a second moment for things to change underneath it. The body is what the UI needs to offer "load
-- their version", and it is already in hand.
--
-- WHO, BY EMAIL. `project_docs.updated_by` is a uuid and "somebody changed this" is a worse sentence
-- than "Dana changed this". Members can already see each other's emails through `list_members`, so this
-- exposes nothing new — and it is a definer function, so the join to `auth.users` is available.

create or replace function stale_projects_for(p_company_id uuid, p_known jsonb)
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_object_agg(p.project_id, jsonb_build_object(
           'version', p.version,
           'body', p.body,
           'updated_at', p.updated_at,
           'updated_by', lower(u.email)
         )), '{}'::jsonb)
    from project_docs p
    left join auth.users u on u.id = p.updated_by
   where p.company_id = p_company_id
     and p_known ? p.project_id
     and (p_known->>p.project_id)::bigint <> p.version;
$$;

revoke all on function stale_projects_for(uuid, jsonb) from public;

drop function if exists save_document(uuid, int, jsonb, bigint, jsonb, jsonb);

create function save_document(
  p_company_id       uuid,
  p_schema_version   int,
  p_body             jsonb,
  p_base_version     bigint,
  p_known_projects   jsonb default null,
  p_changed_projects jsonb default null
) returns table (out_version bigint, out_updated_at timestamptz, out_stale_projects jsonb)
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

  -- BEFORE THE SYNC. Afterwards the projects this client just edited have moved past what it knew, and
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
    perform sync_project_docs(p_company_id, p_body, snap, p_known_projects, p_changed_projects);
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

  perform sync_project_docs(p_company_id, p_body, snap, p_known_projects, p_changed_projects);
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
