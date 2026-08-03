-- Runway — migration 043: the owner focuses an advisor on the tabs they work on.
--
-- A THIRD LAYER OF TAB VISIBILITY, and the three answer different questions:
--
--   company    030, `companies.hidden_tabs`  the owner: "this company does not use Investment"
--   personal   `state/tabprefs.js`           each member: "I never look at Sales"
--   advisor    THIS                          the owner: "Dana is here for the grants, not the payroll"
--
-- Per ADVISOR, not per role. Two advisors on one company are usually there for different reasons, and
-- the tax person does not need the cap table.
--
-- ⚠️ THIS IS FOCUS, NOT CONFIDENTIALITY, AND THE DIFFERENCE IS THE WHOLE POINT.
--
-- `load_document` returns the entire model as one blob. An advisor's browser receives every salary
-- whatever is set here — hiding the Payroll TAB hides the tab, not the data, which is one dev-tools
-- panel away. Nothing in this migration changes that.
--
-- So every label on top of this column says "what they work on", never "what they can access". A user
-- who believes salaries are hidden will never ask for the feature that hides them, and that is a worse
-- outcome than not shipping this at all. The real thing needs `employees` out of the blob and a
-- role-aware `load_document`; see LAYER-2-advisor-confidentiality.md.

alter table memberships
  add column if not exists focus_tabs text[] null;

comment on column memberships.focus_tabs is
  'Tabs an advisor is focused on. NULL means everything the company shows. This is presentation only — '
  'the document is still delivered whole. See LAYER-2-advisor-confidentiality.md for enforcement.';

/** Focus an advisor on a set of tabs. Owner only, matching `set_company_tabs` — the same bar as
 *  deleting the company, because all of it changes what the company IS rather than what it says.
 *
 *  NULL clears the focus. An empty array does NOT mean "no tabs": an advisor with nothing to look at is
 *  a removed advisor, and creating a ghost membership is worse than refusing the call. */
create or replace function set_advisor_focus(p_company_id uuid, p_user_id uuid, p_tabs text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  was text[];
  is_adv boolean;
  cleaned text[];
begin
  if coalesce(my_role(p_company_id), 'viewer') <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select m.focus_tabs, coalesce(m.is_advisor, false)
    into was, is_adv
    from memberships m
   where m.company_id = p_company_id and m.user_id = p_user_id;

  if not found then
    raise exception 'not a member of this company' using errcode = '22023';
  end if;

  -- ONLY ADVISORS. A member holds a seat and can edit; focusing them would be a permission system
  -- pretending to be a preference, and the honest control for a member is their role.
  if not is_adv then
    raise exception 'focus applies to advisors only' using errcode = '22023';
  end if;

  if p_tabs is null then
    cleaned := null;
  else
    -- The dashboard is always on, exactly as in 030: it is the fallback when the current view
    -- disappears, so an advisor focused away from it would land on nothing.
    cleaned := array(select distinct x from unnest(p_tabs || array['dash']) x where x is not null and x <> '');
    if array_length(cleaned, 1) is null or array_length(cleaned, 1) <= 1 then
      raise exception 'an advisor with no tabs is a removed advisor' using errcode = '22023';
    end if;
  end if;

  update memberships
     set focus_tabs = cleaned
   where company_id = p_company_id and user_id = p_user_id;

  perform log_audit(p_company_id, 'advisor.focus',
                    jsonb_build_object('user_id', p_user_id, 'from', was, 'to', cleaned));
end $$;

/** What THIS caller may see in THIS company, as one answer.
 *
 *  ONE FUNCTION RATHER THAN TWO, because the client needs the intersection and computing it in the
 *  browser means two round trips and a rule that can drift. The company's own hidden tabs are a FLOOR:
 *  focus can take away further, never add back — an advisor focused onto a tab the company has turned
 *  off still does not see it.
 */
create or replace function my_visible_tabs(p_company_id uuid)
returns table (hidden text[], focus text[], focused_by_owner boolean)
language sql security definer set search_path = public as $$
  select
    coalesce(c.hidden_tabs, '{}')                                  as hidden,
    m.focus_tabs                                                   as focus,
    (m.focus_tabs is not null)                                     as focused_by_owner
  from companies c
  join memberships m on m.company_id = c.id
  where c.id = p_company_id and m.user_id = auth.uid();
$$;

/** For the owner's People screen: who is focused, and onto what. */
create or replace function advisor_focus(p_company_id uuid)
returns table (user_id uuid, email text, focus_tabs text[])
language sql security definer set search_path = public as $$
  select m.user_id, u.email::text, m.focus_tabs
  from memberships m
  join auth.users u on u.id = m.user_id
  where m.company_id = p_company_id
    and coalesce(m.is_advisor, false)
    and coalesce(my_role(p_company_id), 'viewer') = 'owner';
$$;

revoke all on function set_advisor_focus(uuid, uuid, text[]) from public;
revoke all on function my_visible_tabs(uuid)                 from public;
revoke all on function advisor_focus(uuid)                   from public;
grant execute on function set_advisor_focus(uuid, uuid, text[]) to authenticated;
grant execute on function my_visible_tabs(uuid)                 to authenticated;
grant execute on function advisor_focus(uuid)                   to authenticated;
