-- Runway — migration 032: `list_members` says who is an advisor and who holds a seat.
--
-- The People panel has to render three facts per row — role, advisor, seat — and could only ask for
-- one. Asking per row would be N round trips for a list; asking once is this.
--
-- REPRODUCED FROM 021 WITH TWO COLUMNS ADDED, and checked against it rather than rebuilt from memory.
-- That habit exists because 022 nearly deleted the staff bypass by rewriting `company_entitled` from
-- 009's version when 014 held the live one, and 030 nearly dropped `stats_optout` and `entitled` from
-- `list_companies` the same way. `create or replace` never warns that it is replacing something that
-- grew.
--
-- `has_seat` IS COMPUTED, NOT STORED, and follows the same seat order as `holds_seat`: owner first,
-- then by join date, advisors and staff neither counted nor limited. A downgrade therefore shows up
-- here as rows losing their seat, with nobody removed — which is exactly what the People panel needs
-- to say.

-- DROPPED FIRST, because the OUT columns change. `create or replace` cannot alter a function's return
-- type — "Row type defined by OUT parameters is different" — and every `returns table` function that
-- gains a column needs this. 030 did it for `list_companies` and this one did not.
drop function if exists list_members(uuid);

create function list_members(p_company_id uuid)
returns table (user_id uuid, email text, role member_role, joined_at timestamptz,
               is_me boolean, is_advisor boolean, has_seat boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- Any member may see who else is in the company. Working alongside somebody you cannot see is worse
  -- than the alternative, and the emails are already known to everybody in a shared company.
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.user_id, lower(u.email), m.role, m.created_at, m.user_id = auth.uid(),
           is_advisor(m.user_id),
           holds_seat(p_company_id, m.user_id)
      from memberships m join auth.users u on u.id = m.user_id
     where m.company_id = p_company_id
     order by role_rank(m.role) desc, u.email;
end $$;

revoke all on function list_members(uuid) from public;
grant execute on function list_members(uuid) to authenticated;

-- --------------------------------------------------------- the portfolio --
/** Every company this advisor is in, for the portfolio panel.
 *
 *  NO FIGURES. Runway is computed by the engine, client-side, from the document — there is no
 *  server-side projection and there should not be one, because a second implementation of the
 *  projection is a second answer to "when do we run out". This returns the list; the browser loads each
 *  document and projects it.
 *
 *  Not restricted to advisors: somebody in several companies gets the same list, which is a reasonable
 *  thing to have. What makes it a PORTFOLIO is the advisor's relationship to them, not this query. */
create or replace function list_advised_companies()
returns table (id uuid, name text, role member_role, joined_at timestamptz, has_document boolean)
language sql security definer stable set search_path = public as $$
  select c.id, c.name, m.role, m.created_at,
         exists (select 1 from documents d where d.company_id = c.id)
    from memberships m
    join companies c on c.id = m.company_id
   where m.user_id = auth.uid()
     and c.deleted_at is null
   order by c.name;
$$;

revoke all on function list_advised_companies() from public;
grant execute on function list_advised_companies() to authenticated;