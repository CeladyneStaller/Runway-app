-- Runway — migration 017: QuickBooks connections, and custody of the token behind them.
--
-- PHASE 1 STORED NUMBERS PEOPLE TYPED. THIS STORES A CREDENTIAL TO THEIR ACCOUNTING SYSTEM. That is
-- the escalation §3 of BACKEND-PLAN.md warns about, and it changes what "a leaked read of one table"
-- costs: not a company's figures, but standing access to their books until somebody notices.
--
-- THE TOKEN IS NOT IN THIS TABLE. Not encrypted in it — not in it. The row holds a `secret_id`
-- pointing into Supabase Vault, which stores the value encrypted on disk under a per-project key held
-- outside SQL entirely, and preserved through backups and replication. So `select * from
-- qbo_connections` yields a uuid and no way to use it.
--
-- NO ACCESS TOKEN IS STORED EITHER. It lives 60 minutes, refreshing is one request, and the refresh
-- token rotates about daily regardless — so keeping it would add a second secret to protect in
-- exchange for saving an occasional round trip. Stage 3 measured that round trip at well under a
-- second.
--
-- WATCH: A `vault.create_secret(...)` call carrying a LITERAL token can put that token somewhere the
-- Vault does not reach. Supabase's default is `log_statement = 'ddl'`, so an ordinary call is not
-- logged — but pgAudit is preloaded and a broad scope would capture function calls and their
-- parameters, and the dashboard SQL Editor keeps its own query history that no Postgres setting
-- governs. Hand-typing a real token into the editor is the realistic leak.
--
-- Every write below therefore takes the token as a PARAMETER. PostgREST sends RPC arguments in the
-- request body and issues a parameterized query, so the value never appears in statement text at all.
-- Verify with `show log_statement;` (expect ddl) and `show "pgaudit.log";` (expect none).

