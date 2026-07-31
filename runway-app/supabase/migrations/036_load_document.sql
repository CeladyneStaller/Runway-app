-- Runway — migration 036: loading a document reads its project rows too.
--
-- STAGE 3 OF FOUR: FLIP READS. The only stage that can break anything, which is why it is alone and
-- why the blob is still written — reverting is a one-line change in the client, not a migration.
--
-- ONE RPC, NOT TWO READS, and consistency is the reason rather than tidiness. Fetching the blob and
-- then the project rows as separate requests puts a save in between them: the document from one moment
-- and its projects from another, assembled into a model nobody ever had. One statement is one snapshot
-- of the database, and that is the entire point.
--
-- It also avoids the shape that broke `qbo-sync`: a direct PostgREST read depends on a grant a later
-- `revoke` can quietly remove, and the failure arrives as an error object rather than as an error.
--
-- IT RETURNS PARTS, NOT AN ASSEMBLED DOCUMENT. Assembling here would put the rule in SQL as well as in
-- `state/sections.js`, and two definitions of how a document goes back together is exactly the drift
-- this schema has been bitten by three times. The client assembles, with the function the round-trip
-- tests actually cover.

create or replace function load_document(p_company_id uuid)
returns table (body jsonb, schema_version int, version bigint, updated_at timestamptz,
               projects jsonb, snapshot_id uuid)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select d.body, d.schema_version, d.version, d.updated_at,
           -- ORDERED BY POSITION, always. `projects` is an array in the document and rows come back
           -- in whatever order Postgres likes; losing that order would silently reshuffle somebody's
           -- project list on their next load.
           coalesce((select jsonb_agg(p.body order by p.position, p.project_id)
                       from project_docs p where p.company_id = d.company_id), '[]'::jsonb),
           d.snapshot_id
      from documents d
     where d.company_id = p_company_id;
end $$;

revoke all on function load_document(uuid) from public;
grant execute on function load_document(uuid) to authenticated;
