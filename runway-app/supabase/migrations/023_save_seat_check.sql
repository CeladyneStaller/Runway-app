-- Runway — migration 023: the seat check reaches the write path.
--
-- 022 added seats, advisors and company-level subscriptions without changing what happens on a save.
-- This turns them on, and it is the migration that can refuse a paying customer, so it is separate and
-- small enough to read in one go.
--
-- `save_document` is reproduced from 016 with ONE block changed — its three permission tests become a
-- single `write_refusal()` call that returns which of them failed. The projection logic, the version
-- coalescing, the retention pruning and the conflict handling are byte-for-byte the same.

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
