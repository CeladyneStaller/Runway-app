# Backend build plan — hosted, with local-first kept

Destination: **multi-user, multi-company, high security.** The app is a hosted product with the server
as the source of truth for anyone signed in.

This document is the plan of record. It supersedes the local-first draft and amends the "multi-user
seam" note in `NOTES.md`, which stays correct about client code and is amended on database schema
(§1.4).

---

## STATUS — refreshed 28 Jul 2026

**Phase 1 (hosted document) is SHIPPED and in production.** Phases 2 and 3 are not started. Everything
below is kept as written except where a `STATUS:` line says otherwise — the reasoning is still why the
thing is shaped the way it is, and rewriting history would lose that.

**THE HEADLINE DEVIATION: online-only did not happen, and that was the right call.** This plan opened
by retiring IndexedDB. What shipped instead runs BOTH modes from one codebase, chosen by
`syncConfigured()` — hosted when `VITE_SYNC_ENABLED` and the keys are present, local-first when they
are not. `idb-keyval` is still a dependency, `state/backends/local.js` still exists, and demo mode
adds a third backend on localStorage. Consequences, all of them good:

- **The §0 one-way door was never walked through.** Offline remains reachable later without adding
  reconciliation to a live product.
- **§6's cutover order is moot.** There was no cutover, so nobody could be stranded by one, and the
  adoption offer (`AdoptLocalDialog`) is a permanent feature rather than a one-release window.
- **§0's "what gets worse" applies to hosted users only.** A local user still has a backstop copy on
  the device.
- The cost is a second backend to keep working, which the pluggable seam already made cheap, and which
  the demo mode paid for twice over.

**A SECOND NUMBERING EXISTS AND THIS ONE IS NOT IT.** The build sessions used Phase 0/1/2 for a
*launch* track — production readiness, billing, installability — while this document numbers *platform*
phases. They are different axes and both names are already in `NOTES.md`, so here is the mapping rather
than a rename:

| Launch track (NOTES.md) | What it was | Platform phase (this file) |
|---|---|---|
| Phase 0 | version retention, error reporting, stats, tenant-isolation probes, legal drafts | inside Phase 1 |
| Phase 1 | entitlement, Stripe, billing UI | **not in this plan at all** — see below |
| Phase 2 | installable PWA | not in this plan |
| — | hosted document, auth, conflicts, adoption | **Phase 1 here** |

**COMMERCIAL WORK THIS PLAN NEVER MENTIONED, now shipped:** entitlement enforced in `save_document`
(008), plans and a computed 14-day trial (009), subscription RPCs (010/011), staff exemption (014),
three Stripe Edge Functions, and the billing UI. A reader of the original document would think it was
missing; it is not, it was simply never planned here. `NOTES.md` carries its reasoning.

**BILLING IS LIVE as of 28 July 2026.** Checkout, the portal and the webhook are deployed in live
mode, a real card has been charged, and the subscription round trip — purchase, row, entitlement,
portal — is confirmed end to end. Of the four items that blocked taking money, three are done and the
fourth is LEGAL REVIEW, which is now the only thing standing between this product and a paying
stranger. **WHAT IS ACTUALLY LEFT is §8.**

---

## 0. What online-only actually changes

Worth being precise, because the savings are not where they look.

### What genuinely goes away

| Dropped | Size |
|---|---|
| Write queue + retry buffer | moderate |
| Local ↔ server reconciliation on load | moderate — this was the hardest single piece |
| `dirty` / `baseVersion` local bookkeeping | small |
| Stale-local-cache conflict class | a whole category of bug |
| `idb-keyval` dependency and `storage.js`'s IndexedDB body | small |

### What does NOT go away

Everything here is still required, and it is most of Phase 1:

- Optimistic concurrency. Two tabs and two devices still collide; you still need a version precondition.
- **Never save a document that did not come from a successful load** (§2.3). More important now, not
  less — see below.
- Schema-version skew refusal.
- Debounce, coalescing, and flush-on-unload.
- Sync-status UI — now *more* necessary, because there is no local durability behind it.

### What gets worse

1. **There is no longer a backstop copy on the device.** Under local-first, a failed load left the
   original parked in IndexedDB and a bad write was recoverable from the user's own machine. Online-only,
   the only backstop is server-side. That makes `document_versions` (§1.2) and the never-save-without-load
   guard load-bearing rather than defence-in-depth — they are the whole safety net.
