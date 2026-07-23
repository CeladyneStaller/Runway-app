-- Runway — migration 001: tenancy, documents, version history, audit, RLS.
--
-- Multi-company from the first migration. `company_id` is one column today and a migration under load
-- later, so it lands now even while every company has exactly one member.
--
-- RLS is enabled here, not retrofitted. Tenant isolation is a DATABASE property: an application bug
-- must not be able to leak Company A's numbers to Company B.

-- ---------------------------------------------------------------- tenancy --
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz                       -- soft delete; hard purge is a scheduled job
);

do $$ begin
  create type member_role as enum ('owner', 'admin', 'editor', 'viewer');
exception when duplicate_object then null;
end $$;

create table if not exists memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  role        member_role not null default 'editor',
  created_at  timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index if not exists memberships_company_idx on memberships (company_id);

-- --------------------------------------------------------------- document --
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  schema_version int    not null,
  body           jsonb  not null,
  version        bigint not null default 1,      -- optimistic concurrency token
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  unique (company_id)                             -- one document per company for now
);

-- Every write keeps its predecessor. With no local copy on the client, THIS is the safety net.
create table if not exists document_versions (
  id             bigserial primary key,
  document_id    uuid not null references documents(id) on delete cascade,
  schema_version int    not null,
  body           jsonb  not null,
  version        bigint not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create index if not exists document_versions_doc_idx on document_versions (document_id, version desc);

-- ------------------------------------------------------------------ audit --
create table if not exists audit_log (
  id          bigserial primary key,
  company_id  uuid references companies(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,           -- 'doc.save', 'member.invite', 'qbo.connect', ...
  detail      jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_company_idx on audit_log (company_id, created_at desc);

-- -------------------------------------------------------- membership helpers --
create or replace function is_member(c uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.company_id = c and m.user_id = auth.uid());
$$;

create or replace function can_edit(c uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.company_id = c and m.user_id = auth.uid()
                   and m.role in ('owner','admin','editor'));
$$;

-- -------------------------------------------------------------------- RLS --
alter table companies         enable row level security;
alter table memberships       enable row level security;
alter table documents         enable row level security;
alter table document_versions enable row level security;
alter table audit_log         enable row level security;

drop policy if exists company_read on companies;
create policy company_read on companies for select using (is_member(id));

drop policy if exists membership_read on memberships;
create policy membership_read on memberships for select using (is_member(company_id));

drop policy if exists doc_read on documents;
create policy doc_read on documents for select using (is_member(company_id));

drop policy if exists doc_new on documents;
create policy doc_new on documents for insert with check (can_edit(company_id));

drop policy if exists doc_write on documents;
create policy doc_write on documents for update using (can_edit(company_id))
                                            with check (can_edit(company_id));

drop policy if exists ver_read on document_versions;
create policy ver_read on document_versions for select
  using (exists (select 1 from documents d
                 where d.id = document_id and is_member(d.company_id)));

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (is_member(company_id));

-- ------------------------------------------------------------ the one write --
-- Optimistic concurrency, schema-skew refusal, and version retention in a single call. The client
-- never issues a bare UPDATE, so there is no path that can blind-write over a newer document.
create or replace function save_document(
  p_company_id     uuid,
  p_schema_version int,
  p_body           jsonb,
  p_base_version   bigint
) returns table (out_version bigint, out_updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare cur documents%rowtype;
begin
  if not can_edit(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into cur from documents where company_id = p_company_id for update;

  -- first write for this company
  if cur.id is null then
    insert into documents (company_id, schema_version, body, updated_by)
      values (p_company_id, p_schema_version, p_body, auth.uid())
      returning version, updated_at into out_version, out_updated_at;
    return next;
    return;
  end if;

  -- a client older than the stored document must never write: it would silently drop fields it
  -- does not understand.
  if p_schema_version < cur.schema_version then
    raise exception 'stale_client' using errcode = 'P0001';
  end if;

  -- somebody else moved it since this client loaded
  if cur.version <> p_base_version then
    raise exception 'conflict' using errcode = 'P0002';
  end if;

  insert into document_versions (document_id, schema_version, body, version, created_by)
    values (cur.id, cur.schema_version, cur.body, cur.version, auth.uid());

  update documents
     set body = p_body, schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning version, updated_at into out_version, out_updated_at;
  return next;
end $$;

-- --------------------------------------------------- sign-up bootstrapping --
-- A new user gets a company and an owner membership atomically, so there is never an account
-- without somewhere to put a document.
create or replace function bootstrap_company(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into companies (name) values (coalesce(nullif(p_name, ''), 'My company')) returning id into c;
  insert into memberships (user_id, company_id, role) values (auth.uid(), c, 'owner');
  return c;
end $$;
