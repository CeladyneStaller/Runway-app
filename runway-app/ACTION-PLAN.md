# From boutique app to product — revision 2

Reviewed 29 Jul 2026 against the previous plan. That plan estimated **six weeks to a product that can
take money and hold hundreds of users**. Most of it is done, and a real card has been charged.

The important change is not the tick marks. It is that **the binding constraint is no longer
engineering**, and a plan that keeps proposing engineering will quietly become a way of avoiding that.

---

## Scoreboard

### Phase 0 — before one paying user

| | Task | Status |
|---|---|---|
| 0.1 | Run the isolation suite against the real project | **DONE 29 Jul 2026 — 15 of 15 probes PASS.** Two throwaway accounts, real database, real refusals. |
| 0.2 | Version retention | **DONE** — migration 005: last 20 per document plus 5-minute snapshot coalescing. Last-N rather than a time window because a row count is a hard bound and "90 days" is not. |
| 0.3 | Error monitoring | **DONE** — `state/sentry.js`, wired in `main.jsx` and behind `ViewBoundary`. |
| 0.4 | `VITE_SITE_URL`, redirect allow-list, deployment protection | **DONE** — auth works end to end in production, including the OAuth callback. |
| 0.5 | Verify backups | **HELD, with a trigger.** PITR is a paid add-on and is deferred until traction; the trigger is the first customer document that is not the author's. Recorded in BACKEND-PLAN.md §8 along with why a self-built `pg_dump` is NOT a cheaper substitute. |
| 0.6 | Privacy policy, terms, DPA | **DRAFTED, UNREVIEWED, HELD** on the same trigger. |

### Phase 1 — monetization

**All six tasks done, and billing is LIVE.** Entitlement is enforced in `save_document` exactly as the
plan specified — `company_entitled()`, a distinct `payment_required` SQLSTATE, and client gating only
so the UI can be honest. Reads and export stay open when unpaid, including `switchCompany`, which
refuses only on RETRYABLE failures so an unpaid company cannot trap somebody on a screen they cannot
pay from.

Pricing landed differently and better: **per ACCOUNT, not per company** — Solo $40 / Advisor $99 /
Connected $149, with a 14-day trial computed from the signup timestamp and no card. The free slot is
the oldest company you own, computed rather than stored, so `memberships` needed no seat column.

### Phase 2 — "downloadable"

- **(a) PWA — DONE.** Manifest, service worker, install prompt. **Outstanding: PNG icons at 192 and
  512.** The manifest points at SVGs, which modern browsers accept and older Android and iOS do not,
  so install prompts are unreliable until they exist.
- **(b) Desktop — correctly not built.** Nobody has asked.
- **(c) Export — was already done.**

### Phase 3 — holding hundreds of users

| | Task | Status |
|---|---|---|
| 3.1 | Support channel | **NOT DONE.** |
| 3.2 | Product analytics | **NOT DONE**, and now the most expensive omission on this list — see below. |
| 3.3 | Rate limiting on `save_document` | **DEFERRED, with a trigger: measure first.** A flood costs CPU and egress but grows nothing (`documents` is one upserted row, versions are capped at 20), while a mistuned limit stops a paying customer saving their work. |
| 3.4 | Team invitations | Not done. Still the most likely first serious request; schema still shaped for it. |
| 3.5 | Status page | Not done. |
| 3.6 | Onboarding email sequence | Not done. |
| 3.7 | Migration rehearsal as a release step | Not done. |

### Phase 4 — trust layer

Security page and subprocessor list are inside the unreviewed legal drafts. SOC 2 and residency
correctly untouched. **New since the plan: sales tax / VAT is open** — live subscriptions create a tax
position and nothing has addressed it. It belongs with whoever reviews the legal drafts.

---

## Built since the plan, which it did not contain at all

- **A live QuickBooks integration.** Stages 0–7 of `QBO-PLAN.md`: OAuth with signed state, token
  custody in Vault, chunked report sync into the existing import screen, disconnect with revocation at
  Intuit, a monthly keep-alive, and alerting that fails a scheduled run when a human is needed. Only
  Intuit's production approval remains, and the Connected tier stays unsellable until it is green.
- **Recoverable company deletion** (016) — 30-day window, self-service restore, a purge, and
  `is_member`/`can_edit` narrowed so a deleted company is unreachable rather than merely unlisted.
- **An audit log that actually records** (015) — administrative and destructive acts, append-only by
  explicit revoke rather than by omission.