2. **Unsaved work is exposed between debounce windows.** A dropped connection mid-edit can lose the last
   few seconds. Mitigated with an in-memory pending buffer, an explicit "unsaved changes" state, a
   `beforeunload` guard, and keeping the JSON export button prominent as the manual escape hatch.
3. **Cold open is a network round trip.** No instant paint from cache; a real loading state on every open,
   and the app is unusable on a plane.

### What gets better

**Phase 3 becomes materially simpler.** Concurrent editing against one authoritative server is a
tractable problem; concurrent editing across N divergent local caches is the CRDT problem. Since
multi-user is the stated destination, this is the trade that pays.

### One-way door, noted once

Local-first → online-only is a deletion. Online-only → local-first later means adding reconciliation to a
live product with real customers. If offline ever becomes a requirement, it will be more expensive then
than it would be now. Proceeding anyway is a reasonable call; it should just be a knowing one.

> **STATUS: not taken, and deliberately.** The door was left standing. `storage.js` dispatches to a
> local, hosted or demo backend, so the deletion this section warned about never happened and the
> option it was warning about losing is still there. The whole of §0 above should be read as "what
> online-only WOULD have changed" — the parts that came true are the ones about hosted users, because
> a signed-in user genuinely has no backstop copy and `document_versions` genuinely is the safety net.

---

## 1. Architecture

### 1.1 Platform

**Supabase for Phases 1–2. Railway only when something must run continuously.**

Supabase provides Postgres, Auth and Row-Level Security together. RLS is the highest-leverage security
decision available here: it enforces tenant isolation **in the database**, so an application bug cannot
leak Company A's numbers to Company B.

Phase 1 needs **no custom backend** — the client talks to Supabase directly, RLS does isolation, and one
RPC handles the write. Phase 2 needs a secret holder for QuickBooks OAuth: use **Supabase Edge
Functions**. Reach for Railway/Fly/Render only for long-running jobs, scheduled syncs at scale, or a
websocket server — Phase 3+ concerns.

Lock-in is acceptable: the data is Postgres and exports cleanly; Auth and RLS policies are a few hundred
lines.

> Verify current Supabase capabilities, tiers and compliance certifications directly — this plan was
> written against knowledge that may lag the product.

### 1.2 Data model

Multi-tenant from the first migration. `company_id` everywhere.

```sql
-- Tenancy -------------------------------------------------------------------
create table companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz                       -- soft delete; hard purge is a job
);

create type member_role as enum ('owner', 'admin', 'editor', 'viewer');

create table memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  role        member_role not null default 'editor',
  created_at  timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- The document ---------------------------------------------------------------
create table documents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  schema_version int    not null,
  body           jsonb  not null,
  version        bigint not null default 1,      -- optimistic concurrency token
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  unique (company_id)                             -- one document per company for now (§4.2)
);

-- Every write keeps its predecessor. With no local copy, THIS is the safety net.
create table document_versions (
  id             bigserial primary key,
  document_id    uuid not null references documents(id) on delete cascade,
  schema_version int    not null,
  body           jsonb  not null,
  version        bigint not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create index on document_versions (document_id, version desc);

-- Audit ----------------------------------------------------------------------
create table audit_log (
  id          bigserial primary key,
  company_id  uuid references companies(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,          -- 'doc.save', 'member.invite', 'qbo.connect', ...
  detail      jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
```

**Sizing.** Measured: 16 KB today, 39 KB after a year of weekly journalling, 141 KB after five years,
167 KB for a busy company with three years of ledger, ~308 KB at the journal cap. Whole-document writes
are viable well past first real customers — no deltas, no CRDT. Full version history is affordable;
revisit retention past a few thousand versions per company and thin to dailies-then-weeklies.

### 1.3 Row-Level Security

On every table. No exceptions, including `document_versions` and `audit_log`.

```sql
alter table companies         enable row level security;
alter table memberships       enable row level security;
alter table documents         enable row level security;
alter table document_versions enable row level security;
alter table audit_log         enable row level security;

create or replace function is_member(c uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from memberships m
                 where m.company_id = c and m.user_id = auth.uid());
$$;

create or replace function can_edit(c uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from memberships m
                 where m.company_id = c and m.user_id = auth.uid()
                   and m.role in ('owner','admin','editor'));
$$;

create policy doc_read  on documents for select using (is_member(company_id));
create policy doc_write on documents for update using (can_edit(company_id))
                                            with check (can_edit(company_id));
create policy doc_new   on documents for insert with check (can_edit(company_id));
create policy ver_read  on document_versions for select
  using (exists (select 1 from documents d
                 where d.id = document_id and is_member(d.company_id)));
```

