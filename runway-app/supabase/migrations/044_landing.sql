-- Runway — migration 044: where somebody lands when they sign in.
--
-- ON `profiles`, BESIDE `last_company_id`, because a landing choice follows the PERSON. Putting it in
-- `tabprefs` (localStorage) would mean signing in on a laptop and a phone to two different screens,
-- and the thing being chosen is "where my day starts" rather than "how this device looks".
--
-- STORED AS TEXT, holding either a company uuid or the literal 'portfolio'. Not a uuid column with a
-- separate boolean: two fields to express one choice is two fields that can disagree, and the
-- disagreement would be silent.
--
-- ⚠️ NOT A PERMISSION. `engine/landing.js` refuses a stored 'portfolio' for anybody without the advisor
-- flag, so losing the flag cannot leave somebody on a screen they may no longer have. This column
-- records a wish; what is allowed is decided when it is read.

alter table profiles
  add column if not exists landing text null;

comment on column profiles.landing is
  'Where this person lands: a company uuid, or the literal ''portfolio''. NULL means the default rule '
  'in engine/landing.js — owned company first, then oldest, and the portfolio for advisors.';

/** Set it. Anybody may set their own; there is nothing here another person may change.
 *
 *  A COMPANY THEY ARE NOT IN IS REFUSED. Storing one would produce a landing that silently falls back
 *  forever, and the person would have no way to tell their setting was never taken. */
create or replace function set_landing(p_landing text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_landing is null or p_landing = '' then
    update profiles set landing = null where user_id = auth.uid();
    return;
  end if;

  if p_landing = 'portfolio' then
    -- Stored even for a non-advisor. Whether it is HONOURED is decided on read, and refusing to store
    -- it here would lose the choice of somebody whose advisor plan lapses and later resumes.
    update profiles set landing = 'portfolio' where user_id = auth.uid();
    return;
  end if;

  if not exists (
    select 1 from memberships m
     where m.user_id = auth.uid() and m.company_id = p_landing::uuid
  ) then
    raise exception 'not a member of that company' using errcode = '22023';
  end if;

  insert into profiles (user_id, landing) values (auth.uid(), p_landing)
  on conflict (user_id) do update set landing = excluded.landing;
end $$;

revoke all on function set_landing(text) from public;
grant execute on function set_landing(text) to authenticated;
