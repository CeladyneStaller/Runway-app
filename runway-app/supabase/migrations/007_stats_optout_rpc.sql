-- 007_stats_optout_rpc.sql
--
-- 006 added `companies.stats_optout` and the job honours it, but nothing could SET it — the column
-- was reachable only by someone with database access, which is not an opt-out anybody can exercise.
--
-- Exposed as an RPC rather than a table grant so the check stays in one place: only an OWNER of the
-- company may change it. A direct update grant would need a policy saying the same thing, and two
-- statements of one rule drift.

create or replace function set_stats_optout(p_company_id uuid, p_optout boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from memberships
     where company_id = p_company_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update companies set stats_optout = coalesce(p_optout, false) where id = p_company_id;
end $$;

revoke all on function set_stats_optout(uuid, boolean) from public;
grant execute on function set_stats_optout(uuid, boolean) to authenticated;

-- `list_companies` must return the flag, or the UI cannot show its current state. Additive: the
-- existing columns keep their names and order.
-- Postgres cannot change a function's return type in place, so drop and recreate.
drop function if exists list_companies();

create or replace function list_companies()
returns table (id uuid, name text, role member_role, created_at timestamptz,
               has_document boolean, stats_optout boolean)
language sql security definer set search_path = public as $$
  select c.id, c.name, m.role, c.created_at,
         exists (select 1 from documents d where d.company_id = c.id),
         c.stats_optout
    from memberships m
    join companies c on c.id = m.company_id
   where m.user_id = auth.uid()
     and c.deleted_at is null
   order by c.created_at asc;
$$;

revoke all on function list_companies() from public;
grant execute on function list_companies() to authenticated;