The `service_role` key **never** reaches the browser. The client uses the anon key plus the user's JWT.

### 1.4 Amendment to the NOTES seam guidance

`NOTES.md` says: no auth, no user IDs, no tenancy columns, "not even a `userId: null`. Add it when a user
exists." Correct for **client code**; keep following it there.

Amended for **database schema**: `company_id` costs one column today and is a migration under load later.
Multi-company is the destination, so it lands in migration 001 even while every company has one member.

### 1.5 Fork worth deciding now: blob or sections

Phase 3 splits the document into per-section rows so two people editing different areas do not clobber
each other. That split can happen now or later.

- **Blob now, split later** — leanest Phase 1; costs a data migration on live customer data at Phase 3.
- **Sections from day one** — modestly more Phase 1 work (reassembly on read, per-section writes); no
  migration ever, and collaboration becomes incremental rather than a project.

**Recommendation: blob now.** With online-only there is no local reconciliation making the later split
painful, the document is small enough that a migration is a single pass, and Phase 1's job is to get real
data onto a server safely. Revisit the moment a second editor is genuinely imminent. `buildModelParts`
already isolates the client from document shape, so the split will not ripple into the engine.

---

## 2. Phase 1 — Hosted document — **SHIPPED**

> **STATUS: done and live**, except the four items listed in §8 under "Still open inside Phase 1".
> Migrations 001–014, `state/storage.js` + `state/backends/`, `state/auth.js`, `state/sync.js`,
> `views/SignIn.jsx`, `views/chrome/ConflictDialog.jsx`, `views/chrome/AdoptLocalDialog.jsx`.

**Goal:** the server is the source of truth. Multi-device works. Journal snapshots and cash actuals stop
being hostage to one browser. Real backups exist.

**Not in scope:** concurrent editing, realtime, QuickBooks, offline.

### 2.1 The seam rewrite

`storage.js` stays the only file that knows persistence exists — it has exactly one import site
(`App.jsx`), which is what makes this swap safe. Four functions instead of six:

```
load()          → fetch the company's document; throws distinguishable errors
save(doc)       → debounced push with a version precondition
status()        → { state: 'saved'|'saving'|'unsaved'|'error'|'stale', at }
subscribe(fn)   → status changes, for the indicator
```

`idb-keyval` comes out of `package.json`.

> **STATUS: shipped as FIVE functions, and `idb-keyval` stayed.** `flush()` was added because the
> cadence moved into `storage.js` — a caller that can only `save()` cannot force a write before a
> company switch, a sign-out or a tab close, and all three turned out to need one. `idb-keyval`
> remains because local mode remains; the seam dispatches to `backends/{local,supabase,demo}.js`
> instead of holding IndexedDB code itself, which is the property this section actually wanted.
> The RPC below shipped essentially as written, later extended by 005 (retention + snapshot
> coalescing) and 008 (the entitlement check).

Writes go through an RPC, not a blind update:

```sql
create or replace function save_document(
  p_company_id uuid, p_schema_version int, p_body jsonb, p_base_version bigint)
returns table (version bigint, updated_at timestamptz)
language plpgsql security definer as $$
declare cur documents%rowtype;
begin
  select * into cur from documents where company_id = p_company_id for update;

  if not can_edit(p_company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- refuse writes from a client older than the stored document (§2.3 hazard 2)
  if cur.id is not null and p_schema_version < cur.schema_version then
    raise exception 'stale_client' using errcode = 'P0001';
  end if;

  -- somebody else moved it since we loaded (§2.4)
  if cur.id is not null and cur.version <> p_base_version then
    raise exception 'conflict' using errcode = 'P0002';
  end if;

  insert into document_versions (document_id, schema_version, body, version, created_by)
    values (cur.id, cur.schema_version, cur.body, cur.version, auth.uid());

  update documents set body = p_body, schema_version = p_schema_version,
         version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id
   returning documents.version, documents.updated_at into version, updated_at;
  return next;
end $$;
```

### 2.2 Save cadence and the unsaved-work buffer

