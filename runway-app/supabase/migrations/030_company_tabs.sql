-- Runway — migration 030: the owner decides which tabs this company uses.
--
-- NOT IN THE DOCUMENT, and that is the whole reason this is a migration rather than a settings field.
-- An EDITOR can write the document; a setting an editor can change is not an owner's setting. It also
-- is not model data — it changes no number and must not travel with an export.
--
-- NOT THE SAME THING AS `state/tabprefs.js`, which stores per-device decluttering and says in its own
-- header that "one person decluttering their own screen must not rearrange somebody else's". Both
-- survive, answering different questions:
--
--   company   the owner: "this company does not use Investment"      -> nobody sees it
--   personal  each member: "I never look at Sales"                   -> only they stop seeing it
--
-- Neither overrides the other. A member cannot un-hide what the owner turned off, and the owner cannot
-- force a tab back onto somebody's own screen.

alter table companies add column if not exists hidden_tabs text[] not null default '{}';

/** Set which tabs this company does not use. Owner only — the same bar as deleting the company and
 *  deciding advisor scenarios, because all three change what the company IS rather than what it says. */
create or replace function set_company_tabs(p_company_id uuid, p_hidden text[])
returns void language plpgsql security definer set search_path = public as $$
declare was text[];
begin
  if coalesce(my_role(p_company_id), 'viewer') <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- THE DASHBOARD CANNOT BE HIDDEN. It is the fallback whenever the current view disappears, so a
  -- company that hid it would have members landing on nothing. `tabprefs.js` enforces the same rule for
  -- the personal layer; this is the server's copy, because a client-side guarantee is a convenience.
  select hidden_tabs into was from companies where id = p_company_id;
  update companies
     set hidden_tabs = coalesce(array(select distinct x from unnest(p_hidden) x where x <> 'dash'), '{}')
   where id = p_company_id;

  perform log_audit(p_company_id, 'company.tabs',
                    jsonb_build_object('from', was, 'to', p_hidden));
end $$;

/** What this company hides. Readable by every member, because the nav has to draw for all of them. */
create or replace function company_tabs(p_company_id uuid)
returns text[] language sql security definer stable set search_path = public as $$
  select case when is_member(p_company_id)
              then coalesce((select c.hidden_tabs from companies c where c.id = p_company_id), '{}')
              else '{}' end;
$$;

revoke all on function set_company_tabs(uuid, text[]) from public;
revoke all on function company_tabs(uuid)             from public;
grant execute on function set_company_tabs(uuid, text[]) to authenticated;
grant execute on function company_tabs(uuid)             to authenticated;

-- Carried on the company list so the switcher and the account page already have it, rather than each
-- screen asking separately.
--
-- REPRODUCED FROM 012 WITH ONE COLUMN ADDED. 012 had already extended this with `stats_optout` and
-- `entitled`, and rebuilding it from an earlier version would have silently dropped both — which is
-- exactly what nearly happened to the staff bypass in `company_entitled`, where 014 held the live
-- definition and 022 rewrote it from 009. `create or replace` never warns that it is replacing
-- something that grew.
drop function if exists list_companies();

create function list_companies()
returns table (id uuid, name text, role member_role, created_at timestamptz,
               has_document boolean, stats_optout boolean, entitled boolean, hidden_tabs text[])
language sql security definer set search_path = public as $$
  select c.id, c.name, m.role, c.created_at,
         exists (select 1 from documents d where d.company_id = c.id),
         c.stats_optout,
         company_entitled(c.id),
         c.hidden_tabs
    from memberships m
    join companies c on c.id = m.company_id
   where m.user_id = auth.uid()
     and c.deleted_at is null
   order by c.created_at asc;
$$;

revoke all on function list_companies() from public;
grant execute on function list_companies() to authenticated;
