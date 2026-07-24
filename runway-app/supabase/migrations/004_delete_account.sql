-- Runway — migration 004: deleting your own data.
--
-- SPLIT ON PURPOSE. This function removes everything the tenancy rules already govern, running as the
-- CALLER (auth.uid()), so the "what may this person delete" logic stays in SQL beside the policies that
-- define ownership. The Edge Function's only privileged act is removing the `auth.users` row, which
-- genuinely requires the service key and cannot be done any other way.
--
-- Keeping the split means the dangerous credential is used for exactly one narrow thing, instead of a
-- server-side function deciding on its own which rows belong to whom.

-- Sole-owned companies are DELETED. Companies with another owner are LEFT ALONE and you simply stop
-- being a member — deleting a company out from under a co-owner because you closed your own account
-- would be destroying someone else's data, which is never what "delete my account" means.
create or replace function delete_my_data()
returns table (companies_deleted int, memberships_removed int)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sole uuid[];
  n_del int := 0;
  n_left int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.company_id), '{}')
    into sole
    from (
      select m.company_id
        from memberships m
       where m.user_id = uid
         and m.role = 'owner'
         and not exists (
           select 1 from memberships other
            where other.company_id = m.company_id
              and other.user_id <> uid
              and other.role = 'owner'
         )
    ) c;

  -- cascades to memberships, documents, document_versions, audit_log
  delete from companies where id = any(sole);
  get diagnostics n_del = row_count;

  delete from memberships where user_id = uid;
  get diagnostics n_left = row_count;

  delete from profiles where user_id = uid;

  companies_deleted := n_del;
  memberships_removed := n_left;
  return next;
end $$;

grant execute on function delete_my_data() to authenticated;