The current 400 ms debounce is free against IndexedDB and wrong over a network — it would push a
40–300 KB body every 400 ms while someone types a project name.

- **Debounce 2.5 s**, with a hard flush every 30 s while unsaved.
  *(**STATUS: NOT DONE.** `SAVE_DEBOUNCE_MS` is still 400 — correct for IndexedDB, wrong over a
  network, which is exactly what this line was written to prevent. The 30 s ceiling shipped as
  `MAX_UNSAVED_MS`. This is a live open item in §8: the constant needs to depend on the backend, not
  on the file it lives in.)*
- **Skip unchanged:** hash the body; never push an identical document.
- **Coalesce in flight:** one push at a time; supersede queued pushes rather than stacking them.
- **Flush on `visibilitychange` → hidden**, and on `beforeunload` via `sendBeacon`.
- **`beforeunload` guard** while unsaved: browsers only allow a generic prompt, so pair it with a visible
  in-app indicator that is honest about state.
- **Retry with backoff** on transient failures, holding the pending document in memory. This is not a
  write queue — it does not survive a tab close — but it turns a blip into a non-event.

### 2.3 Hardening — definition of done, not follow-ups

**Hazard 1 — never save a document that did not come from a successful load.**
Today a failed `load()` returns `emptyDoc()`, and 400 ms later the save effect writes it back. Locally that
was survivable because `load()` parked the unreadable original under a timestamped key. **Online-only there
is no parking**, so an offline start, a 500 or an expired session would blank the screen and then overwrite
the real server document with an empty one.

Three layers, all required:
- The client distinguishes `loaded-empty` from `load-failed`, and `save()` is a hard no-op unless the
  in-memory document descends from a successful load. On load failure the app shows an error state — never
  an editable empty company.
- The version precondition rejects any push whose `base_version` does not match.
- `document_versions` retains the predecessor, so even a successful bad write is recoverable.

**Hazard 2 — schema skew is routine now.**
Verified: `migrate()` throws when a document is newer than the build (`Document is v4; this build
understands v3`). One browser with one bundle made that nearly unreachable; hosted, it is a laptop that
upgraded and a phone on a stale cached bundle — straight into Hazard 1.

- `schema_version` is a column; `save_document` refuses writes declaring an older version.
- On `stale_client`, show "This model was updated in a newer version of the app. Reload to continue." —
  never a blank company, never a write.
- Bundle caching set to revalidate so a reload actually gets the new build.

**Hazard 3 — surface sync state.**
The app has no concept of unsaved work today, and online-only makes that unacceptable. Persistent
indicator: Saved / Saving… / Unsaved changes / Can't reach the server / Needs reload. Keep the JSON export
button prominent — with no local copy, it is the user's only self-service recovery, and the existing copy
already reads *"Your work is still on screen — export it before closing this tab."*

### 2.4 Conflict handling

One editor, several devices and tabs.

- Every push carries `base_version`; a mismatch returns `conflict`.
- The client does **not** merge. It presents: *"This model was changed elsewhere at 14:02. Keep this
  version, or load the other one?"* — with a diff of headline numbers (runway, cash, employee count,
  line-item count) so the choice is informed.
- The losing side is written to `document_versions` first. Nothing is destroyed either way.

Field-level merge is Phase 3. Do not build it now.

### 2.5 Rollout actions

1. Supabase dev + prod projects. MFA on the Supabase account itself.
2. Migration 001: schema (§1.2), RLS (§1.3), `save_document` (§2.1). RLS on from the first migration,
   never retrofitted.
3. Auth: email magic link + Google. 7-day sessions, refresh rotation on.
4. Sign-up creates `companies` + owner `memberships` atomically in a trigger.
5. Rewrite `storage.js` to the four-function shape behind `SYNC_ENABLED`. Remove `idb-keyval`.
6. Hazards 1–3, each with a test that fails without the fix (house protocol).
7. Sync-status indicator + `beforeunload` guard.
8. Conflict prompt with headline diff.
9. **One-time adoption path:** existing local documents are stranded once IndexedDB is removed. Ship a
   version *before* the cutover that detects a local document and offers "Upload this model to your
   account." Keep it available for one release cycle, then drop it. Missing this window means users
   export/import by hand.
10. Backups: PITR plus nightly `pg_dump` to separate object storage. **Test a restore before launch and
    quarterly after.** An untested backup is a rumour.
