-- 012_fix_list_companies.sql
--
-- Repairs `list_companies()`, which has been broken since 009 with:
--     column s.company_id does not exist
--
-- 008 redefined it to join `subscriptions` on `company_id`, because at that point a subscription
-- belonged to a COMPANY. 009 rebuilt the whole model per ACCOUNT — the table is keyed by `user_id`
-- now — and I did not update this function to match. The join survived, pointing at a column that no
-- longer exists, and the Account page has been failing ever since.
--
-- THE LESSON, worth stating because it will recur: restructuring a table is not finished when the
-- table is right. Every function that reads it is part of the change. `create table` cannot fail on a
-- stale reference elsewhere, so nothing warns you — the breakage surfaces later, in a UI, as an error
-- that names a column rather than the migration that removed it.
--
-- Plan and status are DELIBERATELY ABSENT here now. They are properties of an account, not a company,
-- so returning them per company row would invite exactly the confusion 009 existed to remove. The
-- billing UI reads `my_plan()` for those; this returns only what is genuinely per company, including
-- `entitled`, which IS per company because the allowance covers a bounded number of them.

drop function if exists list_companies();

create function list_companies()
returns table (id uuid, name text, role member_role, created_at timestamptz,
               has_document boolean, stats_optout boolean, entitled boolean)
language sql security definer set search_path = public as $$
  select c.id, c.name, m.role, c.created_at,
         exists (select 1 from documents d where d.company_id = c.id),
         c.stats_optout,
         company_entitled(c.id)
    from memberships m
    join companies c on c.id = m.company_id
   where m.user_id = auth.uid()
     and c.deleted_at is null
   order by c.created_at asc;
$$;

revoke all on function list_companies() from public;
grant execute on function list_companies() to authenticated;
