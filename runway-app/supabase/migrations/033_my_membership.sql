-- Runway — migration 033: what am I, in this company?
--
-- Three facts the app needs about the person looking at it — role, advisor, seat — and no single way to
-- ask. `list_members` carries them but returns everybody, which is a permission the app should not need
-- just to draw its own nav.
--
-- IT IS WHAT MAKES THE TAB GATE REAL. `tabIsVisible` takes `{role, isAdvisor}` and App has been passing
-- neither, so the Scenarios gate has been failing open since it was written — deliberately, because a
-- tab missing while a role loads is worse than one briefly present, but open nonetheless. This is the
-- call that closes it.

create or replace function my_membership(p_company_id uuid)
returns table (role member_role, is_advisor boolean, has_seat boolean, is_owner boolean)
language sql security definer stable set search_path = public as $$
  select m.role,
         is_advisor(auth.uid()),
         holds_seat(p_company_id, auth.uid()),
         m.role = 'owner'
    from memberships m
   where m.company_id = p_company_id and m.user_id = auth.uid();
$$;

revoke all on function my_membership(uuid) from public;
grant execute on function my_membership(uuid) to authenticated;