- **The debounce the backend plan asked for** — now a property of the backend, 400ms local and 2500ms
  hosted, read at schedule time because sign-in swaps the backend in after module load.
- **Editable milestones with a cash target**, and `profile.revenueCodes`, which closed a latent
  inversion in the FILE importer: a QuickBooks P&L reports income as positive and `parseAmount` read
  positive as cost, so every revenue row imported as spending.

---

## The three things actually outstanding, in order

### 1. ~~Run the isolation suite.~~ DONE — 15 of 15 pass.

**What it proved, in the results rather than in the intent:** `documents` answers **200 with zero rows**
(RLS filtering — the query is allowed, the rows are not there), while `memberships`, `qbo_connections`
and `qbo_refresh_token` answer **403** (no grant at all — refused before RLS is consulted), and the anon
key answers **401**. That is the "RLS and privileges are two independent gates" claim NOTES has carried
since migration 001, demonstrated instead of asserted — and it is exactly the distinction that broke
`qbo-sync` the day before, where a missing grant produced an error in a place expecting zero rows.

The headline probe now reads `seeded true, status 200, rows 0`. Yesterday it could have read `rows 0`
against an empty table.

**Make it a release step.** It costs seconds now that the harness works, and the thing it guards is the
one failure that ends a product. It belongs next to 3.7's migration rehearsal.

**The test accounts age.** In 14 days their trials lapse, `save_document` refuses with
`payment_required`, and the seed checks fail — loudly and by design. The fix then is to recreate the
users, not to interpret the output.

**PREPARED 29 Jul 2026 — and preparing it found three reasons the hour would have been wasted.**

- **THE SEED WAS NEVER CHECKED.** The suite wrote a marker document into B's company and never looked
  at the result, under a comment correctly noting that without a seed "a passing result could just mean
  B has no data, which proves nothing" — which is exactly what an unchecked seed permits. The likeliest
  refusal is mundane: a test account ages past its 14-day trial, `save_document` raises
  `payment_required`, nothing is written, and the headline probe reports perfect isolation against an
  empty table. Both accounts are now seeded, both seeds are checked, and a `payment_required` says so
  in words.
- **"A can read A's own document" asserted only an HTTP 200**, which you get from an empty array. It
  now asserts A's marker is actually in the body — the key turning is not the door opening.
- **THERE WERE TWO IMPLEMENTATIONS.** `test/security/tenant-isolation.test.js` carried its own copy of
  the probes under different env names, so `npm test` and `npm run verify:isolation` asserted different
  things — which is how the QuickBooks connection probes came to exist in one and not the other. Same
  failure as three hand-written CORS header lists. The probes now live in one module, both entry points
  drive it, and both env conventions are accepted.

- **AND THE RUNNER DID NOT READ AN ENV FILE.** `.env.example` documented `SUPABASE_TEST_*` while the
  shell runner demanded `SUPABASE_*` from the process environment only, so following the instructions
  produced `Missing SUPABASE_ANON_KEY` and a hunt through a script header. All three verification
  runners now load `.env.isolation` / `.env.local` / `.env`, accept either naming convention, tolerate
  CRLF, and when something is genuinely missing they name every accepted spelling and where they
  looked. A task that happens once every few months cannot also require remembering how it works.

Net: **15 probes instead of 8 or 12**, one of them new (`document_versions` — a body can be denied while
its history is not, two tables and two policies, only one of them obvious).

Two test accounts on the real project, then `npm run test:isolation`. There are now more probes than
when the plan was written — the QuickBooks connection table is covered too, asserting that
`qbo_connections`, the decrypt function and the anon key all fail OUTRIGHT rather than returning zero
rows, because an empty array would mean RLS is doing work that a grant should be doing.

**Today gave a concrete reason to stop deferring this.** `qbo-sync` failed in production because
`service_role` could not read a table it was never granted — and NOTES.md already records the same
shape from migration 001: RLS and privileges are two independent gates that fail differently. That is
the second instance. The probes are the only thing that asks the database rather than the migration.

While there: `stripe-portal` still reads `subscriptions` directly over PostgREST, the same pattern that
failed today. It works, so that table's privileges are fine — but it is one revoke away from failing
the same silent way.

### 2. ~~Analytics~~ BUILT 29 Jul 2026 — eight steps, and deliberately incapable of more.

`state/funnel.js`, migration 020, 15 tests. **Not PostHog, Segment or any SDK**, for the reason
`.env.example` already gives about error reporting: analytics libraries AUTOCAPTURE by default — click
targets, DOM text, input values, page URLs, sometimes session replay — and a product asking people to
trust it with salaries cannot also ship a library whose default behaviour is to record the screen.

