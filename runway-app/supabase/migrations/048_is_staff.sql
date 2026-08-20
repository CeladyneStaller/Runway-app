-- 048_is_staff.sql
--
-- "Is the caller Waterline staff?", asked by the hub rather than by a shared secret.
--
-- ⚠️ THE `staff` TABLE WAS BUILT AS A BILLING EXEMPTION, NOT A PERMISSION SYSTEM. Its own comment says
-- "Accounts exempt from billing". Using it as an authorisation boundary is a repurposing, and it is
-- worth doing deliberately rather than by accident: **the day somebody is added to `staff` to comp
-- their account, they also get the hub.** That is acceptable while both sets are the same people and
-- becomes a problem the moment they are not.
--
-- If they diverge, the fix is a column here rather than a second table — `staff.hub boolean` — so the
-- two answers stay in one place.

create or replace function is_staff(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- ⚠️ `auth.uid()` BY DEFAULT AND NO WAY TO ASK ABOUT SOMEBODY ELSE MEANINGFULLY: the parameter exists
  -- so the service role can check a specific user server-side, and an ordinary caller passing another
  -- id learns only what is already true of them, because RLS never enters into it — the answer is a
  -- boolean about membership of a table nobody can read.
  select exists (select 1 from staff s where s.user_id = coalesce(p_user_id, auth.uid()));
$$;

revoke all on function is_staff(uuid) from public;
grant execute on function is_staff(uuid) to authenticated;

comment on function is_staff(uuid) is
  'True when the account is in `staff`. Used by the hub to gate access; see 048_is_staff.sql.';
