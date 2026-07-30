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

**1.7 — Automatic subscription renewal, and a notice before one stops.** Stripe renews by default, so
the work is not making renewal happen — it is NOTICING WHEN IT WILL NOT. `cancel_at_period_end` is now
stored on both `subscriptions` and `advisor_subscriptions` (031), and `expiring_subscriptions(interval)`
answers "which plans stop inside a month" across companies and advisors together, because losing a
company plan and losing an advisor plan are the same surprise from different directions.

What remains: the webhook has to WRITE `cancel_at_period_end` — the company half of that query is dead
until it does — and something has to run the query and tell somebody. The keep-alive workflow already
runs monthly with a service key and already fails a run when a person is needed, so it is the obvious
home rather than a second scheduler.

Worth deciding when it is built: WHO HEARS. For a company plan the owner is the billing contact; for an
advisor plan it is the advisor. Probably both — plus the owners of any company an expiring advisor is
in, because their advisor is about to start consuming a seat.

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
| 3.4 | Team invitations | **DONE 29 Jul 2026.** Migrations 021–025, `engine/roles.js`, the People panel and the invitation screen. 48 tests. |
| 3.5 | Status page | Not done. |
| 3.6 | Onboarding email sequence | Not done. |
| 3.7 | Migration rehearsal as a release step | Not done. |
| 3.9 | **Project-level visibility.** A project leader may need detail about their project that a general member should not see — and conversely, some company-wide figures should stay out of a project view. Per-project access, granting more within a project and less outside it. | Not done. **Depends on 3.8**: filtering *what* somebody sees requires the document to have addressable parts, which one jsonb blob does not have. It is also the second rule of the form "this role may see that part" — after the scenarios tab — which is the pattern that makes 3.8 structural rather than tidy. Note it inverts the current model: today every member sees the whole document, and roles gate WRITING, not reading. |
| 3.8 | **Split the document into sections** (`document_sections`, journal to its own table, per-section optimistic concurrency). Phase 3 of `BACKEND-PLAN.md` §4.2. | **Not done, and now BLOCKING a stated product rule.** The document is one jsonb blob written by one RPC, so there is no field-level permission: "an advisor may edit scenarios but not payroll" is not expressible. 028 works around it with a personal layer — the advisor's scenarios live in their own table and are OFFERED to the owner rather than written. That is a better product in its own right, but it is a workaround for a schema limit, and every future rule of the form "this role may change that part" hits the same wall. |

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

**FIRST REAL READING FOUND A BUG IMMEDIATELY.** Opening the demo recorded `first_save`, because
`first_save` fired on ANY backend write and the demo backend is a real backend —
`activateDemoBackend(demoDoc())` seeds a sample document, autosave writes it, and activation was
recorded before the visitor had typed anything. That made the step a duplicate of `demo_started` and
destroyed the only signal it carried. It is now gated on the HOSTED backend, so local-first saves are
excluded for the same reason: nothing reached an account, so nobody activated. Three tests, two of
which fail on reversion.

Worth noting how it was caught: by running the query and reading the numbers, on the first day, against
real events. No test would have found it — the events were all firing correctly, at the wrong moment.

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

## The commercial model moved to the COMPANY — 29 Jul 2026

Solo 1 seat / Collaborative 3 / Connected 5 + QuickBooks. **Advisor is a USER ATTRIBUTE, not a plan** —
invited to any number of companies, consumes no seat, priced for a portfolio panel rather than for
access.

**WHY THIS REVERSES 009, which had moved subscriptions from company to user.** `company_entitled` only
ever consulted members whose role is OWNER, and an advisor is invited as an admin or a viewer — so the
Advisor tier sold an unlimited-companies allowance that applied to the zero companies an advisor owns.
The workaround, making the advisor an owner, became actively dangerous the same afternoon 021 shipped:
an owner can delete the company, remove you and demote you.

**009's OTHER TWO REASONS SURVIVED AND WERE RESPECTED.** No free tier — the free thing is the demo, and
nothing here grants a free company. And the one that nearly caught me out: *"a stored trial needs a row
created at signup, which needs a hook, which can fail and leave an account unable to write."* My first
proposal walked into it. `companies.trial_ends_at` is therefore **NOT NULL WITH A DEFAULT**, and the
"no trial on a second company" rule is applied by CLEARING it — so a creation path that forgets hands
out an extra fourteen days rather than making a company nobody can ever write to. The failure falls
towards costing money instead of towards locking somebody out.

**DOWNGRADES DESTROY NOTHING.** Entitlement asks "am I within the seat count", seats ordered owner-first
then by join date — so Collaborative → Solo leaves the owner writing and everybody else read-only
WITHOUT deleting a single membership, and upgrading restores them exactly. That was a deliberate
departure from the stated rule ("they lose it fully"), because the trigger is a billing event: a card
expiring on holiday would otherwise delete three people's access irreversibly. Removing somebody stays
a deliberate act by an owner.

