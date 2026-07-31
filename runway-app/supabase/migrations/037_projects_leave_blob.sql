-- Runway — migration 037: `projects` leaves the blob.
--
-- STAGE 4 OF FOUR, AND THE LAST. `documents.body` is stored WITHOUT its `projects` array; the rows are
-- now the only copy. Reads have come from the rows since 036, so nothing changes about what the app
-- sees — what changes is that there is no longer a second copy to disagree with.
--
-- WHAT THIS DOES TO HISTORY, which is worth being explicit about because it is not reversible by
-- re-running an earlier migration. From here a `document_versions` row is a document with no projects.
-- Reconstructing a whole one means taking the version row AND the `project_versions` rows carrying the
-- same `snapshot_id`. That is exactly what the snapshot was designed for in 034, and it stops being
-- theoretical today. There is no restore path built yet; when one is, this is its shape.
--
-- THE STAGE-3 FALLBACK STAYS. `assembleFromStorage` still prefers rows and falls back to the blob when
-- rows are empty, and that is not dead code yet: a company that has not saved since this migration
-- still has `projects` in its blob, and will until it next writes. The fallback retires when
-- `documents_still_carrying_projects()` returns zero — not before.
--
-- Reproduced from 035 with the two stores changed and nothing else.

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
    -- THE ROWS GET THE WHOLE BODY, the blob gets it stripped. Order matters only in that `sync` must
    -- be handed the projects before they are removed — which is why it takes `p_body` and not the
    -- column.
    insert into documents (company_id, schema_version, body, updated_by, snapshot_id)
      values (p_company_id, p_schema_version, p_body - 'projects', auth.uid(), snap)
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
     set snapshot_id = snap, body = p_body - 'projects', schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning version, updated_at into out_version, out_updated_at;
  perform sync_project_docs(p_company_id, p_body, snap);
  return next;
end $$;

-- ---------------------------------------------------- migration progress --
/** How many documents still carry `projects` in their blob.
 *
 *  THE GATE FOR RETIRING THE STAGE-3 FALLBACK. Every document loses its copy the next time it is
 *  saved, so this counts down on its own. While it is above zero the fallback is protecting real
 *  companies; when it reaches zero the fallback can never fire and should be deleted rather than left
 *  looking like a safety net. */
create or replace function documents_still_carrying_projects()
returns table (companies int, oldest_untouched timestamptz)
language sql security definer stable set search_path = public as $$
  select count(*)::int, min(d.updated_at)
    from documents d
   where jsonb_array_length(coalesce(d.body->'projects', '[]'::jsonb)) > 0;
$$;

revoke all on function documents_still_carrying_projects() from public;
grant execute on function documents_still_carrying_projects() to service_role;

-- `verify_project_split` compared the blob against the rows, which was the right check while both were
-- written and is a FALSE ALARM now: a migrated document legitimately has no projects in its blob. It
-- now says which state each document is in rather than reporting the expected outcome as a mismatch.
drop function if exists verify_project_split();

create function verify_project_split()
returns table (company_id uuid, state text, in_blob int, in_rows int,
               order_matches boolean, ids_match boolean)
language sql security definer stable set search_path = public as $$
  select d.company_id,
         case when jsonb_array_length(coalesce(d.body->'projects','[]'::jsonb)) > 0
              then 'dual'          -- not yet saved since 037; both copies exist and must agree
              else 'migrated'      -- the rows are the only copy, so there is nothing to compare
         end,
         coalesce(jsonb_array_length(d.body->'projects'), 0),
         (select count(*)::int from project_docs p where p.company_id = d.company_id),
         (select coalesce(array_agg(x.id order by x.ord), '{}')
            from (select value->>'id' as id, ordinality - 1 as ord
                    from jsonb_array_elements(coalesce(d.body->'projects','[]'::jsonb))
                         with ordinality) x
           where x.id is not null)
         =
         (select coalesce(array_agg(p.project_id order by p.position), '{}')
            from project_docs p where p.company_id = d.company_id)
         or jsonb_array_length(coalesce(d.body->'projects','[]'::jsonb)) = 0,
         (select coalesce(array_agg(x.id order by x.id), '{}')
            from (select value->>'id' as id
                    from jsonb_array_elements(coalesce(d.body->'projects','[]'::jsonb))) x
           where x.id is not null)
         =
         (select coalesce(array_agg(p.project_id order by p.project_id), '{}')
            from project_docs p where p.company_id = d.company_id)
         or jsonb_array_length(coalesce(d.body->'projects','[]'::jsonb)) = 0
    from documents d
   order by 1;
$$;

revoke all on function verify_project_split() from public;
grant execute on function verify_project_split() to service_role;
