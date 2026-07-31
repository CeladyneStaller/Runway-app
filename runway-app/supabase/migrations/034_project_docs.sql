-- Runway — migration 034: projects get their own rows, and every save gets a snapshot.
--
-- STAGE 1 OF FOUR, AND ENTIRELY ADDITIVE. Nothing reads these tables. `save_document` is untouched, the
-- blob is still the only source of truth, and reverting is `drop table`. The three stages after this
-- are: dual-write, flip reads, stop writing `projects` into the blob.
--
-- WHY PROJECTS AND NOT THE WHOLE DOCUMENT. Measured: `projects` is 44% of a 16 KB demo document and a
-- project averages 1 KB, so one row each is the right grain and there is nothing worth splitting inside
-- one. It is also the only part of the model with entity identity — POs reference a project by id,
-- spend lines carry `projectId`, and `codeMap`/`customerMap` resolve TO a project id. Four foreign keys
-- already live inside the blob with integrity maintained by nothing. Everything else in the document is
-- a list nobody addresses individually, and lists are what jsonb is for.
--
-- WHY SNAPSHOTS NOW, WITH ONLY TWO KINDS OF ROW. "Put it back to yesterday" is one row today. After this
-- it is a blob plus N project rows that have to be restored to a CONSISTENT MOMENT, and after a later
-- section split it is more again. Retrofitting that grouping across three kinds of row is meaningfully
-- worse than defining it while there are two, so every write stamps one `snapshot_id` and restore
-- becomes "every row carrying the last snapshot before that time" — a rule that does not change however
-- many parts exist later.

-- ------------------------------------------------------------- snapshots --
-- One row per save. Exists so "list the restore points" is a query rather than a DISTINCT scan over
-- version history, and so a snapshot can carry who made it without repeating that on every row.
create table if not exists document_snapshots (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  -- Free text, set by whatever caused the write: 'save', 'import', 'migration backfill'. Not an enum:
  -- the set will grow and a restore list reads better with a reason than without one.
  reason      text
);

create index if not exists document_snapshots_company_idx
  on document_snapshots (company_id, created_at desc);

alter table document_snapshots enable row level security;
create policy snap_read on document_snapshots for select using (is_member(company_id));
grant select on document_snapshots to authenticated;

-- The snapshot each row currently belongs to, so "what is live right now" is answerable without
-- reading history. Nullable: everything written before this migration has no snapshot, and inventing
-- one for it would be a claim about a moment nobody recorded.
alter table documents         add column if not exists snapshot_id uuid references document_snapshots(id);
alter table document_versions add column if not exists snapshot_id uuid references document_snapshots(id);

