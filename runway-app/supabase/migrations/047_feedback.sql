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
create policy feedback_insert_any on feedback
  for insert to anon, authenticated
  with check (
    -- A signed-in caller may only file as themselves. An anonymous one files as nobody.
    (user_id is null) or (user_id = auth.uid())
  );

comment on table feedback is
  'Product feedback. Insert-only by design; there is no select policy. Service-role reads only.';