11. Rate-limit `save_document` per user.

### 2.6 Exit criteria

- Sign up, enter a model on machine A, open machine B, see it.
- Kill the network mid-edit: indicator goes honest, retry recovers on reconnect, nothing silently lost.
- Force a conflict from two tabs: user is asked, both versions in `document_versions`.
- Point an old bundle at a newer document: refusal message, no write, no blank company.
- Simulate a failed load: error state, and **no** write is attempted.
- Cross-tenant probe: a member of Company A cannot read Company B through any API call. Verified by an
  automated test, not by reading policy text.
- Restore from backup into a scratch project and open the restored document.
- Golden number still 5.6 throughout.

---

## 3. Phase 2 — Live QuickBooks — **NOT STARTED**

> **STATUS: not started, and less urgent than it was.** The four-piece FILE import shipped instead
> (`engine/importer.js`, `engine/profile` rules, `ImportModal`, tolerant profile matching), which is
> the same pipeline a live connection would feed. Everything in §3.3 still holds: a live source
> replaces `fileToGrid` and nothing else. Note this is the phase the "Connected $149" plan tier is
> sold against, and the billing UI deliberately renders it as "Not available yet" rather than a buy
> button — selling it before it exists is the one failure no refund fixes.

**A security escalation, not just more code.** Phase 1 stores documents people typed. Phase 2 stores OAuth
refresh tokens for their accounting system. Separate project, separate review.

### 3.1 Why the server is required

The OAuth client secret cannot live in a browser. That constraint is the entire reason import is
file-based today, and this phase is what the backend is functionally *for*.

### 3.2 Design

- **Edge Function** holds the client secret and runs the authorization-code exchange and refresh.
- Tokens live in `qbo_connections`, `company_id` scoped, RLS on, token columns encrypted with a key in
  **Supabase Vault / KMS — not merely disk encryption at rest.** Disk encryption protects a stolen drive;
  it does not protect a leaked read on the table.
- Tokens are never returned to the client. The client calls "sync now"; the function does the talking.
- Disconnect deletes tokens and calls QuickBooks' revoke endpoint.
- Minimal, read-only accounting scopes.

### 3.3 The import seam

The pipeline is `fileToGrid → applyProfile → mergeImport`. A live source replaces **only the first step**,
emitting the same row shape. Tolerant profile matching, inline code/customer mapping and the merge report
are all untouched. "New source, not new pipeline" holds.

### 3.4 Rollout actions

1. QuickBooks developer app; sandbox company first.
2. `qbo_connections` + Vault-encrypted token columns + RLS.
3. Edge Function: `connect`, `callback`, `refresh`, `sync`, `disconnect`.
4. `quickbooksSource()` emitting the existing row shape into the existing pipeline.
5. Sync UI reuses the current import preview — same mapping, same commit, same report.
6. Audit-log every connect / sync / disconnect.
7. Alert on refresh failures. A silently dead sync is worse than no sync.

### 3.5 Exit criteria

- Connect sandbox, sync, land rows in the ledger through the existing preview.
- Tokens never observable from the client; verified against network traffic.
- Disconnect revokes upstream and removes stored tokens.
- Refresh survives token expiry with no user action.

---

## 4. Phase 3 — Collaboration — **NOT STARTED**

> **STATUS: not started.** The groundwork is in place and was cheap: `memberships` is many-to-many,
> `member_role` already has owner/admin/editor/viewer, multi-company shipped with a switcher, and
> `can_edit()` is the single gate. What does not exist is any UI for a second person — no invitations,
> no seat management, no viewer shell — and the document is still a single blob (§4.2).

Online-only makes this the phase that got cheaper. There are no divergent local caches to reconcile — one
authoritative document, and the only question is who touched what.

### 4.1 What still breaks

The single-blob model. Two people editing different parts of one document clobber each other, and
last-write-wins cannot fix it: one of them silently loses work they never knew was at risk.

### 4.2 The split

```
document_sections (document_id, section, body jsonb, version, updated_at, updated_by)
  section ∈ employees | projects | lines | pos | rounds | history | settings | journal | ...
```

Conflicts then only arise when two people touch the *same* section — rare in practice and tractable to
present. The client reassembles the document from sections; `buildModelParts` does not care where the
fields came from, which is one more reason the one-model merge was worth doing first.

The journal is append-only and becomes its own table here rather than a growing array inside a blob.