create table if not exists qbo_connections (
  -- ONE CONNECTION PER COMPANY, enforced by making the company the key. Two realms feeding one
  -- document is not a feature anybody asked for and is a very confusing way to double your numbers.
  company_id          uuid primary key references companies(id) on delete cascade,
  realm_id            text not null,
  qbo_company_name    text,                       -- shown back, so a mis-paired realm is visible
  secret_id           uuid not null,              -- -> vault.secrets, the refresh token

  -- THE TWO CLOCKS, kept separately because they mean different things and fail differently.
  -- `authorized_at` is when the customer consented and is what the FIVE-YEAR ceiling counts from;
  -- rotation does not reset it, so this is the field the reconnect banner is computed from.
  authorized_at       timestamptz not null default now(),
  -- `refresh_expires_at` is the ~100-day IDLE clock, reset by each rotation. A monthly keep-alive
  -- holds it off forever; nothing holds off the other one.
  refresh_expires_at  timestamptz,

  -- active | needs_reauth | revoked. `needs_reauth` is NOT a deletion: the realm pairing and the
  -- saved column profile have to survive, or reconnecting means mapping every account again.
  status              text not null default 'active',
  last_sync_at        timestamptz,
  last_error          text,
  last_error_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists qbo_connections_status_idx on qbo_connections (status);

-- ------------------------------------------------------------ vault hygiene --
-- Deleting a company cascades this row away; without this the SECRET would outlive it, leaving a
-- usable credential to somebody's books in a table nobody is looking at any more.
create or replace function qbo_drop_secret() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end $$;

drop trigger if exists qbo_connections_drop_secret on qbo_connections;
create trigger qbo_connections_drop_secret before delete on qbo_connections
for each row execute function qbo_drop_secret();

-- ---------------------------------------------------------------------- RLS --
-- `authenticated` gets NOTHING on this table. Not a narrowed view of it, not select-with-RLS: no
-- grant at all. Every other table in this schema is readable by its members because the data belongs
-- to them; this one holds a credential, and the client never needs it — it asks the server to sync.
alter table qbo_connections enable row level security;
revoke all on qbo_connections from anon, authenticated;

-- ------------------------------------------------------- what the UI may see --
-- Status WITHOUT the secret, plus the two things the banner needs: whether a reconnect is due, and
-- when. Computed here rather than in the client so the five-year rule has ONE definition.
create or replace function qbo_connection_status(p_company_id uuid)
returns table (connected boolean, realm_id text, qbo_company_name text, status text,
               authorized_at timestamptz, reauth_due_at timestamptz, needs_reauth boolean,
               last_sync_at timestamptz, last_error text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select true, c.realm_id, c.qbo_company_name, c.status,
           c.authorized_at,
           c.authorized_at + interval '5 years',
           c.status <> 'active' or now() > c.authorized_at + interval '5 years' - interval '30 days',
           c.last_sync_at, c.last_error
      from qbo_connections c
     where c.company_id = p_company_id;
end $$;

revoke all on function qbo_connection_status(uuid) from public;
grant execute on function qbo_connection_status(uuid) to authenticated;

-- --------------------------------------------------------- service-role only --
-- Connect, and RECONNECT, are the same call. That is the whole design: `on conflict do update`
-- replaces the secret and clears the error state while keeping `realm_id` and everything the mapping
-- depends on. If this were insert-only, the five-year reconnection would need a second code path
-- written years later by somebody who has forgotten how the first one works.
create or replace function qbo_connect(
  p_company_id uuid, p_realm_id text, p_refresh_token text,
  p_company_name text default null, p_refresh_expires_at timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare existing uuid; sid uuid;
begin
  select secret_id into existing from qbo_connections where company_id = p_company_id;

  if existing is null then
    sid := vault.create_secret(p_refresh_token, 'qbo_refresh_' || p_company_id::text,
                               'QuickBooks refresh token');
  else
    -- REPLACE IN PLACE. Creating a second secret and repointing would leave the old one behind, and
    -- an orphaned refresh token is a live credential nobody is tracking.
    perform vault.update_secret(existing, p_refresh_token);
    sid := existing;
  end if;

  insert into qbo_connections (company_id, realm_id, qbo_company_name, secret_id,
                               authorized_at, refresh_expires_at, status)
  values (p_company_id, p_realm_id, p_company_name, sid, now(), p_refresh_expires_at, 'active')
  on conflict (company_id) do update
     set realm_id           = excluded.realm_id,
         qbo_company_name   = coalesce(excluded.qbo_company_name, qbo_connections.qbo_company_name),
         secret_id          = excluded.secret_id,
         -- A RECONNECT RESTARTS THE FIVE-YEAR CLOCK, because the customer just consented again.
         authorized_at      = now(),
         refresh_expires_at = excluded.refresh_expires_at,
         status             = 'active',
         last_error         = null,
         last_error_at      = null,
         updated_at         = now();

  perform log_audit(p_company_id, 'qbo.connect',
                    jsonb_build_object('realm_id', p_realm_id, 'company', p_company_name));
end $$;

/** The refresh token, for the sync function and nothing else. */
create or replace function qbo_refresh_token(p_company_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  select s.decrypted_secret into tok
    from qbo_connections c join vault.decrypted_secrets s on s.id = c.secret_id
   where c.company_id = p_company_id;
  return tok;
end $$;

/** Rotation lands here. Called on EVERY refresh, because Intuit invalidates the previous token the
 *  moment it issues a new one — a rotation that is fetched and not stored is a dead connection. */
create or replace function qbo_rotate(p_company_id uuid, p_refresh_token text,
                                      p_refresh_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select secret_id into sid from qbo_connections where company_id = p_company_id;
  if sid is null then raise exception 'no_connection' using errcode = 'P0006'; end if;
  perform vault.update_secret(sid, p_refresh_token);
  update qbo_connections
     set refresh_expires_at = coalesce(p_refresh_expires_at, refresh_expires_at),
         status = 'active', last_error = null, last_error_at = null, updated_at = now()
   where company_id = p_company_id;
end $$;

/** A refresh that failed. `invalid_grant` is terminal — only the customer can fix it — so it sets
 *  `needs_reauth` rather than leaving something to retry forever against a dead token. */
create or replace function qbo_mark_error(p_company_id uuid, p_error text, p_terminal boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  update qbo_connections
     set last_error = p_error, last_error_at = now(), updated_at = now(),
         status = case when p_terminal then 'needs_reauth' else status end
   where company_id = p_company_id;
  if p_terminal then
    perform log_audit(p_company_id, 'qbo.needs_reauth', jsonb_build_object('error', p_error));
  end if;
end $$;

create or replace function qbo_record_sync(p_company_id uuid, p_rows int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update qbo_connections
     set last_sync_at = now(), last_error = null, last_error_at = null, updated_at = now()
   where company_id = p_company_id;
  perform log_audit(p_company_id, 'qbo.sync', jsonb_build_object('rows', p_rows));
end $$;

/** Disconnect. The row goes, and the trigger takes the secret with it.
 *
 *  ORDERING NOTE FOR THE EDGE FUNCTION: call Intuit's REVOKE endpoint FIRST, then this. Deleting our
 *  copy of a credential is not revoking it — a token we have thrown away but not revoked stays valid
 *  at Intuit, and we no longer hold it to revoke later. If revoke fails, delete anyway and log it
 *  loudly: keeping a usable token for a customer who asked to disconnect is the worse of the two. */
create or replace function qbo_disconnect(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships m
                 where m.company_id = p_company_id and m.user_id = auth.uid()
                   and m.role in ('owner', 'admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform log_audit(p_company_id, 'qbo.disconnect', '{}'::jsonb);
  delete from qbo_connections where company_id = p_company_id;
end $$;

-- Owners disconnect; everything else is the server's. `authenticated` cannot connect, cannot read a
-- token, and cannot record a sync — those are all calls the SERVER makes on a user's behalf after it
-- has checked who is asking.
revoke all on function qbo_connect(uuid, text, text, text, timestamptz)   from public;
revoke all on function qbo_refresh_token(uuid)                            from public;
revoke all on function qbo_rotate(uuid, text, timestamptz)                from public;
revoke all on function qbo_mark_error(uuid, text, boolean)                from public;
revoke all on function qbo_record_sync(uuid, int)                         from public;
revoke all on function qbo_disconnect(uuid)                               from public;

grant execute on function qbo_connect(uuid, text, text, text, timestamptz) to service_role;
grant execute on function qbo_refresh_token(uuid)                          to service_role;
grant execute on function qbo_rotate(uuid, text, timestamptz)              to service_role;
grant execute on function qbo_mark_error(uuid, text, boolean)              to service_role;
grant execute on function qbo_record_sync(uuid, int)                       to service_role;
grant execute on function qbo_disconnect(uuid)                             to authenticated;

-- ------------------------------------------------------------- keep-alive --
-- What the scheduled job asks for. Rotation is roughly daily and the idle window is ~100 days, so
-- running monthly catches a rotation with three months to spare. A connection that has not rotated in
-- 60 days is the one worth waking up for.
create or replace function qbo_due_for_keepalive(p_older_than interval default interval '25 days')
returns table (company_id uuid, realm_id text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select c.company_id, c.realm_id, c.updated_at
    from qbo_connections c
   where c.status = 'active'
     and c.updated_at < now() - p_older_than
   order by c.updated_at asc;
$$;

revoke all on function qbo_due_for_keepalive(interval) from public;
grant execute on function qbo_due_for_keepalive(interval) to service_role;