**The API takes an event name and nothing else.** No properties bag, no payload, no custom fields — so
there is no parameter through which a number from somebody's model could arrive even by mistake. A test
asserts that passing one is ignored. The table has no user id, no company id and no properties column;
not "unpopulated", absent, because a schema with nowhere to put a runway figure cannot later be used to
put one there.

**Idempotent by database constraint** (`unique (anon_id, event)`): a funnel step is "did this visitor
reach it", not how many times, so a reload cannot inflate a count — and it bounds what an abusive caller
can write, which matters because the insert has to be reachable by `anon`. Instrumenting only
authenticated users would measure exactly the half that is not the question.

**Every event fires where success is knowable, not where intent is:** `signup_completed` on an
authenticated session rather than a submitted form; `first_save` on a write that actually landed;
`checkout_completed` on a subscription reading `active`, never on the redirect back from Stripe, which
is a URL the browser could have typed. `trialing` deliberately does not count, since this product's
trial is computed locally with no card.

The allowlist exists in three places on purpose — the client, the CHECK constraint, and
`funnel_summary`'s step list — and a test reads the migration to keep them from drifting.

Read it with `select * from funnel_summary();` — distinct visitors per step, in funnel order, so the
drop-off is visible reading down the column.

The previous plan called this "the single most valuable thing to know" and it is more true now: there
is a landing fork, a demo with a 12-hour window, a promotion path, a setup wizard, a mapping screen and
a checkout, and no instrumentation on any of it. If a prospect stalls in that funnel next week, nothing
will tell you where.

Scope it to the funnel and nothing else: landed, demo started, signed up, wizard completed, first save,
checkout started, checkout completed. Seven events. Not surveillance, and not a dashboard project.

### 3. Two view tests fail under load, and one is in the save path.

`account.test.jsx > "FLUSHES pending work before switching"` fails **5 of 5 runs** today and
`companyname.test.jsx > "does not rewrite an EXISTING model…"` fails about half. Both fail in the
pristine pre-session archive too, and both passed this morning in the same sandbox — so this is
load-sensitive timing in tests that mount the whole app, not a regression from recent work. The
engine-level `flush()` is provably correct in isolation.

It matters more than two red lines suggest: the failing test guards `switchCompany`'s flush, which is
the guarantee that unsaved work lands against the right company. **A suite that fails intermittently
trains people to re-run instead of read**, and this codebase's whole safety story is that the tests are
believed. Fix with deterministic waits rather than by loosening the assertion.

---

## What I would still NOT do

Everything the previous plan listed still holds — no rewrites, no card form, no second database, no SOC
2, no desktop app on a hunch. Adding to it:

- **Do not build the rate limiter before there is save-volume data.** The threshold would be a guess,
  and the failure mode of a wrong guess is a paying customer who cannot save.
- **Do not self-build backups as a cheaper PITR.** `supabase db dump` excludes the `auth` schema, so a
  restore returns rows whose owners do not exist and trials that cannot be computed, and restored
  tables inherit default privileges. It is a different recovery path with failure modes the paid one
  does not have, to be used for the first time on the worst day.
- **Do not add engineering to this plan while the binding constraint is a customer.** Every remaining
  technical item is either an hour long or waiting on a trigger.

---

## Suggested order

```
This week      Isolation suite (1 hour). Analytics funnel (1 day). Flaky tests (half a day).
               PNG icons while you are in there (1 hour).
Then           Talk to prospects. Nothing else on this list moves without one.
On the first   Legal review — start it the day you have a live prospect, not the day they sign;
customer       it is the only item whose lead time is not yours. Then Pro, PITR and one tested
               restore verified with the golden number and verify:isolation.
On demand      Intuit production approval before the Connected tier is sellable. Team invitations
               when somebody asks. Rate limiter when the data justifies a threshold.
```

**Roughly two days of engineering, and then a different kind of work.**

The previous plan's closing line was that six weeks was possible because the expensive, irreversible
decisions had already been made correctly. That is still the reason — and the thing those decisions
now protect is a product that takes money, connects to QuickBooks, and has nobody using it.

---

*State at revision: ~1,000 tests passing offline plus 15 isolation probes verified against the real
database, 2 timing-sensitive. 0 lint errors.
19 migrations. 9 Edge Functions (plus `_shared`). Golden number 5.6 months, unchanged through all of it.*