Migration is a single pass over `documents.body` — cheap because the documents are small, and safe because
`document_versions` retains every original.

### 4.3 Also in this phase

- Roles enforced in the UI as well as RLS (viewers get a read-only shell).
- Invitations, seat management, member removal with immediate session revocation.
- **Presence** ("Dana is editing Payroll") via Supabase Realtime — cheap, and it prevents most conflicts
  socially rather than technically. Straightforward precisely because everyone is online by definition.
- Full audit trail surfaced to owners.

### 4.4 Exit criteria

- Two users edit different sections simultaneously; both land, neither is warned.
- Two users edit the same section; the second is told, with a diff, and nothing is lost.
- A viewer cannot write, enforced at the database.
- Removing a member revokes access immediately, including any live session.

---

## 5. Security posture (cross-cutting)

**Isolation.** RLS on every table from migration 001. Tenant isolation is a database property, not an
application property. A test that attempts cross-tenant reads through the real client and expects failure
runs in CI.

**Keys.** `service_role` never ships to the browser. Edge Function secrets in Supabase secrets management.
Rotate on any staff change.

**Tokens at rest.** OAuth refresh tokens encrypted with a managed key, separate from disk encryption.

**Transport.** TLS only, HSTS, strict CSP — the app is a static bundle plus one API origin, so a tight
policy is genuinely achievable.

**Auth.** MFA available, required for `owner`. Short-lived JWTs with rotating refresh. Session revocation
on member removal.

**Audit.** Every document save, membership change and connector action logged with actor, time and IP.
Owners can read their own company's log.

> **STATUS: the TABLE exists (001) and NOTHING WRITES TO IT.** `save_document` does not insert an
> audit row, no RPC does, and no view reads one. That is worse than not having the table, because the
> schema now implies an audit trail this product cannot produce — and "we log every save" is the kind
> of claim that ends up in a security questionnaire. Either wire `save_document` to write it, or drop
> the table until something does. Listed in §8.

**Backups.** PITR plus independent nightly dumps to separate storage. Quarterly tested restore. With no
local copies anywhere, **backups are now the only copy** — this moves from good practice to existential.

> **STATUS: deferred, knowingly, with a trigger.** Supabase's own PITR is on; the independent dump and
> the tested restore are not built. The trigger agreed in the build sessions is THE FIRST REAL
> CUSTOMER DOCUMENT — not the first sign-up, not the first payment attempt. Until then the only data
> at risk is the author's own. Deferring is defensible; forgetting is not, which is why it has a
> trigger written down rather than a place in a backlog.

**Deletion.** Soft delete then scheduled hard purge across `documents`, `document_versions`, `audit_log`
and connector tokens, with a published SLA. Online-only makes this genuinely clean: no stray copies in
browsers you do not control. That is a real compliance advantage of this architecture and worth saying so
to customers.

**Dependencies.** The SheetJS CVE-patched CDN pin is house practice; keep `npm audit` clean in CI.

**Before real customer data:** an external penetration test, and a written incident-response plan with a
named owner.

---

## 6. Rollout mechanics

**Feature flag.** `SYNC_ENABLED`. Local-only remains the fallback for the whole Phase 1 build, and the app
must stay fully functional with the flag off until the cutover ships.

**Cutover order.** *(**STATUS: moot — there was no cutover.** Local mode was kept, so no document was
ever stranded behind a removed backend and the adoption offer became permanent rather than a window.
Kept here because the reasoning applies again the day IndexedDB is genuinely removed.)* This is the one
sequencing detail that cannot be got wrong:

1. Ship the **adoption build** — still local-first, plus "Upload this model to your account."
2. Leave it live for a release cycle so people actually upload.
3. Ship the **online-only build** that removes IndexedDB.

Removing local storage before people have uploaded strands their data behind a version they no longer
have. There is no recovery path for that except manual export from an old bundle.

**Deployment order per release.** Migrations, then Edge Functions, then the client bundle. The server
tolerates the previous client for at least one release — hence `save_document` accepting
equal-or-newer schema versions rather than exact matches.

**Rollback.** Client rollback is a bundle revert. Database rollback is not — so every migration is
additive (add columns and tables; never drop in the same release as the code that stopped using them).
Drops happen a release later, once rollback is off the table.

**Staged audience.** Yourself, then a few friendly companies, then open. The journal makes this easy to
evaluate: forecast snapshots accumulating server-side across several real companies is exactly the dataset
the journal's own Phase 2 and 3 need.

