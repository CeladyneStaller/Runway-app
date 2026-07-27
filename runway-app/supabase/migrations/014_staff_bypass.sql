-- 014_staff_bypass.sql
--
-- Accounts that skip the paywall: your own, support, demos, anyone you comp.
--
-- WHERE THE FLAG LIVES IS THE ENTIRE SECURITY QUESTION. A boolean on `profiles` would be the obvious
-- shape and the wrong one — users can update their own profile row, so it would let anybody grant
-- themselves unlimited free service by editing a field. Any user-writable column that confers
-- privilege is a privilege-escalation bug wearing a convenient disguise.
--
-- So it is a table of its own with RLS ON AND NO POLICIES AT ALL — the same construction as
-- `subscriptions`. RLS denies by default, and with nothing to permit it, no client can read the
-- table, write it, or discover who is on it. `company_entitled` reads it anyway because that function
-- is `security definer`. Rows are added by you, in the SQL editor, on the service role.
--
-- THIS BYPASSES BILLING, NOT ISOLATION. Being staff does not grant sight of anybody else's data:
-- `save_document` still calls `can_edit()` first, so a staff member reaches only companies they are
-- genuinely a member of. What they skip is paying for them. Keep it that way — the moment a staff
-- flag starts short-circuiting `can_edit`, the tenant isolation proved in Phase 0.1 stops being true.
--
-- REASON AND DATE ARE REQUIRED because "we have accounts that do not pay" is a fine answer to a
-- security questionnaire and "we cannot tell you who or why" is not.

create table if not exists staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  reason     text not null,
  granted_at timestamptz not null default now()
);

alter table staff enable row level security;
-- Deliberately NO policies. Not readable, not writable, by anyone holding a user token.

comment on table staff is
  'Accounts exempt from billing. Service-role writes only; there are no RLS policies by design.';

-- ------------------------------------------------------------ entitlement --
-- Same as 009 with one clause added at the front, checked first because it is the cheapest and makes
-- the intent obvious to whoever reads this next.
create or replace function company_entitled(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- staff: exempt from billing for any company they are already a member of
    exists (select 1 from staff s where s.user_id = auth.uid())
    or exists (
      select 1
        from memberships m
        join auth.users u on u.id = m.user_id
        left join subscriptions sub on sub.user_id = m.user_id
       where m.company_id = p_company_id
         and m.role = 'owner'
         and p_company_id in (
           select c.id
             from memberships m2
             join companies c on c.id = m2.company_id
            where m2.user_id = m.user_id
              and m2.role = 'owner'
              and c.deleted_at is null
            order by c.created_at asc
            limit greatest(
              case when sub.status in ('active', 'trialing', 'past_due')
                     or sub.current_period_end > now()
                   then plan_company_allowance(coalesce(sub.plan, 'solo')) else 0 end,
              case when u.created_at > now() - (trial_days() || ' days')::interval
                   then trial_allowance() else 0 end
            )
         )
    );
$$;

revoke all on function company_entitled(uuid) from public;
grant execute on function company_entitled(uuid) to authenticated;

-- `my_plan()` should say so, or a staff account shows "no plan" while writing freely, and the billing
-- UI reads as broken.
create or replace function my_plan()
returns table (plan text, status text, period_end timestamptz,
               trial_ends_at timestamptz, companies_allowed int)
language sql stable security definer set search_path = public as $$
  select
    case when exists (select 1 from staff st where st.user_id = u.id) then 'staff'
         else coalesce(s.plan, 'none') end,
    case when exists (select 1 from staff st where st.user_id = u.id) then 'staff'
         else coalesce(s.status, 'none') end,
    s.current_period_end,
    u.created_at + (trial_days() || ' days')::interval,
    case when exists (select 1 from staff st where st.user_id = u.id) then 1000000
         else greatest(
           case when s.status in ('active', 'trialing', 'past_due')
                  or s.current_period_end > now()
                then plan_company_allowance(coalesce(s.plan, 'solo')) else 0 end,
           case when u.created_at > now() - (trial_days() || ' days')::interval
                then trial_allowance() else 0 end
         ) end
    from auth.users u
    left join subscriptions s on s.user_id = u.id
   where u.id = auth.uid();
$$;

revoke all on function my_plan() from public;
grant execute on function my_plan() to authenticated;
