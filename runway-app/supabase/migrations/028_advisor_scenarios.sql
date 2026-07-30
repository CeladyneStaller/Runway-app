-- Runway — migration 028: advisor scenarios, as a personal layer.
--
-- An advisor is a viewer of the company's document and cannot write it. But modelling "what if we cut
-- two roles" is most of what a fractional CFO is for, so they need somewhere to work.
--
-- WHY A SEPARATE TABLE RATHER THAN A PERMISSION. Scenarios live INSIDE the document and
-- `save_document` writes it as one blob, so "may edit scenarios but not payroll" is not expressible —
-- there is no field-level permission and no way to add one without splitting the document (task 3.8).
-- A personal layer needs no split, is enforceable today, and is arguably the truer model: an advisor's
-- projection is their working, not the company's record, until the company says otherwise.
--
-- SHARING IS AN OFFER, NOT A WRITE. Nothing an advisor does can change the company's document. They
-- offer a scenario; an OWNER accepts or declines; acceptance is then an ordinary save made by the
-- owner, through `save_document`, with their own permissions and their own audit trail. The database
-- holds the offer and its answer, never the merge.

create table if not exists advisor_scenarios (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  -- WHOSE working it is. Cascade on delete: a personal layer belongs to the person, and an account
  -- that goes should not leave its drafts behind in somebody else's company.
  author_id   uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  body        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The offer, and its answer. Null `shared_at` means private working nobody else can see.
  shared_at   timestamptz,
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null,
  decision    text check (decision in ('accepted', 'declined'))
);

create index if not exists advisor_scenarios_company_idx on advisor_scenarios (company_id);
create index if not exists advisor_scenarios_author_idx on advisor_scenarios (author_id);

alter table advisor_scenarios enable row level security;
revoke all on advisor_scenarios from anon, authenticated;

-- ------------------------------------------------------------- the author --
/** Your own scenarios for a company you advise. Private until shared. */
create or replace function my_scenarios(p_company_id uuid)
returns table (id uuid, name text, body jsonb, updated_at timestamptz,
               shared_at timestamptz, decision text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.id, s.name, s.body, s.updated_at, s.shared_at, s.decision
      from advisor_scenarios s
     where s.company_id = p_company_id and s.author_id = auth.uid()
     order by s.updated_at desc;
end $$;

create or replace function save_scenario(p_company_id uuid, p_name text, p_body jsonb,
                                         p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare sid uuid;
begin
  -- MEMBERSHIP, NOT `can_edit`. An advisor is a viewer and `can_edit` is false for them — which is the
  -- whole point. This layer is theirs, so being in the company is the requirement.
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_id is null then
    insert into advisor_scenarios (company_id, author_id, name, body)
    values (p_company_id, auth.uid(), coalesce(nullif(btrim(p_name), ''), 'Untitled scenario'), p_body)
    returning id into sid;
  else
    -- A DECIDED SCENARIO IS A RECORD. Editing one after the owner answered would change what they
    -- agreed to, so a new draft is the only way forward.
    update advisor_scenarios
       set name = coalesce(nullif(btrim(p_name), ''), name), body = p_body, updated_at = now()
     where id = p_id and author_id = auth.uid() and decided_at is null
    returning id into sid;
    if sid is null then raise exception 'not_editable' using errcode = 'P0016'; end if;
  end if;
  return sid;
end $$;

create or replace function delete_scenario(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from advisor_scenarios where id = p_id and author_id = auth.uid();
end $$;

/** Offer it to the company. Nothing is written to their document — this only makes it visible. */
create or replace function share_scenario(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare row advisor_scenarios;
begin
  select * into row from advisor_scenarios where id = p_id and author_id = auth.uid();
  if row.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  update advisor_scenarios
     set shared_at = now(), decided_at = null, decided_by = null, decision = null
   where id = p_id;
  perform log_audit(row.company_id, 'scenario.shared', jsonb_build_object('name', row.name));
end $$;

create or replace function unshare_scenario(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update advisor_scenarios set shared_at = null
   where id = p_id and author_id = auth.uid() and decided_at is null;
end $$;

-- -------------------------------------------------------------- the owner --
/** Scenarios offered to this company and not yet answered. Owners only.
 *
 *  Deciding what enters the company's model is an ownership question, not an administrative one — the
 *  same reason deleting the company is owner-only. */
create or replace function offered_scenarios(p_company_id uuid)
returns table (id uuid, name text, body jsonb, shared_at timestamptz, author_email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if coalesce(my_role(p_company_id), 'viewer') <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.id, s.name, s.body, s.shared_at, lower(u.email)
      from advisor_scenarios s join auth.users u on u.id = s.author_id
     where s.company_id = p_company_id and s.shared_at is not null and s.decided_at is null
     order by s.shared_at asc;
end $$;

/** Accept or decline. ACCEPTING WRITES NOTHING to the document: it records the answer, and the owner's
 *  client then adds the scenario through `save_document` like any other edit — with their permissions,
 *  their version check and their audit row. An import that bypassed the normal write path would be a
 *  second way into the document, and this schema has spent a lot of effort having exactly one. */
create or replace function decide_scenario(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare row advisor_scenarios;
begin
  select * into row from advisor_scenarios where id = p_id;
  if row.id is null then return; end if;
  if coalesce(my_role(row.company_id), 'viewer') <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update advisor_scenarios
     set decided_at = now(), decided_by = auth.uid(),
         decision = case when p_accept then 'accepted' else 'declined' end
   where id = p_id and decided_at is null;
  perform log_audit(row.company_id,
                    case when p_accept then 'scenario.accepted' else 'scenario.declined' end,
                    jsonb_build_object('name', row.name, 'author', row.author_id));
end $$;

revoke all on function my_scenarios(uuid)                         from public;
revoke all on function save_scenario(uuid, text, jsonb, uuid)     from public;
revoke all on function delete_scenario(uuid)                      from public;
revoke all on function share_scenario(uuid)                       from public;
revoke all on function unshare_scenario(uuid)                     from public;
revoke all on function offered_scenarios(uuid)                    from public;
revoke all on function decide_scenario(uuid, boolean)             from public;

grant execute on function my_scenarios(uuid)                      to authenticated;
grant execute on function save_scenario(uuid, text, jsonb, uuid)  to authenticated;
grant execute on function delete_scenario(uuid)                   to authenticated;
grant execute on function share_scenario(uuid)                    to authenticated;
grant execute on function unshare_scenario(uuid)                  to authenticated;
grant execute on function offered_scenarios(uuid)                 to authenticated;
grant execute on function decide_scenario(uuid, boolean)          to authenticated;