---

## 7. Risks and open questions

| Risk | Mitigation |
|---|---|
| Blank-document clobber on failed load | never-save-without-load + version precondition + `document_versions`; all three |
| Users stranded at cutover | adoption build ships first and lives a full release cycle (§6) |
| Schema skew across devices | `schema_version` column, `stale_client` refusal, revalidating bundle cache |
| Work lost between debounce windows | in-memory retry, `beforeunload` guard, honest indicator, prominent export |
| Backups are now the only copy | PITR + independent dumps + quarterly restore drill |
| QuickBooks token compromise | Vault/KMS encryption, never client-visible, revocation, minimal scopes |
| Blob model outliving its welcome | plan the section split before a second editor, not during |
| Offline becomes a requirement later | acknowledged one-way door (§0); retrofitting onto a live product is materially harder |

**Open questions — three of the four are now answered**

1. ~~**Companies per user.**~~ **ANSWERED: yes, from day one.** `memberships` was always many-to-many;
   what was missing was `list_companies` / `create_company` / `rename_company` and a notion of which
   company is ACTIVE (003). The switcher is on the Account page, the active company is per-device in
   IndexedDB because it is a view preference rather than data, and `switchCompany()` flushes first so a
   pending write cannot land against the wrong company.
2. ~~**Pricing shape.**~~ **ANSWERED: per ACCOUNT, not per seat or per company.** Solo $40 (1 company),
   Advisor $99 (unlimited), Connected $149 (unlimited + the ledger connection Phase 2 has not built).
   14-day trial computed from the signup timestamp with NO card — buyers here bounce off a card wall,
   so Checkout happens at conversion. The free slot is the OLDEST COMPANY YOU OWN, computed rather than
   stored. So `memberships` needed no seat-limit column after all; seats become a real question again
   at Phase 3, and the shape to reach for then is a seat count on the SUBSCRIPTION, not on membership.
3. **Sales tax / VAT.** NEW AND OPEN — this plan never mentioned it and neither did anything else.
   Live subscriptions create a tax position; Stripe Tax exists and is a configuration decision, not a
   code one. Needs an answer from whoever answers the legal drafts, not from this document.
4. **Residency.** STILL OPEN. No customer has asked. Still a decision made once, at project creation,
   so it stays worth asking the first EU prospect before signing them rather than after.
5. ~~**Version retention.**~~ **ANSWERED: last 20 per document, plus 5-minute snapshot coalescing**
   (005). Last-N rather than a time window because a row count is a hard bound and "90 days" is not.

---

## 8. Sequenced checklist

**Pre-cutover** — *not applicable; local mode was kept and there was no cutover.*

- [x] Adoption build: "Upload this model to your account" — shipped as a PERMANENT feature
      (`AdoptLocalDialog`), offered only when the account is empty, and never deleting the local copy

**Phase 1 — done**

- [x] Supabase dev + prod, MFA on the account
- [x] Migration 001: tenancy, documents, versions, audit, RLS, `save_document`
- [x] Migration 002: the GRANTs 001 forgot — RLS and privileges are two independent gates, and a
      missing GRANT fails differently (permission denied) from an RLS denial (zero rows)
- [x] Auth: magic link + Google + password, with `SetPassword` for both creating and resetting;
      sign-in bootstraps a company atomically via `current_company()`
- [x] `storage.js` → the online seam behind `syncConfigured()` (five functions; `idb-keyval` KEPT)
- [x] Hazard 1: never-save-without-successful-load — `test/state/saveguard.test.js` includes a test
      that reproduces the destruction with the guard removed
- [x] Hazard 2: schema-skew refusal (`LOAD_STALE`, `stale_client`)
- [x] Hazard 3: sync indicator, `beforeunload` guard, export never gated — not even when unpaid
- [x] Skip-unchanged, coalesce in flight, retry with backoff, flush on hide/unload
- [x] Conflict prompt with headline diff — and RESOLUTION, which the plan did not ask for: "mine"
      re-reads first so the retry actually lands, "theirs" suppresses the immediate write-back
- [x] Cross-tenant isolation test against a REAL project (`npm run test:isolation`, 8 probes,
      skipped offline so `npm test` stays hermetic)
- [x] Exit criteria §2.6 green; golden still 5.6

**Still open inside Phase 1 — the plan asked for these and they are not done**