**THREE REFUSALS, THREE CODES.** `forbidden` (fix your role), `payment_required` (buy a subscription),
`no_seat` (ask for a seat). Raised in that order, because somebody with no business writing here should
not learn the company's billing status, and a company nobody has paid for has no seats to be short of —
reporting `no_seat` first would describe a consequence as the cause.

**Split across two migrations on purpose.** 022 is entirely additive: `subscriptions.user_id` keeps its
primary key, the Stripe webhook is untouched, and the live subscription keeps working. 023 is the one
that can refuse a paying customer, and it is `save_document` reproduced from 016 with exactly one block
changed — verified by diffing the two.

**DONE SINCE:** the rekey (024), seats enforced at invite time (025), and the UI — a People panel with
seat usage, role controls limited to what the server will accept, invitations with a copy-link, and an
acceptance screen that ASKS rather than acting on being opened, because a link that acts when opened is
a link that acts when a mail client scans it.

**REMAINING:** new Stripe prices keyed `collaborative` in both maps, and another live `4242` run —
checkout now stamps `metadata.company_id` and the webhook attributes by it, which is the one path no
test can verify.

**Superseded:** rekey `subscriptions` to `company_id` and move the checkout metadata and webhook onto
it (the only step that can break billing, and it needs another live `4242` run); seats enforced in
`invite_member`; the members and advisor UI; and `plans.js` renamed from `advisor` to `collaborative`,
which cannot happen before the Stripe price maps do.

## The role model, corrected — 29 Jul 2026

**ONLY AN OWNER APPOINTS AN ADMIN** (027). 021 let anybody grant up to their own rank, so an admin
could mint admins — and an admin who can do that can mint one out of their own second address, after
which every other check in the schema is decorative. The rule is now "strictly below your own, unless
you are the owner"; an owner may still appoint another owner, because a company with one owner needs
some way to gain a second.

**AN ADVISOR IS A VIEWER, ALWAYS.** The attribute exists so somebody can be in a company without
occupying a seat. A seat-free editor would be the seat model with a hole in it — and a free advisor
tier would be that hole with a price of nothing, which is why there is no free advisor tier either.
The floor is arbitrage: the cheapest marginal seat is Solo→Collaborative at about $30 a seat, so
advisor has to sit clearly above that or it becomes the cheap seat.

**ADVISOR SCENARIOS ARE A PERSONAL LAYER** (028), not a permission. Sharing is an OFFER: an advisor
cannot write the company's document at all, an owner accepts or declines, and accepting is then an
ordinary save made by the owner through `save_document` with their own permissions, version check and
audit row. An import that bypassed the normal write path would be a second way into the document, and
this schema has spent considerable effort having exactly one.

**TAB VISIBILITY IS THREE LAYERS** (030), and the order is the design:

- **company** — the owner decides which tabs this company uses. On the COMPANY ROW, not in the
  document, because an editor can write the document and a setting an editor can change is not an
  owner's setting.
- **personal** — each member hides what they do not want from what remains. Per device, unchanged.
- **role** — Scenarios is shown to owners, admins and advisors; not to editors or viewers.

Neither of the first two overrides the other: a member cannot un-hide what the owner turned off, and
the owner cannot force a tab back onto somebody's own screen. The Dashboard survives all three, because
it is the fallback when a view disappears.

**AND THE ROLE GATE FAILS OPEN WHEN THE ROLE IS UNKNOWN**, caught by an existing test the moment it did
not. This gate is focus, not access control — the engine ships to the browser, so hiding a tab protects
nothing — which makes a tab missing because a role had not loaded a worse failure than one briefly
present. Real read restrictions need 3.8.

**AND AN ADMIN CANNOT REMOVE ANOTHER ADMIN** (029). Left open by 027 as a separate question, now
answered: an admin who cannot appoint an admin but can remove one has a lateral attack — take out the
other admins and you are the only one left holding a role you could not have granted yourself. Both
rules now call the same `may_grant`, and a test asserts appointment and removal agree for every pair of
roles, so they cannot drift apart again.

## Team invitations — what was decided, 29 Jul 2026

**NO EMAIL IS SENT.** An invite produces a LINK, once, and the inviter sends it however they already
talk to that person. Not a shortcut around building email: it avoids adding an email subprocessor to a
product whose privacy documents are at review, and it works today. Delivery by email later is an
addition to this rather than a replacement.

**THE TOKEN IS STORED AS A SHA-256 HASH.** It is a bearer credential to somebody's payroll; a leak of
the table with raw tokens in it would make every outstanding invitation usable by whoever read it.
`sha256()` is built into Postgres, so no extension. The raw token exists only in the response that
creates it — `list_invitations` cannot return it, deliberately, because a link re-readable from a list
outlives the moment it was meant for.

