-- Runway — migration 003: profiles, and companies as a set rather than a singleton.
--
-- No new tenancy tables: `memberships` was always many-to-many, so belonging to several companies needed
-- no schema change at all — only a way to LIST them, CREATE one, and say which is active.
--
-- Same posture as 002: `authenticated` gets SELECT and nothing else. Every write here is a SECURITY
-- DEFINER function that checks membership itself, so there is no path from the browser to an UPDATE.

-- ------------------------------------------------------------------ profiles --
-- Account-level state, as distinct from company-level state. `password_set_at` exists because Supabase
-- cannot tell you whether a user has a password: a magic-link user and a password user both have an
-- `email` identity, so the provider field does not distinguish them. Without this the account page can
-- only hedge ("set or change your password"); with it, it can say something true.
create table if not exists profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  password_set_at  timestamptz,
  last_company_id  uuid references companies(id) on delete set null,
  created_at       timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists profile_read on profiles;
create policy profile_read on profiles for select using (user_id = auth.uid());

grant select on profiles to authenticated;

create or replace function my_profile()
returns table (password_set_at timestamptz, last_company_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into profiles (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  return query select p.password_set_at, p.last_company_id from profiles p where p.user_id = auth.uid();
end $$;

-- Called by the client AFTER a successful updateUser({password}). The password itself never comes near
-- this function — it only records that one now exists, which is all the UI needs to stop hedging.
create or replace function mark_password_set()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into profiles (user_id, password_set_at) values (auth.uid(), t)
    on conflict (user_id) do update set password_set_at = t;
  return t;
end $$;

-- ----------------------------------------------------------------- companies --
-- Everything the switcher needs in one round trip, including the headline number: a list of names tells
-- you nothing about which company needed your attention.
create or replace function list_companies()
returns table (id uuid, name text, role member_role, created_at timestamptz, has_document boolean)
language sql security definer set search_path = public as $$
  select c.id, c.name, m.role, c.created_at,
         exists (select 1 from documents d where d.company_id = c.id)
    from memberships m
    join companies c on c.id = m.company_id
   where m.user_id = auth.uid()
     and c.deleted_at is null
   order by c.created_at asc;
$$;

-- A new company starts EMPTY — no document row at all, which is what makes the app render a blank model
-- rather than inheriting anything.
create or replace function create_company(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into companies (name) values (coalesce(nullif(btrim(p_name), ''), 'Untitled company'))
    returning id into c;
  insert into memberships (user_id, company_id, role) values (auth.uid(), c, 'owner');
  return c;
end $$;

create or replace function rename_company(p_company_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update companies set name = coalesce(nullif(btrim(p_name), ''), name) where id = p_company_id;
end $$;

-- Remember the active company server-side too. The client keeps its own per-device choice; this is the
-- fallback for a device that has never made one.
create or replace function set_last_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into profiles (user_id, last_company_id) values (auth.uid(), p_company_id)
    on conflict (user_id) do update set last_company_id = p_company_id;
end $$;

-- current_company() now prefers the remembered one, falling back to oldest-first and then to creating
-- the very first company for a brand-new account.
create or replace function current_company()
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.last_company_id into c
    from profiles p
    join memberships m on m.company_id = p.last_company_id and m.user_id = p.user_id
   where p.user_id = auth.uid();
  if c is not null then return c; end if;

  select m.company_id into c
    from memberships m
   where m.user_id = auth.uid()
   order by m.created_at asc
   limit 1;
  if c is not null then return c; end if;

  insert into companies (name) values ('My company') returning id into c;
  insert into memberships (user_id, company_id, role) values (auth.uid(), c, 'owner');
  return c;
end $$;

-- ------------------------------------------------------------------ deletion --
-- Removes the company and everything hanging off it. NOTE this does NOT remove the auth.users row —
-- that needs the service key and therefore an Edge Function. Until that exists the honest wording in the
-- UI is "your data is deleted", not "your account is gone".
create or replace function delete_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships m
                 where m.company_id = p_company_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from companies where id = p_company_id;   -- cascades to memberships, documents, versions
end $$;

grant execute on function my_profile()                     to authenticated;
grant execute on function mark_password_set()              to authenticated;
grant execute on function list_companies()                 to authenticated;
grant execute on function create_company(text)             to authenticated;
grant execute on function rename_company(uuid, text)       to authenticated;
grant execute on function set_last_company(uuid)           to authenticated;
grant execute on function delete_company(uuid)             to authenticated;