-- ---------------------------------------------------------- project rows --
create table if not exists project_docs (
  company_id  uuid not null references companies(id) on delete cascade,
  -- The project's own id from inside the document. NOT generated here: `pos[].projectId`,
  -- `lines[].projectId` and both maps already point at it, so minting a new one would orphan all four.
  project_id  text not null,
  body        jsonb not null,
  -- NOT OPTIONAL. `projects` is an ARRAY and its order is whatever the array says; rows come back
  -- unordered without this, and losing project order is a visible regression nobody will thank us for.
  position    int not null default 0,
  version     bigint not null default 1,
  snapshot_id uuid references document_snapshots(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (company_id, project_id)
);

create index if not exists project_docs_company_pos_idx on project_docs (company_id, position);

alter table project_docs enable row level security;
-- Mirrors `documents` exactly: members read, editors write. The seat and entitlement checks live in the
-- write RPC, as they do for `save_document` — a policy cannot say "and the plan is paid for".
create policy proj_read  on project_docs for select using (is_member(company_id));
create policy proj_new   on project_docs for insert with check (can_edit(company_id));
create policy proj_write on project_docs for update using (can_edit(company_id))
                                          with check (can_edit(company_id));
create policy proj_del   on project_docs for delete using (can_edit(company_id));
grant select, insert, update, delete on project_docs to authenticated;

-- ------------------------------------------------------ project history --
-- SEPARATE FROM `document_versions` on purpose. Mixing them would make "keep the last 20" ambiguous —
-- twenty per document would evict project history the moment a company had a few — and it would give
-- one table two meanings for `version`. Two tables, each with one meaning, joined by `snapshot_id`.
create table if not exists project_versions (
  company_id  uuid not null references companies(id) on delete cascade,
  project_id  text not null,
  version     bigint not null,
  body        jsonb not null,
  position    int not null default 0,
  snapshot_id uuid references document_snapshots(id),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  primary key (company_id, project_id, version)
);

create index if not exists project_versions_snapshot_idx on project_versions (snapshot_id);

alter table project_versions enable row level security;
create policy projver_read on project_versions for select using (is_member(company_id));
grant select on project_versions to authenticated;

-- ---------------------------------------------------------- the backfill --
-- Every existing document's `projects` array becomes rows, under one snapshot per company so the
-- restore rule has something coherent to point at from the very first moment.
--
-- IDEMPOTENT. `on conflict do nothing` and a guard on companies already backfilled, because a migration
-- that has to be re-run after a partial failure is the normal case, not the exception.
do $$
declare d record; snap uuid; p jsonb; i int;
begin
  for d in
    select dd.company_id, dd.body
      from documents dd
     where jsonb_typeof(dd.body->'projects') = 'array'
       and jsonb_array_length(dd.body->'projects') > 0
       and not exists (select 1 from project_docs pd where pd.company_id = dd.company_id)
  loop
    insert into document_snapshots (company_id, reason)
    values (d.company_id, 'migration backfill 034') returning id into snap;

    i := 0;
    for p in select value from jsonb_array_elements(d.body->'projects') loop
      -- A project with no id cannot be addressed, and addressing them is the entire point. Skipped
      -- rather than assigned one: the blob is still the source of truth at this stage, so a skipped
      -- row is visible in the verification below rather than silently divergent.
      if coalesce(p->>'id', '') <> '' then
        insert into project_docs (company_id, project_id, body, position, snapshot_id)
        values (d.company_id, p->>'id', p, i, snap)
        on conflict (company_id, project_id) do nothing;
      end if;
      i := i + 1;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------- verifying it --
/** Does every document's `projects` array match its rows, in the same order?
 *
 *  THE GATE FOR STAGE 2. Nothing reads `project_docs` yet, so the only way this migration can be wrong
 *  is silently — and the only check that means anything is comparing what was written against what it
 *  was written from. Service role: it reads every company. */
create or replace function verify_project_split()
returns table (company_id uuid, in_blob int, in_rows int, order_matches boolean, ids_match boolean)
language sql security definer stable set search_path = public as $$
  select d.company_id,
         coalesce(jsonb_array_length(d.body->'projects'), 0),
         (select count(*)::int from project_docs p where p.company_id = d.company_id),
         (select coalesce(array_agg(x.id order by x.ord), '{}')
            from (select value->>'id' as id, ordinality - 1 as ord
                    from jsonb_array_elements(coalesce(d.body->'projects','[]'::jsonb))
                         with ordinality) x
           where x.id is not null)
         =
         (select coalesce(array_agg(p.project_id order by p.position), '{}')
            from project_docs p where p.company_id = d.company_id),
         (select coalesce(array_agg(x.id order by x.id), '{}')
            from (select value->>'id' as id
                    from jsonb_array_elements(coalesce(d.body->'projects','[]'::jsonb))) x
           where x.id is not null)
         =
         (select coalesce(array_agg(p.project_id order by p.project_id), '{}')
            from project_docs p where p.company_id = d.company_id)
    from documents d
   order by 1;
$$;

revoke all on function verify_project_split() from public;
grant execute on function verify_project_split() to service_role;