**THE INVITE IS BOUND TO AN EMAIL ADDRESS.** Accepting requires being signed in AS the invited address,
so a link forwarded into a group chat is useless to everyone in it. The cost is that somebody who signs
up with a different address gets refused; for a document holding salaries that is the right way round,
and `wrong_email` is a distinct error with its own message because that person is real and holds a real
invitation.

**THREE ESCALATIONS ARE BLOCKED**, and each would make the others decorative:
- Nobody may grant a role above their own — an admin who can mint owners promotes themselves by
  inviting their own second address.
- An admin may not demote or remove an owner.
- The last owner cannot be demoted, removed, or leave. A company with no owner cannot invite, cannot be
  deleted, and cannot be repaired by the customer.

**ONE ERROR FOR FOUR CASES.** "No such invitation", "already used", "revoked" and "expired" all raise
`invalid_invitation`, because a caller holding a token should not be able to learn which — the
difference is exactly what somebody probing tokens would want.

**A BUSINESS DECISION IS NOW LIVE AND UNPRICED.** Pricing is per ACCOUNT, so a Solo plan at $40 can now
have unlimited members. The previous plan anticipated this: "seats become a real question again at Phase
3, and the shape to reach for then is a seat count on the SUBSCRIPTION, not on membership." Worth
deciding before it is discovered by a customer with a large team.

## The advisor screens — 29 Jul 2026

Four of five built. `Members` tags, `CompanyTabs`, `OfferedScenarios`, `Portfolio`, plus migration 032
carrying `is_advisor` and `has_seat` on the member row and `list_advised_companies()`.

**THE REVIEW SCREEN GOT MUCH CHEAPER THAN EITHER OF US EXPECTED**, because the premise was wrong. A
scenario is not a copy of the model — it is `{ name, patches }`, an overlay (`engine/scenario.js`
line 6). So the patches ARE the diff, `describePatch` already renders each as a sentence for the
Scenarios screen, and importing is appending one small object to `doc.scenarios`. The
`diffDocuments` function proposed for this is not needed and was never written.

**ACCEPTING IS TWO OPERATIONS AND ONE BUTTON**, which is the only part with a real failure mode:
`decide_scenario` records the answer, then the scenario is saved through the ORDINARY write path by the
owner. Those can come apart — recorded, then the save conflicts — so the screen says exactly that and
notes the offer will not reappear, rather than reporting a success that half happened.

**THE PORTFOLIO COMPUTES RUNWAY IN THE BROWSER**, using `runwayMonths` — extracted from
`docsummary.js` so the dashboard headline, the review screen and the portfolio share ONE answer to
"when do we run out". Rows appear as each document arrives rather than after the slowest, and a
company whose model fails to load is marked as unreadable rather than left looking healthy, which is
the failure the panel exists to prevent arriving from inside the panel.

It renders nothing below two companies: a list of one is a screen that exists to justify a price.

**ALL FIVE BUILT.** The workspace (`AdvisorScenarios`) REUSES the Scenarios view rather than growing a
second editor — that view was already parameterised on `{ scenarios, setScenarios }`, so what differs is
only where it reads and writes. Two consequences worth keeping:

- **`Apply to plan` is now ABSENT without a handler, not inert.** An advisor cannot write the company's
  model at all, and a button that quietly did nothing would be worse than one that is not there.
- **Edits are DIFFED against what was loaded**, because there is no bulk RPC and saving every scenario
  on every keystroke would be one request per patch. Local state moves first so the editor stays
  responsive; a failed write reloads rather than leaving the screen showing something the server refused.

**Migration 033 made the tab gate real.** `tabIsVisible` had been failing open since it was written
because nothing told it who was looking — `my_membership()` is the one call that answers role, advisor
and seat together, and it now feeds both the nav and the Scenarios branch.

TWO BUGS FOUND WHILE WIRING IT, both mine and both invisible to the type system: `switchCompany` takes
`(auth, id)` and I had called it with one argument in two places, including the invite-accept path; and
the membership effect was placed after DocumentHost's early returns, which broke 37 view tests at once
with "Rendered more hooks than during the previous render". Hooks before returns, always.

## Phase 5 — UI polish

Every tab and sub-tab carrying the analytics and the graphics it deserves. Not a rewrite: the engine
already computes more than the screens show, so most of this is surfacing numbers that exist rather
than calculating new ones.

Deliberately last, and worth saying why: polish is the work that always *feels* productive, so it is
the easiest thing to do instead of finding a customer. It also has a dependency the earlier phases do
not — **you cannot tell which screens deserve the attention until somebody is using them.** The funnel
shipped today is the instrument for that: it will say where people stop, and that is a better
prioritiser than taste.

Two things to carry into it when it starts. The engine ships to the browser, so nothing here is gated —
polish is not a tier. And the golden number is the contract: any chart that restates the runway must
agree with 5.6, or it is a second implementation of the projection wearing a nicer hat.

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