- [x] **Debounce → 2500 ms when the backend is hosted. DONE 28 Jul 2026.** Not a constant swap: the
      cadence is now a property of the backend (400 local and demo, 2500 hosted) and is read from the
      ACTIVE backend at schedule time, because sign-in swaps the backend in after module load. Both
      call sites — the scheduler and the reschedule inside `flush()` — and four tests including the
      mid-session swap. The trade is recorded in `NOTES.md`: up to 2.5s of work in memory instead of
      0.4, bounded by `MAX_UNSAVED_MS` and the flush on `pagehide`.
- [ ] **Audit log: write it or drop it.** The table has existed since 001 with nothing inserting a row.
- [ ] **Rate-limit `save_document` per user.** Nothing limits it today.
- [ ] **Backups: independent dump + a tested restore. THE TRIGGER HAS ESSENTIALLY FIRED.** The
      deferral was agreed against "the first real customer document", and billing going live means
      that is now days away rather than hypothetical. PITR alone is not a tested restore, and an
      untested backup is a rumour. This is the item most likely to be regretted.

**Before taking money — DONE except legal, 28 Jul 2026**

1. [x] **`stripe-checkout` and `stripe-portal` deployed.** Took four rounds, all of them presenting as
       a CORS error and none of them being one. Recorded in `NOTES.md` and the functions README because
       every one was invisible to this repo's tests: `verify_jwt` rejecting the PREFLIGHT (a browser
       cannot send `Authorization` on an `OPTIONS`, so the gateway check made the function unreachable
       and logged nothing); a JSON secret mangled by PowerShell's quote-stripping, throwing at module
       scope so the function never booted; and an `Access-Control-Allow-Headers` list written from what
       the handler READS rather than what a browser SENDS, omitting `apikey`.
2. [x] **Products and prices created; both maps set.** Now in LIVE mode.
3. [x] **Test-mode checkout with `4242`, then a real live purchase.** `metadata.user_id` survives a
       real Checkout Session, the row lands with a `stripe_customer_id`, and the portal opens against
       it. This is the part the suite structurally cannot verify.
4. [ ] **Send the legal drafts for review.** Privacy policy, terms and subprocessors are drafted and
       unreviewed. THE LAST THING BETWEEN THIS PRODUCT AND A PAYING STRANGER, and the only item whose
       lead time is not yours. Money can now be taken; that is precisely why this stops being an
       item on a list and starts being an exposure.

**THE LESSON FROM THAT SEQUENCE, because it will happen again in Phase 2.** Every one of those four
failures lived in DEPLOYMENT CONFIGURATION — a dashboard toggle, a shell-quoted secret, a header
literal in a file no test can import. The suite was green throughout. `vite build` was clean
throughout. The first signal in each case was a person unable to pay, and the error message named the
wrong subsystem every time. Two things came out of it worth keeping: the CORS rule now has ONE tested
definition in `_shared/cors.js` rather than a literal per function, and secrets read at module scope
are parsed defensively, so a bad value degrades loudly at request time instead of preventing boot.
What remains unprotected is the `verify_jwt` setting itself, which exists only in a README.

**Also outstanding, small**

- [ ] PNG icons at 192 and 512 for the PWA — the manifest points at SVGs, which modern browsers accept
      and older Android and iOS do not, so install prompts are unreliable until they exist.

**Phase 2 — QuickBooks (not started)**

- [ ] QuickBooks app + sandbox company
- [ ] `qbo_connections` + Vault-encrypted tokens + RLS
- [ ] Edge Function: connect / callback / refresh / sync / disconnect
- [ ] `quickbooksSource()` emitting the existing row shape into the existing pipeline
- [ ] Audit + refresh-failure alerting — a silently dead sync is worse than no sync
- [ ] Exit criteria §3.5. **Do not sell the Connected tier before this is green.**

**Phase 3 — collaboration (not started)**

- [ ] `document_sections` split; journal to its own table
- [ ] Per-section optimistic concurrency
- [ ] Roles in the UI, invitations, seat management, session revocation on removal
- [ ] Presence via Realtime
- [ ] Exit criteria §4.4

**Before real customers:** penetration test, incident-response plan with a named owner, published
deletion SLA. *(Deletion is BUILT — `delete_my_data()` + the account-deletion Edge Function, with
shared companies surviving — but the published SLA is not written.)*
