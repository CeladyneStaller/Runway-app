-- 047_feedback.sql
--
-- Somewhere for people to tell us what is wrong, what is missing, and what they cannot work out.
--
-- ⚠️ THE TABLE MATTERS MORE THAN THE EMAIL IT TRIGGERS. An inbox is where feedback goes to be read
-- once; a table is where "how many people said this?" can be asked six months later, which is the
-- question that decides what gets built. Email cannot answer it.

create table if not exists feedback (
  id           uuid primary key default gen_random_uuid(),

  -- ⚠️ NULLABLE ON PURPOSE. Somebody evaluating the product in a demo who hits a wall is exactly who
  -- we want to hear from, and they have no account. A NOT NULL here would silently discard the
  -- feedback that matters most for conversion.
  user_id      uuid references auth.users(id) on delete set null,
  company_id   uuid references companies(id) on delete set null,

  kind         text not null check (kind in ('broken', 'suggestion', 'question')),
  tab          text,
  subtab       text,

  -- Bounded at the table, not only in the form: the form is not the only way in.
  body         text not null check (length(btrim(body)) between 1 and 4000),

  -- Optional. A report we cannot reply to is still worth having.
  reply_email  text check (reply_email is null or length(reply_email) <= 320),

  -- Tab, plan, app version, browser, viewport, company NAME. Never figures from the model.
  context      jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);

create index if not exists feedback_created_idx on feedback (created_at desc);
create index if not exists feedback_kind_idx    on feedback (kind, created_at desc);

alter table feedback enable row level security;

-- ⚠️ INSERT ONLY, AND NO SELECT POLICY AT ALL — the same shape as `staff`. Feedback often names a
-- competitor, a colleague or a frustration somebody would not want readable by their own teammates;
-- **a table people can write to and nobody can read from is the only version that stays honest.**
-- Reading is done with the service role, outside the app.
-- ⚠️ DROPPED FIRST, BECAUSE `create policy` HAS NO `if not exists`. Every other statement in this file
-- is idempotent and this one was not, so a re-run failed at 42710 with the table already correct —
-- **which makes a migration look broken when it has actually already succeeded.**
-- ⚠️ TABLE-LEVEL GRANTS ARE SEPARATE FROM RLS, and a missing one shows up as the same 42501. Supabase
-- grants these by default for tables created by `postgres` in `public`, but stating them makes the
-- migration correct wherever it is run rather than only where the defaults happen to apply.
-- ⚠️ NOBODY INSERTS DIRECTLY. Every other write in this schema goes through a `security definer`
-- function — there are 127 of them — and I wrote a direct table insert instead, which is why this has
-- spent three rounds on grants and policies. **The pattern was already here and I did not look.**
--
-- A definer function runs as its OWNER, so it does not care which role the caller has, whether the
-- Edge Function received a service key or a publishable one, or what the table grants say. The
-- permission question stops existing rather than being answered.
revoke all on table feedback from anon, authenticated;

-- RLS stays ON with NO policies at all, which is the strongest available statement: nothing reaches
-- this table except through `submit_feedback`, and nothing reads it except the service role.
drop policy if exists feedback_insert_any on feedback;

create or replace function submit_feedback(
  p_kind        text,
  p_body        text,
  p_tab         text default null,
  p_subtab      text default null,
  p_reply_email text default null,
  p_context     jsonb default '{}'::jsonb,
  p_company_id  uuid  default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_kind not in ('broken', 'suggestion', 'question') then
    raise exception 'bad kind';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 4000 then
    raise exception 'bad body';
  end if;

  -- ⚠️ THE USER COMES FROM THE SESSION, NEVER FROM AN ARGUMENT. `auth.uid()` is null for an anonymous
  -- caller, which is exactly what should be recorded — and it cannot be spoofed by somebody editing
  -- the request, because there is no parameter to edit.
  insert into feedback (user_id, company_id, kind, tab, subtab, body, reply_email, context)
  values (auth.uid(), p_company_id, p_kind,
          nullif(btrim(coalesce(p_tab, '')), ''),
          nullif(btrim(coalesce(p_subtab, '')), ''),
          btrim(p_body),
          nullif(btrim(coalesce(p_reply_email, '')), ''),
          coalesce(p_context, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function submit_feedback(text, text, text, text, text, jsonb, uuid)
  to anon, authenticated;


comment on table feedback is
  'Product feedback. Insert-only by design; there is no select policy. Service-role reads only.';
