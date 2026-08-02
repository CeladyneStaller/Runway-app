# Runway — extracted

`npm install && npm run dev` → http://localhost:5173 · `npm test` → ~1,000 passing, isolation probes skipped · `npm run verify:isolation` → 15 probes against a real database, all passing as of 29 Jul 2026 · `npm run lint` → oxlint

**Daily use is the built app, not the dev server:** `npm run build && npm run preview` → **:4173**.
Note the port. **IndexedDB is origin-scoped**, so a model built on `:5173` is invisible on `:4173` and
vice versa. Pick one and stay there, or move between them with Export/Import.

## What this is

A cash-runway model for a company with grants, purchase orders, payroll and a capital stack.
It runs in TWO MODES from one codebase: hosted (Supabase — accounts, multi-company, billing) when
`VITE_SYNC_ENABLED` and the keys are set, and local-first (IndexedDB, no account, no network call)
when they are not. Local is a supported mode, not a degraded one — `state/storage.js` is the seam
that makes the difference two functions wide.

## Layout

```
src/engine/     2,884 lines across 26 modules, ZERO React. The whole model. Test it in isolation.
src/views/      28 components (13 views + 15 under chrome/)
src/state/      document.js (the shape + migrations) · storage.js (THE SEAM) · backends/ · auth · sync
src/seed.js     the demo company — explicitly loaded, never a default
supabase/       14 migrations + 4 Edge Functions (account deletion, Stripe webhook/checkout/portal)
test/           82 files, 905 tests: the golden runway, every accounting identity, renders, RLS probes
```

## The golden number

```
5.6 mo · zero Dec 20 2026    committed + expected
10.9 mo · zero May 26 2027   + speculative
18+ mo · cash-flow positive  + financing
```

`test/engine/golden.test.js`. **If this moves, something changed — find out what before continuing.**
It is asserted both against the engine directly and through the rendered DOM.

## The rule, enforced

**`src/engine/` must never import React** — or views, or state, or seed data. `npm run lint` enforces
it via `no-restricted-imports` scoped to `src/engine/**`. A rule enforced by eye is a rule that lasts
until someone is in a hurry.

`npm run lint` should stay at **0 errors**. Warnings are signal, not noise — mostly
`react-hooks/exhaustive-deps`, which is worth reading before silencing.

### Why oxlint and not ESLint

Both handle the two rules this project actually needs (`no-restricted-imports` scoped to the engine,
`no-restricted-globals`), so it came down to what each one *found*:

| | ESLint 9 + plugins | oxlint 1.74 |
|---|---|---|
| lint this repo | 3.5 s | 1.3 s (mostly npx startup) |
| `exhaustive-deps` findings | 6 | **17** |
| config | flat config importing 4 packages | one `.oxlintrc.json` |
| install | ERESOLVE peer conflicts, needed `--legacy-peer-deps` | clean |
| custom rules | yes | no — but this project needs none |

oxlint's `exhaustive-deps` caught a real bug that ESLint's `react-hooks@4` missed: `derivedBurn` read
`hist` without declaring it, so the baseline would not have recomputed when history changed. That was
a bug introduced *during the extraction*, twenty minutes old, invisible to 86 passing tests.

**Switch back to ESLint if you ever need a custom rule** — an invariant that `no-restricted-*` cannot
express. Nothing here does today.

### Two rules that carry their reasons

- **`no-restricted-globals`** on the confusing browser globals (`CSS`, `name`, `status`, `length`,
  `event`, `history`, `location`, `top`, `find`, `open`, `close`…). `no-undef` cannot help here **by
  definition** — these are real globals. This is the rule that catches `const CSS` being deleted while
  `<style>{CSS}</style>` stays behind.
- **`react/no-unescaped-entities` is off, deliberately.** Every hit was an apostrophe in on-screen
  prose. Eighteen false alarms train you to ignore the linter.

## The multi-user seam

`src/state/storage.js` is two functions, `load()` and `save(doc)`. Nothing outside it knows IndexedDB
exists. When accounts arrive: an auth provider, `documents(id, owner_id, schema_version, body jsonb,
updated_at)`, and this file becomes `fetch("/api/doc")`. Nothing else changes.

Until then: no auth, no user IDs, no tenancy columns, not even a `userId: null`. Add it when a user exists.

## Things this codebase knows

- **Financing is a SEPARATE axis from the revenue tiers, and both switches now live on the dashboard.**
  A round/instrument's lines are all tagged `financing: true` and `buildProjection` skips them unless
  `toggles.financing` is on (projection.js: "Financing is orthogonal to confidence so a $6M raise cannot
  drown a $480k quote in one trace"), gated a SECOND time by the instrument's own tier (`INST_CONF`:
  planning/raising → speculative, committed/term-sheet → expected, closed → already in cash). So a future
  (planning/raising) round needs BOTH `financing` AND `speculative` on. The financing switch was
  originally only in the Investment tab (the "Financing is its own switch" callout); it's now ALSO on the
  dashboard's Revenue confidence panel — but rendered as a DISTINCT control BELOW the three tiers
  (`.fin-toggle`, separated by a top border, `--signal-2` blue dot/switch instead of the tiers' green),
  NOT as a fourth `.tier`, so the orthogonality stays legible. Both controls call
  `setToggles(t => ({ ...t, financing: !t.financing }))` on the same field, so they're inherently synced.
  The dashboard toggle shows the count of instruments financing governs (distinct `instId`s in
  `roundLines`; the demo's closed SAFE contributes none since its cash is already in hand). Tests
  `test/views/financing.test.jsx`.
- **The upside/speculative ghost line (`rowsUp`) must react to the financing toggle.** `rowsUp` is built
  from `allOn = { committed:true, expected:true, speculative:true, financing: toggles.financing }`, so it
  is meant to track financing — but its memo `modelRowsUp` was keyed on `[model]` alone, and `model`
  does NOT change when financing toggles (the fundraise lines always live in the model; the toggle gates
  them at projection time). So the speculative line was frozen at its first-render financing value. Fixed
  by keying the memo on `[model, toggles.financing]`; the rest of the chain (`rowsUp`→`zeroUp`→`upsideGap`
  →`showUpside`) flows from that reference and needed no change. SEMANTICS to remember: with financing on
  and speculative off, the raise appears in the speculative line but NOT the main line WHEN the raise is
  speculative-tier (the demo's planning-status Series A is — so it needs both gates). A committed/term-
  sheet raise is expected-tier and would lift both lines. `data-trace="upside"` hook + a stateful-harness
  regression test (toggling financing must move the line) guard it; verified by reverting.

- **`HORIZON` is 36 months (was 18).** Extended cleanly because the constant is well-factored: every
  usage is a `horizon = HORIZON` default, a `HORIZON + 1` array length, a `Math.min(HORIZON, …)` cap, or
  a `<= HORIZON` loop — all auto-follow. The golden held (5.6 and 10.9 are finite and inside both windows;
  the financing scenario stays null because it's genuinely cash-flow-positive across 36 months, not just
  un-crossed within 18). Two things needed hand-fixing: (1) hardcoded `"18+ mo"` / `"18-month"` display
  strings in `App.jsx` — now derived from `HORIZON` (`${HORIZON}+ mo`) so they won't re-break; (2) the F8
  boundary tests in `identities.test.js`, which pinned 18 as the horizon edge — now parameterized against
  `HORIZON` (`HORIZON + 3`, `deliveryMonth: HORIZON`). The chart's `tMax` is DYNAMIC (a bit past the last
  event, floor 12, capped by `rows.length`), NOT `HORIZON` — so a cash-positive company still shows ~12
  months and the extension only widens the view when there's a late crossing/milestone to show; tick
  spacing is adaptive (2/3/6 mo) so the wider window stays readable. New golden guards: `HORIZON === 36`
  and "a crossing past month 18 is detected, not treated as cash-positive" (the whole point of extending).
- **`.env.example` is a TEMPLATE Vite never reads.** Putting real values there gives
  `import.meta.env.VITE_SUPABASE_URL === undefined`, `createClient()` throws "supabaseUrl is required",
  and because that runs before render the whole app is a BLANK PAGE. Values go in `.env` (gitignored;
  `.env.example` stays tracked and blank via `!.env.example`). The original `.gitignore` had `*.local`,
  which covers `.env.local` but NOT `.env` — real keys would have been committed.
- **Guard `createClient()` with `syncConfigured()`, not just `enableHostedSync()`.** The fallback-to-local
  logic lives inside `enableHostedSync`, but the SDK client was being constructed BEFORE that call, so a
  misconfigured env threw past the guard and blanked the page — defeating the "half-configured must never
  stand in for working" property the guard exists to provide. A guard placed after the thing that can
  throw is not a guard.
- **An untouched brand-new document is never written back.** `load()` on an empty account sets
  `_lastWritten` to the fresh `emptyDoc()`, so the debounced save sees no change and stays quiet.
  Without that, signing in silently created an empty document row 400ms later, which made the account no
  longer `isNew` — permanently suppressing the offer to adopt a model left in this browser after a single
  reload. Found via a FLAKY TEST: the assertion waited on write COUNT, which was already non-zero from
  that spurious write. Lesson worth keeping — wait on CONTENT, not on counts; a count can be satisfied by
  a write you did not mean.
- **Cross-tenant isolation is verified against a REAL project, not a fake.** `test/security/tenant-isolation.test.js`,
  run via `npm run test:isolation`, SKIPPED unless `SUPABASE_TEST_URL` + anon key + two test accounts are
  in the environment (so `npm test` stays offline). Everything else in this repo tests intent; this asks
  Postgres whether it actually refuses. Probes: B cannot read A's document (RLS denial is ZERO ROWS, not
  an error — an empty array is the pass), B cannot WRITE to A's company even with a valid session
  (`can_edit` inside the definer function must refuse), A's document is unchanged after that attempt,
  `memberships` is unreadable by anyone (no grant, by design), and an anonymous caller gets nothing.
  Needs email/password sign-in enabled — magic links are passwordless and cannot be scripted.
- **The suite now exceeds a 250s sandbox command timeout as a whole** (55 files, ~495 tests). It passes in
  halves — `npx vitest run test/engine test/state` then `test/views test/security`. Not a failure, an
  environment limit; a real machine runs it in one go.
- **Adopting a model stranded in the browser.** Signing in switches reads to the server, which makes a
  locally-built document INVISIBLE — not deleted, but invisible, and nothing else in the app would ever
  mention it again. `peekLocal()` reads this browser's copy regardless of which backend is active, and
  `views/chrome/AdoptLocalDialog.jsx` offers it back with the same headline summary the conflict dialog
  uses (shared via `chrome/docsummary.js` — two drifting copies of "what does this document contain"
  would be a bug waiting to happen).
  OFFERED ONLY WHEN THE ACCOUNT IS EMPTY (`load()`'s `isNew`). If the server already holds a document,
  offering to replace it with whatever is in this browser is not a migration, it is a conflict — and a
  conflict does not get a cheerful blue button. Also skipped for an empty shell (`hasSubstance`) and in
  local mode. NEITHER answer deletes anything: upload leaves the browser copy exactly where it was,
  declining is remembered in IndexedDB (`runway:adoption-dismissed`; asking once is help, asking every
  load is nagging), and a failed upload keeps the offer open with the local copy intact. JSON export is
  offered inside the dialog as the third way out. Tests `test/views/adopt.test.jsx`, mostly about when
  NOT to offer.
- **Conflicts are RESOLVED, not just detected.** The storage layer halts on a version-precondition
  failure and holds this device's work, but until now the sync pill said "Changed elsewhere" and there
  was no way out — a dead end. `resolveConflict("mine"|"theirs")` settles it, and both answers are
  non-destructive: "mine" RE-READS FIRST so the retry carries the current version and actually lands
  (the server's copy is filed into `document_versions` by `save_document` before being overwritten);
  "theirs" returns the server document for the caller to adopt and sets `_lastWritten` to it, so the app
  reporting the adopted document does NOT immediately write it straight back. A failed resolve stays
  halted with the work still held.
  `views/chrome/ConflictDialog.jsx` shows the two versions side by side — runway, cash, headcount, line
  count, last saved — with only the differing rows highlighted. "There is a conflict, pick one" is
  unanswerable; four numbers people recognise make it a real choice. The destructive option ("use the
  other version") offers a JSON export of this device's edits first. Tests
  `test/views/conflict.test.jsx`, including that adopting does not trigger a rewrite.
- **RLS and GRANTs are TWO INDEPENDENT GATES, and 001 only did one.** Migration 001 enabled row-level
  security and wrote policies but granted the `authenticated` role nothing, so every query died with
  `permission denied for table memberships` (403) and the policies were never even evaluated. The two
  fail DIFFERENTLY, which is how to tell them apart: an RLS denial returns ZERO ROWS, a missing GRANT
  returns "permission denied for table". Fixed in `002_grants.sql`.
  POSTURE, deliberately stricter than the usual "grant all, trust the policies": `authenticated` gets
  SELECT and nothing else. There is NO insert/update/delete grant anywhere, so the only write path is
  `save_document` (SECURITY DEFINER, checks membership itself) — meaning a client cannot write a document
  without passing the version precondition, because it cannot write at all. And NO grant on `memberships`:
  `current_company()` answers the only question a client ever had about it, as definer. That also
  collapsed the client's old two-call "select memberships, else bootstrap" into ONE call whose
  create-if-missing path is atomic rather than racing two devices signing in at once.
  `alter default privileges` keeps future tables on the same posture without a follow-up migration.
- **DEMO MODE (`state/backends/demo.js`) — a working model that reaches nothing.** For customer
  acquisition: a prospect opens `#demo` or "Look around with sample data first" on the sign-in screen,
  gets the full app with the demo company, and NOTHING is written to the database or kept past the tab.
  The pluggable backend is what made this small: cadence, status, conflicts, scenarios and the journal
  all carry on working, and the only thing that changes is that a write goes nowhere durable.
  IT FIXED A LIVE BUG. Signed in, "Explore the demo company" was `setDoc(demoDoc())` — which the save
  effect wrote straight into the person's REAL account: a fictional company persisted forever, exactly
  the database clutter this change was asked to prevent. It now routes to demo mode.
  sessionStorage, NOT IndexedDB, and deliberately: a demo written to IndexedDB looks exactly like a real
  locally-built model, and the adoption flow would later offer to upload a fictional company into
  somebody's account. Using a store the app never reads for real documents makes that collision
  impossible rather than merely unlikely. Memory fallback when sessionStorage throws (Safari private
  mode) — a demo that resets on refresh is a nuisance, one that refuses to open is a lost customer.
  DEMO BYPASSES AUTH ENTIRELY, which is the point: requiring an account before you can see the product
  defeats a sales demo. The backend is installed in a `useState` INITIALISER, not an effect — DocumentHost
  calls `load()` the moment it mounts, and an effect runs after that, so the first read would hit the real
  backend and show "Couldn't open your model" to a prospect. An always-visible amber pill says
  "Demo · nothing is saved" with a way out. Tests `test/views/demo.test.jsx`, mostly negative assertions
  about what it must not touch.
- **`useLocalBackend` / `useHostedBackend` / `useDemoBackend` were RENAMED to `activate*`.** They are not
  hooks, and the use* convention invited a reader to see `activateDemoBackend()` inside a `useState`
  initialiser and assume a rules-of-hooks violation.
- **Account deletion: the Edge Function does ONE privileged thing.** `supabase/functions/delete-account`
  exists because removing an `auth.users` row needs the service key, which cannot live in a browser.
  Everything else — which companies are yours, what cascades — stays in `delete_my_data()` (migration
  004) running as the CALLER, beside the policies that already define ownership. The dangerous credential
  is therefore used for exactly one narrow act instead of a server function deciding on its own which
  rows belong to whom.
  FOUR THINGS THE FUNCTION GETS RIGHT, in order of how much damage the alternative does:
  (1) the user is identified from the JWT and NEVER from the request body — a body-supplied user id would
  let any authenticated caller delete anybody, and there is no user id in the request at all;
  (2) data is deleted BEFORE the auth row, because the reverse order leaves someone unable to sign in
  with data nobody can reach if step two fails;
  (3) CORS echoes a known origin or sends no header — `*` would let any page call this with a stolen
  token. CORRECTED LATER, and the correction is the lesson: the check read
  `ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)`, so an UNSET secret allowed every
  origin — the exact opposite of the comment sitting above it, and the state every fresh deployment
  starts in. An allow-list that permits everything until configured is a deferred decision nobody
  returns to, because nothing looks broken while it is wrong. The rule now lives in
  `supabase/functions/_shared/cors.js`, plain `.js` like `stripe-signature.js` and for the same reason:
  an `index.ts` importing Deno globals and esm.sh modules CANNOT BE REACHED BY THE SUITE, which is how
  a clause contradicting its own comment survived. It fails closed, drops a literal `*` so
  "allow everything" is not expressible, and says so in the log once per isolate — because the failure
  is otherwise invisible server-side, appearing only as a CORS error in somebody else's browser.
  Tests `test/engine/cors.test.js`, verified by reverting to the shipped clause (2 fail);
  (4) `auth_delete_failed` is reported honestly rather than as success, because the data really is gone
  and the person needs to know their sign-in is not.
  SHARED COMPANIES SURVIVE: only companies where you are the SOLE owner are deleted; where someone else
  owns it too you simply stop being a member. Closing your account must not destroy another person's
  data. Confirmation is the typed phrase "delete my account". Tests in `test/views/account.test.jsx`
  cover the honest-failure paths, including "not deployed yet".
- **Deleting a company: `abandonCompany()` deliberately does NOT flush.** It is the exact opposite of
  `switchCompany()`, and the asymmetry is the point. Pending work belongs to a company that is about to
  stop existing, so writing it first only pushes data into a row being deleted a moment later — and on a
  slow connection the write could land AFTER the delete and resurrect a document with no company.
  Dropping it is correct; the dialog is responsible for having offered an export before you get there.
  When the deleted company was the ACTIVE one, the app moves to another; when it was the LAST one, the
  selection is cleared and `current_company()` creates a fresh one, so nobody is left pointing at
  nothing. Owner-only (enforced in the RPC, and the button is hidden otherwise).
  Confirmation is the company name TYPED OUT, not an "are you sure" — re-typing is the one gesture that
  cannot be done on autopilot. The copy is careful about scope: it removes the company, model and every
  version, and it does NOT remove your sign-in, because deleting an `auth.users` row needs the service
  key and therefore an Edge Function that does not exist yet. Saying "account deleted" would be a lie,
  and a lie about deletion is the worst kind. Tests in `test/views/account.test.jsx`.
  TEST NOTE: the storage-level cases are HEADLESS. Rendering `<App />` re-populates the write buffer via
  its save effect the moment a document appears, which races every assertion about what is pending.
- **The empty-model screen has a "start from scratch" door.** `isEmpty` clears as soon as cash is
  non-zero, so typing a balance always WAS a way through — but nothing said so, and the only two
  buttons were the demo and an import. Someone who wanted to list their team first, or who did not yet
  know their balance, had no path at all. A `startedBlank` flag now overrides `isEmpty` without inventing
  any data (cash stays 0, no rows added). Demo demoted from primary (`rvbtn go`) to a secondary
  "Explore the demo company" — in a real second company, seeding someone else's fictional numbers is
  the LAST thing you want as the default action.
  Also fixed: the footer promised "No account, no server, no network", which stopped being true the
  moment hosted sync shipped. It now reads from `syncConfigured()`. Tests `test/views/emptystart.test.jsx`.
- **`src/main.jsx` ships LIVE, not commented out — and a half-started hosted build now refuses to open.**
  This caused a real production failure: the archive shipped `main.jsx` with the bootstrap commented,
  so every extraction silently reverted the person who had enabled it. With Supabase settings present but
  `enableHostedSync()` never called, no session provider registers, `gated` is false, and the app FALLS
  THROUGH TO LOCAL-FIRST — handing out access with NO SIGN-IN and writing to the browser instead of the
  account. Everything looked like it worked; nothing was where the user thought it was.
  TWO fixes, and both were needed. (1) `syncConfigured() && !getSessionProvider()` is now treated as a
  MISCONFIGURATION, never a mode: App renders an explicit "sync is configured but never started" screen
  naming `src/main.jsx`, rather than quietly running local. (2) The root cause — a SANDBOX STUB at
  `node_modules/@supabase/supabase-js` (the real package is blocked by the npm policy here) lets the
  build and suite compile the REAL bootstrap, so the archive can ship working code. The stub throws if
  ever called, lives in `node_modules` (stripped from every archive), and is overwritten by a real
  `npm install`. GENERAL LESSON: a template that must be hand-edited after every update WILL be reverted
  by an update; ship the working thing and stub what you cannot install.
- **Account page + multi-company (`003_profiles_companies.sql`, `views/Account.jsx`, `state/account.js`).**
  Reached from the email in the top bar, not the main nav — it is about you, not your runway.
  WHY IT EXISTS: a magic-link sign-in creates an account with NO password, and "reset your password" is a
  strange door to walk through when you never had one. `profiles.password_set_at` is what lets the page
  say something true instead of hedging — Supabase cannot tell you whether a user has a password,
  because a magic-link user and a password user both have an `email` identity. The password itself never
  goes near `mark_password_set()`; it only records that one now exists. Changing (as opposed to setting)
  verifies the old password by attempting `signInWithPassword` first — no server support needed, and it
  protects against a borrowed laptop. Skipped entirely when there is nothing to verify.
  MULTI-COMPANY NEEDED NO SCHEMA CHANGE: `memberships` was always many-to-many. What was missing was
  `list_companies` / `create_company` / `rename_company` and a notion of which company is ACTIVE. The
  active company is per-device (IndexedDB `runway:active-company`) because it is a view preference, not
  data; `set_last_company` also records it server-side as the fallback for a device that has never chosen.
  `current_company()` now prefers the remembered one, then oldest-first, then creates the first company.
  THE HAZARD, and the reason `switchCompany()` lives in storage.js rather than the view: it FLUSHES
  FIRST. A pending write belongs to the company you were looking at, and landing it after the switch
  files your numbers against the WRONG COMPANY. It then resets `_lastWritten` — a different company holds
  a different document, so the old value would suppress the first save in the new one. Both pinned by
  test. A newly created company is `isNew` by definition, so the adoption offer is suppressed on switch:
  filling a brand-new company with a stale browser model would be actively wrong.
  A TEST TRAP worth remembering: `waitFor(not /Checking your session/)` is satisfied by "Loading your
  model", so eight UI assertions ran against a half-rendered tree. Wait for the thing you need, not for
  a message you do not want.
- **Auth is now three screens: landing (toggle), choose-a-password, reset.** Password is the PRIMARY
  path and magic link is SECONDARY — the reverse of what security alone suggests, because passwordless
  depends on email being deliverable and a project without SMTP has no working link flow at all. Lead
  with what works; keep the better method visible for when it does.
  LANDING: an explicit `Create account` / `Sign in` segmented toggle, defaulting to Create (the state a
  first-time visitor is in). The old screen conflated the two and simply said "Sign in", so someone
  without an account had no way to know it was for them.
  `engine/password.js` holds the rules AS DATA (`passwordRules` -> `[{id,label,ok}]`), not as a score:
  a strength meter says you failed without saying what to change; a checklist says what to do. The bar
  in the UI counts the same list so the two can never disagree. Rules: >=10 chars, not in a common list,
  does not contain the email stem (skipped when the stem is under 4 chars, or `al@x.com` bans "al" in
  every password), and both entries match. These are a COURTESY, not enforcement — the real minimum
  belongs in the Supabase project settings; client validation only stops a submit the server would reject.
  `views/SetPassword.jsx` is ONE component for both creating and resetting — same rules, same confirm
  field, one place to be wrong.
  RECOVERY LANDING is the subtle one: Supabase hands you a real SESSION when you follow a reset link, so
  it is indistinguishable from an ordinary sign-in unless you read the `PASSWORD_RECOVERY` event. Without
  that, someone who came to change their password lands on the dashboard with no way to do it.
  `session.onChange` now passes `(session, event)` for exactly this.
  Sign-up reports `needsConfirmation` when no session comes back, and says so — with "Confirm email" on
  and no SMTP, the account exists but cannot be used, and silence there looks exactly like a broken app.
  Tests `test/views/password.test.jsx`.
- **The sign-in screen IS the sign-up screen, and now says so.** Magic link and Google both create the
  account if there isn't one — that was always true and the screen never mentioned it, which is a worse
  failure than a missing feature: someone with no account reads "Sign in", concludes it is not for them,
  and leaves. A screen that works but looks like it does not is indistinguishable from one that does not
  work. Heading is now "Sign in or create an account", the sent-link confirmation says it sets up the
  account, and there is an explicit "First time here?" line. `shouldCreateUser: true` is now passed
  EXPLICITLY rather than relying on the SDK default — account creation is the behaviour this product
  depends on, and depending on a default is how it silently stops working one library version later.
  A "signups disabled" provider error also gets a plain-language explanation pointing at the Supabase
  setting, since that message explains nothing to the person reading it.
- **THE AUTH GATE: in hosted mode the document is not requested until there is a session.** Without it
  the chain is `load()` -> `getAccessToken()` -> no session -> FORBIDDEN -> LOAD_FAILED -> "Couldn't open
  your model", which from the user's side is indistinguishable from a broken app. `App` now checks for a
  session first and renders `views/SignIn.jsx` (email magic link + Google) instead. In LOCAL mode this is
  a pass-through — there is nobody to be, the document lives in this browser.
  The gate is keyed on `getSessionProvider()` being registered, NOT on re-calling `syncConfigured()`:
  `enableHostedSync` only registers a provider when the config is complete, so the provider IS the signal.
  A test caught the alternative — re-deriving from `import.meta.env` gave two sources of truth for one
  fact, and they disagreed. `state/session.js` normalises the SDK's inconsistent return shapes
  (`{data:{session}}`, `{data:{subscription}}`, errors-as-values-not-throws) once, so the UI is written
  against something predictable; the SDK is still injected, never imported, so all of this is tested with
  a fake. SIGN-OUT resets the cached company via an `onChange` subscription wired inside
  `enableHostedSync` rather than in the button — otherwise the next person to sign in on that browser
  inherits the previous user's document, and a button is exactly the place that gets forgotten. Sign-out
  also flushes first, or unsaved work in the buffer is dropped silently. Provider errors are surfaced
  verbatim (e.g. "Email rate limit exceeded") rather than flattened into "something went wrong" — the
  failure that matters is somebody staring at a screen that will not say what is wrong. Tests
  `test/views/signin.test.jsx`, including the negative one: no document request before a session exists.
- **Auth adapter: `state/auth.js`, and the SDK lives in exactly ONE place (`main.jsx`).** The hosted
  backend needs two things — `getAccessToken()` and `getCompanyId()`. The token needs a session, which
  needs the SDK; the company id is just another PostgREST query, which does not. So `createSupabaseAuth`
  takes an injected `getSession` function rather than importing @supabase/supabase-js, which makes the
  entire auth path testable with no network and no package installed. `getSession()` is called on EVERY
  request rather than cached — that is precisely what makes refresh rotation work, with zero refresh
  logic in this repo. A missing session is FORBIDDEN (not retryable: retrying a signed-out user forever
  helps nobody); a session lookup that throws is UNREACHABLE (retryable). `getCompanyId()` reads the
  caller's own membership under RLS, ordered `created_at.asc limit 1` so a user in several companies
  resolves to the SAME document every load rather than whichever row the planner returned — a switcher
  is a later phase, but silently hopping between documents would be a data bug now. A signed-in user
  with no membership gets `bootstrap_company` called, so there is never an account with nowhere to put a
  document. `reset()` on sign-out, or the next user inherits the last one's company.
  `state/sync.js` composes auth + backend in one `enableHostedSync()` call and FALLS BACK TO LOCAL —
  saying why — if the flag, url, key or getSession is missing. Half-configured must never stand in for
  working. Tests `test/state/auth.test.js` + `test/state/sync.test.js`.
- **Backends are pluggable; the hosted one talks PostgREST over `fetch`, with NO SDK.** `state/backends/`
  holds `local.js` (idb-keyval), `supabase.js`, and `errors.js`. A backend is two methods —
  `read() -> {raw, meta} | null` and `write(raw)` — with null meaning "no document yet", which is NOT an
  error. `storage.js` keeps all the cadence, status and LOAD_* mapping and no longer knows where the
  document lives. Sync is OPT-IN via `syncConfigured()`: it needs all three of `VITE_SYNC_ENABLED="true"`,
  a URL and an anon key, because a half-configured hosted backend degrading into "there is no document"
  is the input to the clobber bug. No SDK because the document layer needs exactly two calls, so `fetch`
  keeps it dependency-free and bundle-free for local users; AUTH (magic links, OAuth redirects, refresh
  rotation) is genuinely hard and stays behind an injected `auth` interface that
  `@supabase/supabase-js` implements in the shell. Every write goes through the `save_document` RPC, never
  a bare PATCH — this file *cannot* issue a blind write.
- **Error classification is by KIND, never `instanceof`.** A test caught this: `instanceof BackendError`
  returns false across module registries (and would across a bundle chunk or a structured-clone
  boundary), which silently reclassified a CONFLICT as retryable — i.e. retried the write we had just
  refused, overwriting the other device after all. `kindOf(e)` duck-types on `.kind`.
- **Non-retryable failures HALT, and a halt does not un-ask itself.** Retry a dropped connection, never a
  conflict / stale-client / forbidden. A real bug surfaced here: the "something arrived mid-write"
  reschedule at the end of `flush()` re-fired regardless, quietly retrying a refused write through the
  back door. Fixed with a `_halted` flag; `save()` during a halt keeps the NEWEST edit but schedules
  nothing, and `resumeAfterHalt()` is explicit and writes that newest version. Tests
  `test/state/retrypolicy.test.js` + `test/state/supabase-backend.test.js`.
- **WRITE CADENCE LIVES IN `storage.js`, not the caller.** App used to own a 400ms `setTimeout` around
  `save()`. That is fine while writes are local and instant and wrong the moment they cross a network,
  where you need coalescing, no-op suppression and retry — none of which App should know about. `save(doc)`
  now SCHEDULES (it does not write); `flush()` forces a write; `status()`/`subscribe()` expose state.
  Behaviours pinned by `test/state/writecadence.test.js`: a burst of 25 edits produces ONE write and the
  LATEST value lands; re-saving an unchanged document writes nothing (a no-op push is not free over a
  network, and it makes "saved at" lie); two writes never run concurrently; a failed write KEEPS the
  pending document and retries rather than dropping it; an edit arriving mid-write is not lost.
  `SAVE_DEBOUNCE_MS` is 400 locally and becomes ~2500 when the backend lands; `MAX_UNSAVED_MS` (30s) stops
  a continuous stream of edits from starving the write forever. `_resetWriteState()` is the test seam for
  module-level state. NOTE the contract change: `save()` no longer returns a promise you can await for
  durability — tests must `save(x); await flush();`. One existing test had been passing on TIMING alone.
- **Unsaved state is visible (`SyncPill`).** Saved / Saving / Unsaved changes / Couldn't save, always
  shown rather than a toast: "is my work safe" should be answerable by looking, not by remembering
  whether something flashed. Flush on `visibilitychange -> hidden` (the one that fires reliably on
  mobile) and `beforeunload` (desktop backstop, and the only place a browser allows an unsaved warning).
  Tests `test/views/syncpill.test.jsx`.
- **`load()` returns a STATE, and nothing may be saved that did not come from a successful load.**
  This closed a LIVE data-loss bug, verified by test before fixing: a transient IndexedDB read failure
  made `load()` hand back `emptyDoc()`, and the 400ms debounced save wrote it straight over the real
  document. App's `.catch` was worse still — it set `demoDoc()`, so a read blip could overwrite someone's
  model with the demo company. `storage.js` now returns `{ state, doc }` with `LOAD_OK` / `LOAD_STALE`
  (document written by a newer build; the original is parked) / `LOAD_FAILED` (storage unreachable).
  "There is no document yet" is LOAD_OK with `isNew` — a first-time user must be able to save; "I could
  not read it" must never take the same path. App gates the save effect on `loadState === LOAD_OK` and,
  on anything else, renders an explicit error screen with a Reload button INSTEAD of an editable company,
  because an editable empty company is precisely what gets saved over the real one. This is a prerequisite
  for the hosted build (§2.3 of BACKEND-PLAN.md) where the same failure is routine — offline start, 500,
  expired session — but it was worth fixing on its own. Tests: `test/state/saveguard.test.js` (including
  one that reproduces the destruction without the guard) and `test/views/loadfail.test.jsx`.
  NOTE the build trap bit again: the error screen referenced `LOAD_STALE` without importing it, `vite
  build` was GREEN, the whole suite was green, and only a test that actually RENDERS the failure branch
  caught it. Build success still proves nothing.
- **ONE model assembly. App no longer rebuilds the projection model inline.** `buildModelParts(doc)` in
  `engine/buildmodel.js` is now the single assembly — fringe resolution, payroll lines, project rate
  resolution + fulfilment sync, baseline burn, sales/round lines, revenue-actuals replacement — returning
  `{model, ...intermediates}` so the UI gets `employeeLines`, `rProjects`, `itemizedOpex`, `baselineOpex`,
  `revenueVariances` etc. without a second copy. `buildModelFromDoc` is a thin wrapper over it, so
  scenarios/bands/labor are unchanged. App is 41 lines shorter and contains ZERO assembly logic.
  AUDITED BEFORE MERGING, which is the point: App was temporarily instrumented to expose its `allLines`,
  and both assemblies were compared across **272 combinations** (17 document shapes x 16 toggle sets,
  including prospective-project include/exclude, quadrupled history, flagged months, committed-status
  rounds, zero cash, manual fringe, baseline off). ZERO drift. Three cosmetic divergences were found by
  reading and confirmed harmless: App set `isBaseline` and `poRef`, both written and never read anywhere;
  and App's `avgSalary` used `empSalaryMoAt(e,0)` where the engine used `empCostAt(e,0,0)`, which is
  *defined as* `empSalaryMoAt(e,m) * (1+0)` — identical. The memo is keyed on `[doc]` wholesale, NOT on a
  hand-listed field set: field lists skip recomputes on unrelated edits but are exactly the unverifiable
  pattern behind three stale-memo bugs, and the saving is imaginary — MEASURED at 0.9ms for a document
  with 472 line items (60 staff, 40 projects, 120 POs, 36 months of history), well under a React render.
  Guarded permanently by `test/views/onemodel.test.jsx`, which asserts the rendered hero runway equals the
  engine's computation across 31 document x toggle combinations, through the public surface (no
  instrumentation). Verified it bites: making App's assembly silently disagree on baseline burn fails 4.
- **Hand-maintained hook dependency arrays are now MACHINE-CHECKED — `react-hooks/exhaustive-deps` is an
  ERROR, not a warning.** This bug class bit three times: `hist` vanished from a dep array during the
  extraction; `modelRowsUp` (the speculative ghost line) was keyed on `[model]` while reading
  `allOn.financing`, freezing the upside line whenever financing toggled; `modelRowsConf` (the
  "confident to <date>" floor) spread all of `toggles` but declared only committed+expected, freezing
  the floor on a financing toggle — invisible with the demo's planning-stage raise, but a signed term
  sheet changes the true answer from 5.56 months to "no crossing". The rule was ON the whole time and
  caught all three — as WARNINGS, buried in a 67-warning noise floor, which is the same as not catching
  them. ROOT CAUSE: memos consumed objects rebuilt every render (`allOn`, `{...toggles, speculative:
  false}`, `{columns, dateFormat, amountMode}`), so the only way to memoise was to hand-name the fields
  inside them — semantically correct if you get it right, and UNVERIFIABLE by the linter either way. FIX
  was structural, not per-bug: memoise the object (`allOn`, `confToggles`, `finToggles`, `profile`,
  `codeMap`, `customerMap`) and depend on the object. Dependents then say `[model, allOn]`, which a
  linter can check. `rowsFin`/`rowsNoRaise` likewise now depend on `model` instead of re-listing its
  ingredients. All 16 exhaustive-deps warnings are gone — fixed, not suppressed; there are ZERO
  `eslint-disable` comments in App.jsx, including in the journal's snapshot effect (its `dueForSnapshot`
  guard is what makes an honest `takeSnapshot` dependency safe). VERIFIED the guard bites: reintroducing
  the original `modelRowsUp` bug produces a lint ERROR. If a future memo reads an object it does not
  declare, the build tells you instead of the user finding it.
- **Recorded cash (`cashActuals`) is a DOCUMENT field — it was local `useState` and that was three bugs
  at once.** It was the only piece of state in App that broke the `const x = doc.x; setX -> setDoc`
  pattern: local `useState` seeded with the demo company's balances. Consequences, all verified before
  fixing: (a) nothing a user recorded survived a reload, because `setCashActuals` never touched the doc;
  (b) a brand-new user SAW the demo's $560,000/$467,000 in History -> Cash; (c) worst, `anchorActuals`
  defaults ON and anchoring shifts the whole forward curve to continue from the last recorded cash, so a
  fresh user with $100k burning $25k/mo was shown **8.32 months instead of 4.0**. This is the same class
  of bug NOTES already records for `history` ("a 1.3-month runway computed from a company they had never
  heard of") — it recurred in a different field and was missed. The demo values moved into `demoDoc`
  (note the field is `revenue`, NOT `rev` — the History cash tab reads `r.revenue`, and demoDoc had `rev`,
  which would have silently zeroed demo revenue on the switch). Only `.cash` is read by `anchorToActuals`,
  and it was identical across all three sources, so the golden was never at risk. Guarded by
  `test/views/cashactuals.test.jsx`.
- **`clampM` vs `floorM` are not interchangeable.** `clampM` is for select values and array indices.
  `floorM` is for placing money in time. Using `clampM` for placement drags out-of-horizon money onto
  the last visible month and inflates the ending balance. That was F8, and it lived in two places.
- **Fringe has two correct conventions.** Grants bill fringe as its own SF-424A category, so
  `empHourlyAt` is salary-only and right. Fulfilment margin has no such convention and needs
  `empCostAt` — loaded. That was F3.
- **Dates in the importer are parsed LOCAL, not UTC.** `new Date("2026-08-01")` is UTC midnight, which
  in any timezone behind UTC (all of the Americas) is the evening of July 31 — and `getMonth()` reads
  local, so the 1st of a month silently buckets into the previous month. Day-10 dates survive; day-1
  don't, which is why it passed in a UTC sandbox and failed on a US machine. `parseLocalDate` in
  `importer.js` pulls Y/M/D from the string directly for date-only values. The suite is run under
  `TZ=America/Denver` when checking date logic; `testTimeout` is 15s because the jsdom view tests have
  no margin at the 5s default on a loaded machine.
- **Buttons: the reset is scoped to `.rw button:not([class])`.** For five sessions the reset was
  `.rw button{background:none}` (specificity 0,1,1), which beat every single-class button rule (0,1,0),
  so solid buttons rendered as flat text. Fixed not by an `!important` arms race but by making the
  reset stop targeting classed buttons at all: `:not([class])` cannot match an element that has a
  class. `.addbtn` is solid (ink/white) with a `.ghost` variant; `.rvbtn` has a real base plus `.go`
  (signal) and `.no` (danger) intents — it previously had NO base style, only modifiers that never
  existed in CSS. Guarded by `test/views/buttons.test.jsx`. A bare `<button>` still gets the reset.
- **`sf424a.js` month-clamp — CLOSED (Gap-4).** `parseScheduleAoa` used `clampM` for a milestone
  payment's month, which capped a month-24 payment at 18, sliding a real payment onto the last visible
  month and inflating it. Swapped to `floorM` — keeps the real month (24 stays 24) so `buildProjection`
  (which iterates 0..HORIZON) lets it fall off the horizon, matching the `capital.js` pattern for
  payment placement. `clampM` is still imported and used elsewhere in the file for select-values.
  Tested: a month-24 payment stays 24, a month-2 kickoff stays 2 (`test/engine/sf424a.test.js`).
- **The demo's `cashActuals` drift ~$18.2k from the model on purpose** — it demonstrates the drift
  callout. Don't "fix" it.
- **The `.addbtn` solid style is dead** and nobody has decided between all-ghost and restoring
  specificity for primaries.

## Found during extraction

Three bugs the single file was hiding:

1. **`STAFFING` mutated `SEED_FULFIL` from inside the engine** — a module-level side effect that made
   engine depend on seed data. Invisible in one file; a dependency cycle as modules. Now in `seed.js`.
2. **`<style>{CSS}</style>` survived the CSS split** and silently resolved to the browser global
   `window.CSS` — React tried to render `{escape}` as a child. It built clean, because `CSS` is a
   valid global. A `no-undef` lint rule would have caught it; nothing else did.
3. **The old `sed`-based sweep addressed code by byte offset.** `History`, `Sales` and `Investment`
   all declared `useState("summary")`, so `sed 0,/…/` hit History every time and seven sub-tab tests
   silently rendered the wrong component while reporting green. `test/views/render.test.jsx` addresses
   components by name; that failure mode is now unreachable.
4. **`burnStats` imported the demo's `HIST` straight into the engine.** Found by the lint rule above,
   not by 86 passing tests. Consequence: *every* model was handed the demo company's six months of
   spend — a brand-new user entering $100k got a $78k/mo baseline and a **1.3-month runway computed
   from a company they had never heard of**. History is now a document field and a `burnStats`
   parameter. Regression test in `test/engine/document.test.js`.
5. **`derivedBurn` read `hist` without declaring it as a dependency** — introduced while fixing #4,
   caught by oxlint's `exhaustive-deps`. The fix exposed the structural cause: `model` was rebuilt
   every render, so every dependent memo listed its *ingredients* by hand instead of depending on it.
   Hand-maintained dep arrays are how `hist` went missing. `model` is memoised now and dependents say
   `[model, toggles]`, which a linter can verify.
6. **The splitter wrote false cross-view imports** — `CashFlow` importing `Payroll`, `Projects` and
   `Sales` importing each other (a cycle) — because it scanned **JSX text** for identifiers and those
   words appear in on-screen prose. All removed; `no-unused-vars` found every one.

## Dependencies & the audit

`npm audit` on the first cut reported **6 vulnerabilities (3 moderate, 2 high, 1 critical)**. Five of
the six were **one advisory wearing five hats**: esbuild's dev-server CORS issue
(GHSA-67mh-4wv8-2f99) propagating esbuild → vite → vite-node → @vitest/mocker → vitest. The "critical"
rating on vitest was inherited, not a distinct bug, and none of it shipped in `dist/` — it only affects
`vite dev`, where any site you visit in the same browser can read the dev server's responses.

Fixed by moving to **vite 8 / vitest 4 / @vitejs/plugin-react 6**. 6 → 1. Build got faster.

### The one that's left: `xlsx`

**SheetJS abandoned npm at 0.18.5.** The npm `xlsx` package is frozen there and carries
CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS). npm reports `No fix available`
because, from npm's point of view, there isn't one — the fix lives only on the vendor's own CDN.

`package.json` now depends on `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, which is SheetJS's
official instruction. **This was not installed or tested in the sandbox this project was assembled in
— that host cannot reach cdn.sheetjs.com.** The five tests in `test/engine/sf424a.test.js` are the
check: run `npm install && npm test`. The API surface at risk is small and stable across these
versions — `XLSX.read`, `XLSX.write`, `utils.{book_new, book_append_sheet, aoa_to_sheet, sheet_to_json}`.

If the CDN is unreachable, **vendor it** — which SheetJS recommends anyway, to decouple from their
infrastructure:

```bash
curl -O https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
mkdir -p vendor && mv xlsx-0.20.3.tgz vendor/
git add vendor/xlsx-0.20.3.tgz
npm install file:vendor/xlsx-0.20.3.tgz
```

**Why it matters here specifically.** The advisory says workflows that only *write* spreadsheets are
unaffected — the vector is *reading* a crafted file. This app reads SF-424A workbooks, and the whole
point is that they come from elsewhere: a subrecipient, a program officer, a partner. That is exactly
the exposure. Being local-first bounds the blast radius to your own tab — no server, no other users,
nothing to pivot to — but "bounded" is not "none", and the fix is one line.

## Why sf424a is not in the engine barrel

`src/engine/index.js` re-exports every engine module **except `sf424a.js`**, and that is deliberate.

SheetJS is 7.3 MB on disk and **432 kB of a 793 kB bundle — 54% of it**. It is needed only when someone
imports or exports a workbook. One `export * from "./sf424a.js"` in the barrel meant that
`import { buildProjection } from "../engine"` dragged all of SheetJS into the main chunk, so every page
load paid for a feature almost nobody uses on any given visit.

```
BEFORE   index  793.25 kB  gzip 240.76 kB   one chunk, everyone pays
AFTER    index  363.16 kB  gzip  97.50 kB   <- initial load, 60% smaller
         xlsx   424.70 kB  gzip 141.48 kB   <- fetched on first workbook touch
         sf424a  10.17 kB  gzip   3.64 kB
```

**Import it directly and dynamically:**

```js
const { importWorkbook } = await import("../../engine/sf424a");
```

If you ever add it back to the barrel, the bundle silently doubles and nothing fails. That is the whole
hazard: a barrel file makes a heavy dependency look free.

## jsdom is not a browser

`test/setup.js` stubs the two things it lacks that this app uses. Both were printing stack traces on a
*passing* run, which is how you train yourself to stop reading test output:

- **`fake-indexeddb/auto`** — real IndexedDB semantics in memory. This is not silence: it's why
  `test/engine/storage.test.js` exists at all. The seam had no coverage because nothing could exercise
  it, including the case that matters most — an unreadable document must be *parked*, not dropped.
- **Downloads** — jsdom has no `createObjectURL` and treats an anchor click as navigation, reported
  asynchronously so it surfaces in an unrelated file's output. Anchors carrying `download` now no-op.

## Known gap

**`exportBudget` and `importWorkbook` are not inverses — BY DESIGN, not a gap.** Export writes a
submission-ready SF-424A for a program officer (Section A/B headers, justification formatting); import
reads the DOE justification *template*. Different artifacts, different audiences (outbound-to-funder vs
inbound-from-template), like "render an invoice PDF" vs "parse a vendor invoice". Forcing a round-trip
would degrade both. The export is so intentionally non-importable that `importWorkbook` bails on a
re-read of its own export entirely — confirmed while closing the sub-gap below. `test/engine/sf424a.test.js`
keeps `does not round-trip its own export` as a passing guard that flips the day the formats converge.
CLOSED sub-gap (Gap-4): the export WRITES "Funder" and "Billing" rows into the Cost Categories sheet,
but import used to ignore them (returned only `{periods, categories, costSharePct}`). `importWorkbook`
now also recovers `funder` and `reimburseTiming` (reversing `TIMING_LABEL`) WHEN THOSE ROWS ARE PRESENT
— a template-only import still returns the original shape with those keys absent, so nothing is invented.
`modals.jsx` prefers recovered terms over the UI billing selector. Tested by injecting the rows into the
importable `celadyne.xlsx` fixture and re-importing.

*(closed — spend history is editable under **Spend history → Burn**. Months are ordered oldest → newest
and **position is the date**: labels derive from the projection start rather than being typed, so they
follow `startY`/`startM` instead of the hardcoded `’26` they used to carry. `flagOverrides` is keyed by
index, so deleting a month rebuilds the map — otherwise an override on month 3 silently starts
excluding month 4. Covered by `test/views/history.test.jsx`.)*

## Coded spend ledger (schema v2)

Company spend is a **coded ledger**, not a monthly total: `history[i] = { month, lines: [{ code,
amount, note }] }`. A `codeMap` on the document (`{ code -> projectId | "overhead" }`) routes each code
to a project. This is the shape a QuickBooks class export arrives in, so the manual editor
(Spend history → **Ledger**) and the eventual QB import are the same code path.

How it flows (`src/engine/coding.js`, tested in `test/engine/coding.test.js`):
- **Coded lines → project actuals**, derived not stored (`codedActuals`). A code mapped to a project
  fills that project's `costToDate` and drives its budget tag.
- **Uncoded + overhead-coded lines stay in the company baseline** (`overheadByMonth`) — so the
  measured-burn "$78k bank vs $67k line items" gap survives coding untouched.
- **`monthTotal` is the derived monthly total**, kept as `h.v` on burnStats rows so the chart and burn
  math never learned months became ledgers.
- **Manual override** (`project.actualsOverride`) wins per month and is meant to redistribute WITHIN a
  project. `effectiveActuals` flags it (`override ≠ coded` on the collapsed header) only when the
  override changes the project's *total* — redistribution is silent, invention is loud.

Migration v1→v2 turns each `{ mo, v, note }` into a one-line ledger; totals are preserved exactly
(verified: the demo's 72/76/74/108/70/62 are unchanged). Unmapped codes surface in a panel at the top
of the Ledger tab and sit in overhead until assigned.

The per-project override editor now exists: expand any real project on the Projects tab → **Recorded
spend**. It shows each coded month (Coded vs Recorded), writing `actualsOverride` per month. Redistribute
freely; the moment the override total diverges from the coded total, an amber note fires — that's a
changed total, not a redistribution. One shared `ActualsOverride` component in all card types, fed by
an `ActualsCtx` (so it reaches `setProjects` without threading through four signatures). Tested in
`test/views/override.test.jsx`, including that a same-total redistribution stays silent.

## Project actuals (Wave 3, started)

Projects now carry `actuals: { [month]: spend }` — the same shape as `cashActuals`. This backs the
collapsed project headers (Projects tab, fold button top-right of each card) and their budget tag,
which has **three** states, not two:

- **over** — recorded spend exceeds the whole budget.
- **at-risk** — under budget overall, but ahead of what the cost lines say you'd have spent by the last
  recorded month. On budget today, tracking over. This is the state that needs the projection, not just
  the total, and it's the one worth having.
- **on-budget** — at or under plan. No actuals => no tag; a tag invented from no data is worse than none.

`src/engine/summary.js` is the pure core (`projectSummary`, `budgetTag`), fully tested in
`test/engine/summary.test.js`. Coded ledger spend fills project actuals automatically, and the per-project
override (Projects → expand → Recorded spend) handles redistribution. Direct hand-entry of raw
`p.actuals` was retired in favour of coding. Gap-4 CLOSED the one real hole here: a project with NO coded spend had no way to record actuals at all (the empty state just told you to code ledger lines). The override editor now shows a "+ Add a month" affordance in BOTH the empty and populated states, seeding an `actualsOverride` entry (`nextMonth()` picks the first unused month 0..HORIZON) — this extends the override mechanism, it does NOT resurrect the retired parallel `p.actuals` field. Tested in `test/views/override.test.jsx` (an empty-state project can record a month).

## Cost-share reconciliation (DONE — closed the Piece-1 unfinished business)

`src/engine/costshare.js` (`costShareReconciliation`), tested in `test/engine/costshare.test.js`. "Did
the grant's required match get spent?" — answered by PURE DERIVATION, zero new user input:
- REQUIRED side = grant budget × costSharePct, already computed per period + per category by
  `computeGrant` (`per[i].costShare`, `per[i].personnel * cs`, etc).
- RECORDED side = ledger cost lines coded to the grant (Piece 2 resolution), split by period (explicit
  `period` field, else the month's period) and category (`category` field, Piece 1).
- TIER-1 inference for the one thing the ledger can't know — which recorded spend is the non-federal
  match: assume the same costSharePct of recorded grant spend counts (labelled as an estimate). TIER-3
  category breakdown falls out of the `category` on each line. (Tier-2 optional per-line match flag was
  deliberately NOT built — the user chose fully-derived, zero-friction.)
- Returns null for non-grants / 0% match, so the UI self-hides. Overall + per-period + per-category.
UI: `CostSharePanel.jsx` in the expanded grant card (via `CostShareWrap`, parallel to ProjectChartWrap;
pulls hist/maps from ActualsCtx). Renders nothing for projects without a match. Tests
`test/views/costshare.test.jsx`. This capital-C Closes the "category/period captured but unused" debt
from Piece 1.

## Scenarios (DONE — Architecture 1: overlay patches, NO reducer)

The `useReducer` migration was DELIBERATELY NOT done — scenarios don't need it, and doing it alone was
busywork (the ~20 setters are already pure immutable updates). Instead, Architecture 1: a scenario is
overlay patches over a base doc; the existing engine runs on the result.
- `src/engine/scenario.js` — a scenario is `{ id, name, patches[], saved }`. Three patch kinds:
  `field` (top-level), `toggle` (settings.toggles.*), `item` (one collection item by id+field —
  "delay THIS hire", "award THIS grant"). `applyScenario(base, scn)` deep-clones base + applies patches
  (base NEVER mutated). Empty scenario = faithful copy = golden-safe. Stale patches (deleted item)
  degrade to no-op. `PATCH_SCHEMA` declares patchable fields+types per collection (drives the builder).
  Tests: `test/engine/scenario.test.js`.
- `src/engine/buildmodel.js` — `buildModelFromDoc(doc)` reproduces App's inline model assembly (fringe
  resolve, project rates, baseline burn, revenue replacement) as a PURE function, so a scenario runs
  through the IDENTICAL pipeline. Pinned by `test/engine/buildmodel.test.js`: the demo doc through it
  hits the golden 5.6mo. (App still has its own inline copy; buildModelFromDoc could de-dupe it later.)
- `src/views/Scenarios.jsx` — dedicated view. Generic patch builder (collection→item→field→value),
  side-by-side runway compare (base + up to 3 scenarios as overlaid curves + zero-date deltas), save or
  throwaway. Persists via `doc.scenarios` (emptyDoc spread, no migration bump). Tests
  `test/views/scenarios.test.jsx`.
WATCH: zeroInfo returns {months:null} for cash-positive OR past-horizon — a directional test must keep
the runway finite (lower cash, don't raise it).

## Next

## Confidence bands (DONE — tier bracket + measured burn-variance, NOT Monte Carlo)

`src/engine/band.js` (`confidenceBand`, `burnVariance`), tested `test/engine/band.test.js`. The runway
becomes a RANGE, from two HONEST sources of width:
- REVENUE range from the confidence tiers (which already exist): floor = committed only, expected =
  committed+expected (the base/golden case), ceiling = +speculative. No invented probabilities.
- COST range from MEASURED historical burn variance (the user's "derive uncertainty from real forecast
  error" idea, applied where data exists): coefficient of variation of raw monthly burn widens the
  floor (costs ×1+cv) and narrows the ceiling (×1−cv).
Deliberately NOT Monte Carlo: needs per-line probabilities the model doesn't have, and there's NO
stored history of past REVENUE forecasts to measure revenue error against (only cost, via burnStats).
The honest sequel would be a "projection journal" storing snapshots over time -> real intervals later.
DESIGN BUG the tests caught: `burnVariance` first computed CV from burnStats' FLAG-FILTERED months —
but flagging exists to EXCLUDE outliers, which erases the very scatter we're measuring. Fixed to use
RAW monthly totals (trimming only the single most extreme). Financing stays orthogonal (shifts all
curves, not part of the band). UI: shaded region between floor/ceiling on RunwayChart + range in the
hero + a toggle + an ALWAYS-ON honesty caption ("reflects which revenue lands, widened by ±N% spend
variance — not statistical probability") + a wide-band callout. Tests `test/views/band.test.jsx`.

**Band ALIGNMENT (fixed — the band must be sampled AND anchored exactly like the main line, or it
visually drifts).** Two independent offsets had the shaded region not centering on the projection:
(1) the chart sampled the band with `{t: idx, b: r.end}` while the main line uses `clip(traceOf())` =
`{t: m, b: r.start}` + a final end point + a clip to `tMax` — so the band was a month ahead and sprayed
past where the line stopped (with HORIZON now 36 this overran to ~2.6x the plot width — x≈2525 vs a right edge of 954 — the shaded region literally shooting off the right side; it was already unclipped before the horizon bump, which just made it dramatic). Fixed: `bandPts = clip(traceOf(rws))`, the same call the line uses, so the band stops exactly at the right edge. A dedicated guard asserts NO rendered path exceeds `W - R` (`test/views/band.test.jsx`), so any future horizon change or new chart element that loses its clip is caught. (2) the
main line `rows` is `anchorToActuals(…, cashActuals, anchorActuals)` (anchored to recorded cash) but the
band curves came straight from `buildProjection`, un-anchored — so with the demo's deliberate ~$18k cash
drift the band sat up to ~$114k off the line. Fixed: App anchors all three band curves (floor/expected/
ceiling) with the same `anchorToActuals` before passing them to the chart. Together these put the
expected curve exactly on the line (verified: 0 difference at every month). NOTE the band is correctly
ZERO-WIDTH over recorded actuals (no uncertainty about cash you've already recorded — floor = ceiling =
line there) and opens up only after the actuals end. `data-band="floor|ceiling"` and `data-trace="main"`
hooks exist on the paths so the render test can assert the line sits within the band; that test fails on
either old bug (verified by reverting) and is in `test/views/band.test.jsx`, with the data-level
coincidence guard in `test/engine/band.test.js`.

## The hardcoded company name (fixed TWICE, and the second time is the lesson)

`Northwind Labs` was hardcoded in the chrome — someone else's company name on every screen, for every
user. It was found and fixed once in the rail foot, with a guard in `test/views/shell.test.jsx`. An
IDENTICAL hardcode two elements away in the topbar subtitle survived that fix untouched and shipped.

WHY IT SURVIVED: the guard asserted `foot.textContent` — scoped to the element that had been fixed. A
test that pins the fix instead of the INVARIANT only protects the one line you were already looking at.
The invariant here is "no chrome anywhere names a company the document doesn't", and it is now asserted
against the whole rendered container, not a subtree. Both spots derive from `doc.name` (falling back to
"Untitled model", matching the rail input's placeholder so the two agree).

THE TWO NAMES ARE NOW RECONCILED (`test/views/companyname.test.jsx`). A model belongs to a company, so
the company's name is the default for the model's — nobody should type "Acme" twice. `DocumentHost`
resolves it from `listCompanies()` + `auth.activeCompany()` into `companyName`, best-effort (a name that
fails to resolve is a missing default, not an error worth showing).

**WHEN it seeds is the whole design.** Seeding on load would write a document to a brand-new account
merely because somebody signed in — which stops the account being `isNew` and takes the adoption AND
demo-promotion offers down with it (`adopt.test.jsx` has asserted that invariant since the backend
landed). So the seed is gated on `hasSubstance(doc)`: it rides along with a write the user's own action
already caused rather than causing one. Removing that gate fails the guard test — verified by reversion.

Two further restrictions, both about not touching real data:
- Only documents that started this session EMPTY (`r.isNew`, tracked as `seedName`) are eligible. An
  existing saved model called "Untitled" is a name somebody left alone, not an unfilled blank.
- `isDefaultName()` ("" or "Untitled") is the only thing that may be overwritten. A chosen name wins.

DISPLAY falls back in order — chosen name, then the company's, then "Untitled model" — so the subtitle
shows something useful even in the cases the seed deliberately won't rewrite. The rail input keeps its
RAW `doc.name` as `value` (a fallback there would make the field un-clearable) and takes the company
name as its PLACEHOLDER instead.

The demo's name is hardcoded to "Demo Company" in `document.js`, and is the only hardcoded name left in
the app: a demo has no account, so there is nothing to take one from. A test asserts the demo never asks
the account anything (its `fetchImpl` throws).

## WATCH: monthLabel argument order (a bug that shipped)

`monthLabel(y, m, idx)` — YEAR, MONTH, INDEX. Every caller in the codebase passes
`monthLabel(START_Y, START_M, m)`. `SaasPanel.jsx` was written with the index first and rendered
"May 2" where it meant "Oct 26", in the MRR reconciliation rows and the "Starts …" line. Fixed, with a
test that pins the LABEL TEXT.

Worth remembering why it survived: the SaaS tests asserted the reconciliation rows existed, and their
amounts, and their variances — but never what the month column SAID. A three-argument function whose
arguments are all numbers will silently accept them in any order, and the only defence is asserting the
rendered string.

## Scenarios, rebuilt around the decision

`src/engine/scenario.js` + `src/views/Scenarios.jsx`. Tests `test/engine/scenario2.test.js` (20),
`test/views/scenarios.test.jsx` (20).

**The diagnosis.** The tab answered "what would the curve look like": two runway numbers side by side
with the subtraction left to the reader, a scenario summarised as "3 changes", and no way to act on the
answer. What somebody is doing here is deciding whether to DO the thing.

**APPLY TO PLAN** is the step that did not exist. You modelled a hiring freeze, decided to do it, and
then re-entered every change by hand on the real tabs. `onApplyToPlan` hands the already-patched
document to `setDoc`, so it saves, journals and undoes like any other edit rather than needing its own
write path. Confirmed first, with a preview of what lands and what it does to the runway, and the
scenario is KEPT afterwards so you can still compare against it. Unplugging it fails a test.

**ATTRIBUTION IS LEAVE-ONE-OUT.** `scenarioImpact` re-runs the scenario with each change removed in
turn; whichever removal moves the runway furthest is the one carrying it. Ranking by size would be
wrong — a $200k line that lands after you are already dead moves nothing, and a small salary starting
in month two moves a lot. Costs one extra projection per change. NOTE the guard test deliberately puts
the trivial change FIRST, because ranking by patch order passed the original version of that test.

**`score()` exists so attribution works past the horizon.** Every variant of a comfortably-funded
scenario has `months: null`, which would leave the most interesting scenarios with no driver. Past the
horizon, cash left over stands in for months survived. The units above HORIZON are fictional and the
value is NEVER displayed — it exists only to sort.

**`kind: "remove"`.** "Don't hire Sam" used to mean setting a start month past the horizon: a delay
wearing a disguise, which read as a delay in the description and would break if the horizon moved.

**Changes read as sentences.** `explainPatch` returns `{ text, was }` — "Sam Okafor starts Mar 27",
"was Sep 26". It was "Sam: start -> 5", which is the document schema read aloud. Knowing the previous
value is most of the point: "starts Mar 27" is a fact, "starts Mar 27, was Sep 26" is a decision.

**ADD A FUNDRAISE** (`kind: "add"` + `scenarioRound()`). Every other patch kind edits an item that
already exists, so "what if we raised" could not be asked unless you had already entered the round you
were uncertain about — backwards. The added item carries its OWN id, generated once when the change is
made and never regenerated on apply; minting one per apply gives the round a different identity every
render, breaking React keys and any later patch referring to it.

THREE TRAPS, all found by the runway refusing to move, all now pinned by tests:
  1. `closed` emits NO cash line (`capital.js:101`) because a closed round's money is already in
     `cash`. It is absent from the form entirely.
  2. `planning` and `raising` map to `speculative` via INST_CONF, which is off by default. Offered,
     but with a warning saying the scenario will show no change until speculative is switched on.
  3. FINANCING is a separate axis from the revenue tiers and ALSO defaults to off, so even a committed
     round moves nothing on its own. The picker emits `{toggle: financing, on}` alongside the round —
     as its own VISIBLE change, so the reason the numbers moved is on screen and can be removed.
So the default is `committed`: the only status that both emits a line and is switched on.

DEBT IS NOT OFFERED. Without a rate, term, interest-only months and fees it models as money that
arrives and is never repaid — a gift, not a raise, and it would overstate the runway. It lives on the
Investment tab where those terms are.

WATCH: `onAdd` takes an ARRAY. Calling a single-patch version twice in one handler does not work —
both calls read the same `editScn` snapshot and the second silently overwrites the first, which is
exactly what the fundraise needs to do.

**Intent-first changes**, replacing the four-dropdown what/which/field/value chain that asked you to
know the schema before you could ask a question. "Something else" keeps the full schema reachable —
INCLUDING cash and the revenue toggles, which have no intent tile and would otherwise have been
capability lost to a redesign. There is a test for exactly that.

**Live runway while editing.** The old modal let you add changes blind, close it, and only then see
what they did. And there is NO SAVE BUTTON: the old footer offered "Save scenario" / "Keep unsaved",
but `upsert` already wrote straight through and nothing anywhere filtered on `saved`, so both did
nothing. Also fixed while here: `upsert` used to move the edited scenario to the END of the list on
every keystroke.

**Also removed:** the dead `compareRows` (defined, never called) and `PATCHABLE_COLLECTIONS` (unused,
and listed a `milestones` collection that `PATCH_SCHEMA` does not have). And `saas` is patchable at
last — subscription revenue shipped without it, so churn doubling could not be asked at all.

## SaaS subscription revenue (entered under Sales, read on Cash flow)

`src/engine/saas.js` + `src/views/chrome/SaasPanel.jsx`, edited under Cash flow -> Revenue. Tests
`test/engine/saas.test.js` (17), `test/engine/saas-integration.test.js` (9), `test/views/saas.test.jsx` (9).

**IT LIVES UNDER SALES, not on the cash-flow tab where it was first built.** Recurring revenue from
customers is something you SELL; cash flow is where the consequence shows up. The editor sits beside
the order book as a fourth Sales sub-tab, so the two ways this company earns money are entered in one
place, and MRR joins booked/pipeline/deposits in the Sales summary stats.

**THE FUNNEL RUNS SALES -> REVENUE, and says so.** Moving the input must not move the money: MRR still
counts toward recurring revenue on the cash-flow tab. But a total with no editor beneath it is an
unexplained gap between the stat at the top and the lines listed below, so the Revenue tab now names
the amount, says it was entered under Sales, and links straight there.

WATCH: that link navigates with ONE `navigate({ view, tab })` call. `setView(...)` followed by
`setTab(...)` races — `setTab` reads `route.view` from state the first call has not committed yet, so
the tab lands on the OLD view. Guarded by a test; the two-step version fails it.

**WHY IT ISN'T A RECURRING LINE WITH A GROWTH RATE.** A recurring line grows geometrically from one
amount. A subscription book is a POPULATION: customers arrive, a share leave every month, and the ones
who stay may pay more. Those forces produce a curve no single growth percentage reproduces — early on
adds dominate and it looks linear, later churn scales with the base and it flattens toward a ceiling of
adds/churn. That ceiling is the entire reason to model it separately. Pinned by an integration test that
is worth reading: same adds, same price, same burn, and ONLY churn differing — at 20%/mo the book tops
out at 50 customers = $25k/mo, never covers $50k of burn, and the company still dies; at 0% it escapes.
`months(capped)` is finite, `months(uncapped)` is null.

**EXPANDS INTO ORDINARY LINE ITEMS**, exactly as capital.js does for instruments and projects.js for
projects — `compileSaas()` emits one `cadence: "onetime"` revenue line per month. Nothing downstream
learns a new cadence, so buildProjection, scenarios, the confidence bands, SF-424A and the revenue-
actuals replacement all keep working untouched. The alternative — a `cadence: "saas"` interpreted inside
the projection loop — would have meant finding every switch on cadence in the codebase and hoping none
were missed. A test asserts the model contains only "recurring" and "onetime".

**Churn is applied BEFORE the month's adds**, so somebody who signs up in month m bills in month m.
The other order churns a cohort that has not reached a renewal date yet. Reversing it fails 4 tests.

**Field notes.** `saas: []` reaches existing documents through the `emptyDoc` spread in `migrate()` with
no schema bump — the same route `journal` took. Blank/junk inputs coerce to 0, never NaN (a NaN in a
line amount poisons every balance after it and the chart stops drawing). Confidence works like any
revenue line and defaults to "expected" via `tagRevenue`. `saasCeiling()` returns NULL for zero churn
(unbounded) and for zero adds (decay) — both real answers, neither a ceiling — and the panel names
those two cases explicitly rather than showing a blank. The Revenue stat strip adds `saasNow` to
recurring revenue, or a pure-subscription company reads as zero recurring revenue.

## Hiding tabs and sub-tabs (`src/state/tabprefs.js`)

Tests `test/engine/tabprefs.test.js` (12), `test/views/tabprefs.test.jsx` (13). Guards verified by
reversion. UI is the Layout section of the Account page; stats opt-out sits on each company row there
(RPC `set_stats_optout`, migration 007, owner-only, and `list_companies` now returns the flag).

**A VIEW PREFERENCE, NOT MODEL DATA.** Deliberately NOT in `doc.settings` alongside the revenue
toggles: those change the numbers so sharing them is right, whereas one owner decluttering their own
screen must not rearrange a co-owner's. Stored in localStorage, which means it does NOT follow you to
another browser — a real trade, taken because the alternative (a profiles column + RPC) needs an async
read before the chrome can draw, so the nav flickers from "everything" to "your selection" on every
load. The seam to change is `load`/`save` and nothing else.

**Default is everything visible, and hiding is subtractive**, so a tab added later appears for
everyone automatically instead of being silently missing for anyone who saved a preference first.

**Three lockout guards.** Dashboard cannot be hidden (there must always be somewhere to go home to,
and the alternative is inventing a second fallback and protecting THAT). Hiding every sub-tab of a
view still leaves one — enforced at render AND refused in the settings UI, because a checkbox that
appears to work and silently doesn't is worse. Hiding the view you are standing on moves you to the
Dashboard. A hash pointing at a hidden view still RENDERS it: this is decluttering, not permissions,
and breaking a bookmark is the bigger surprise.

**WATCH: `resolveTab` reads the REGISTRY, not the view's TABS array.** The first version took the
array, which meant it had to be called where TABS is built — moving `const tab` BELOW code that used
it, in six views at once. A TDZ error, which `vite build` accepts and only vitest catches. Exactly the
failure mode this file already warns about; it caught 20 tests across 7 files.

**The registry is duplicated from the views by necessity** — each builds its own TABS locally with
live counts, so there is nothing importable. `test/views/tabprefs.test.jsx` scans the view sources and
fails on drift, because a sub-tab the settings screen cannot see is one nobody can hide.

**Also fixed while here:** an attempt to key preferences per user called `getSessionProvider()?.()`,
but that returns the session OBJECT rather than a function, and it crashed DocumentHost outright. The
scoping was unnecessary anyway — localStorage is already per browser profile, and browser profiles are
how two people share a machine.

## Aggregate statistics (the one deliberate hole in tenant isolation)

`src/engine/stats.js` (pure), `scripts/stats-job.mjs` (the job),
`supabase/migrations/006_company_stats.sql`. Tests `test/engine/stats.test.js` (18),
`test/state/stats-job.test.js` (10). All three guards verified by reversion.

**THE FINDING THAT CHANGED THE POLICY.** The privacy draft said statistics were "never derived from
employee records — salaries are excluded from every calculation". THAT IS FALSE AND UNIMPLEMENTABLE:
you cannot compute a runway without reading salaries, because payroll is most of the burn. The
headline figure is derived from employee records by construction. The keepable promise is about what
LEAVES the module, not what it reads — reads a document in memory for one projection, emits anonymous
numbers, publishes nothing about any person. Policy corrected in all three documents.

**Computed in JS, not SQL, deliberately.** Runway is the most heavily tested calculation in the
product; reimplementing it in Postgres would create a second source of truth that drifts from the one
the customer sees. The job imports the real engine. THIS REQUIRED ADDING `.js` TO 13 EXTENSIONLESS
IMPORTS in `src/engine/**` — Vite resolves them, Node does not. Golden number confirmed unmoved. The
engine is now Node-importable, which Phase 1's server-side entitlement check will also want.

**How each promise is enforced structurally, not by reviewer vigilance:**
- `companyStats()` returns SCALARS ONLY, with a test asserting the type of every value — adding
  `topEarner: "Alex Rivera"` fails the build. The DB write is separately allowlisted.
- MIN_COHORT (10) suppresses figures by ABSENCE, not rounding or fuzzing; a blurred number still
  carries information. The COUNT is never suppressed — "14 companies use Waterline" says nothing
  about any of them.
- Opt-out is applied IN THE QUERY (inner join on `companies.stats_optout`), so an opted-out
  document is never read rather than read and discarded.
- The job logs counts, never names. Tested.
- `company_stats` has NO insert/update policy: service role only. The public surface is a VIEW
  serving the newest UNSUPPRESSED snapshot, so a small-sample figure cannot be served even if stored.

**`contributes()` excludes companies that signed up and never typed anything.** Empty documents
project happily — straight to zero — so counting them would inflate the company count with people who
never used the product AND drag every average down. Both errors flatter in the wrong direction.

**"No zero date" is never averaged in as HORIZON.** That would cap the healthiest customers at 36 and
understate exactly the companies doing best; they are counted separately as `companiesBeyondHorizon`.

## Phase 2: installable (PWA)

`public/manifest.webmanifest`, `public/sw.js`, registration in `main.jsx`. Tests
`test/engine/pwa.test.js` (8).

**HAND-WRITTEN, not `vite-plugin-pwa`.** The plugin is blocked by the sandbox's package policy, but
it is also the right call: generated workers ship a precache manifest and routing rules that are easy
to adopt without reading, and the failure mode HERE is silently serving stale financial data.

**THE ONE RULE: CACHE THE APP, NEVER THE DATA.** Any cross-origin request — Supabase, Stripe, Sentry —
returns before the worker touches it. A stale runway number is far worse than an error: an error is
obviously wrong, and a cached figure from last week looks exactly like this week's, and somebody makes
a hiring decision on it. Only `/assets/` is cached, because Vite content-hashes those so the filename
changes when the content does. Navigations are network-first so a deploy lands immediately.

Registration is production-only (a worker caching a dev server produces confusing staleness) and its
failure is ignored — an unregistered worker costs offline support and nothing else, and the app must
not fail to start because a cache did.

**STILL NEEDED: PNG icons.** The manifest points at SVGs, which modern browsers accept but older
Android and iOS do not reliably. 192px and 512px PNGs are required before install prompts work
everywhere.

## Phase 1: billing UI (Account + unpaid bar)

`BillingSection` in `Account.jsx`, `UnpaidBar` in `App.jsx`, plus `myPlan`/`checkout`/`billingPortal`
on the account API. Tests `test/views/billing.test.jsx` (10).

**THE BAR IS THE POINT, more than the plan cards.** Without it a refused save showed only a small
"Couldn't save" pill, which reads as a fault — you retry, reload, and conclude the product is broken.
It is not broken, it is asking to be paid, and that is a completely different sentence. Its absence is
why an unpaid company looked like a broken app for most of a day during Phase 1 testing. `unpaid` is
deliberately ABSENT from `SyncPill`'s labels, so a pill does not restate a billing state as a fault
next to the bar explaining it.

**Reads one `my_plan()` call.** Plan is a property of an ACCOUNT, not a company — assembling it from
company rows is exactly the confusion 009 existed to remove, and the 012 breakage came from 008 having
done it that way.

**Every message says the model is safe and still exportable**, and a test asserts none of them contain
"lost" or "deleted". It IS safe: the edit is held in memory by storage's halt, and export is never
gated. That is also the commitment terms §5 makes.

**Staff accounts see "exempt from billing" and NO plan cards.** Showing a price ladder to somebody who
cannot be charged is noise, and showing "no plan" while they write freely reads as broken.

**Connected is rendered as "Not available yet"** rather than a buy button, because automatic import
does not exist. Selling it would be the one failure no refund fixes.

## Phase 1: Stripe (Edge Functions)

`supabase/functions/{stripe-webhook,stripe-checkout,stripe-portal}` +
`_shared/stripe-signature.js`. Tests `test/engine/stripe-signature.test.js` (9).
Shape confirmed by Stripe's own implementation planner: hosted Checkout, flat-rate prices, freemium
no-card trial, Customer Portal, Smart Retries.

**SIGNATURE VERIFICATION IS BY HAND, no Stripe SDK.** Same reasoning as Sentry: the SDK's
`constructEvent` uses synchronous Node crypto and does not run in Deno, and its async twin has a
different name that is easy to get wrong SILENTLY. The algorithm is twenty lines and documented.

THIS IS THE SECURITY BOUNDARY OF BILLING — anyone on the internet can POST to a webhook endpoint, and
if it is wrong somebody grants themselves a subscription by sending us JSON. Four things it does that
a naive version would not: constant-time comparison (a plain `===` leaks how many leading characters
matched, which is enough to forge a byte at a time); a 5-minute replay window (without it a captured
signature is valid forever and can re-apply a cancelled subscription); accepting ANY listed `v1`,
because Stripe sends several during a secret rotation; and FAILING CLOSED when the secret is missing,
rather than treating absence as "skip verification".

**RAW BODY, NEVER RE-SERIALISED.** `JSON.stringify` of a parsed body reorders keys and changes
whitespace, and the signature then fails for a perfectly legitimate event.

**Out-of-order delivery is handled, not assumed away.** Stripe guarantees at-least-once, NOT ordering
— a `subscription.updated` from before a cancellation can arrive after it and resurrect a dead
subscription. Every upsert carries `last_event_at` and the PostgREST filter drops anything older, so
a stale event matches nothing and writes nothing. Replays are harmless via `merge-duplicates`.

**Status codes are chosen for what Stripe does with them:** 400 on a bad signature (not retryable,
stop); 500 on a database failure (retry, do not lose a subscription change); 200 on unknown event
types (an error makes Stripe retry forever for something we were never going to act on).

**`user_id` is written to BOTH `client_reference_id` and `subscription_data.metadata`.** The session
id is useless three months later — a renewal event never mentions it — so the metadata on the
subscription is what makes lifecycle events attributable at all.

**The portal takes its customer id FROM OUR DATABASE, never the request.** Accepting one from the
client would let anybody open a billing portal for anybody else's account.

**`STRIPE_PRICE_MAP` is config, not code**, so adding an annual price is a secret change rather than a
deploy.

## Phase 1: entitlement (`008_entitlement.sql`)

Tests `test/state/entitlement.test.js` (6), classification guarded by reversion. The Stripe webhook,
Checkout and the Account billing section are NOT built yet — this is the enforcement core only.

**ENFORCED IN THE DATABASE, NEVER THE CLIENT.** This is a JavaScript app; anything gated in React is
gated in name only. Every write already funnels through `save_document`, so there is exactly one place
the check belongs.

**READS ARE NEVER GATED.** An unpaid account can still open and EXPORT. That is a commitment the terms
of service draft already makes — §5 — not a preference, and also self-interest: holding somebody's own
financial data hostage over a lapsed card generates furious support and makes reactivation
adversarial. Nothing in 008 touches select, pinned by a test.

**THE POLICY IS ONE FUNCTION.** `company_entitled()` is the only thing that decides who may write;
changing the commercial model should mean editing it and nothing else. Everything around it is
mechanism.

**The free tier is the OLDEST COMPANY YOU OWN**, computed rather than stored. An `is_free_slot` column
has to be maintained, and every path that creates or deletes a company becomes a place to corrupt it.
`order by created_at limit 1` cannot drift, needs no migration when the rule changes, and is
explainable to a customer in five words.

**Stripe statuses are stored VERBATIM and read generously.** A local enum would need updating whenever
Stripe adds a status, and the failure mode of a missed one is granting or revoking access by accident.
`past_due` still writes: a failing card is a dunning problem, not a reason to lock somebody out of
their payroll mid-edit while Stripe retries for days.

**`subscriptions` has NO insert/update/delete policy.** RLS denies by default, so an authenticated user
cannot grant themselves a subscription even having found the table. Only the webhook, on the service
role, writes it.

**`ERR_PAYMENT_REQUIRED` is distinct from `ERR_FORBIDDEN`** (SQLSTATE P0003), and checked BEFORE the
403 branch — a gateway that drops the code would otherwise land it on forbidden and tell somebody they
lack permission when what they lack is a subscription. Storage emits a distinct `unpaid` state rather
than a generic error, because "could not save" invites a retry and a conclusion that the product is
broken. The edit stays held in memory by the existing halt, so nothing is lost by paying and retrying.

## Phase 0: version retention + error reporting

### `document_versions` is bounded now (`005_version_retention.sql`)

The table grew without limit: `save_document` inserted a full ~20 KB copy of the body on EVERY
debounced save and nothing ever deleted any of it — roughly 1 MB per editing session per user, in a
table on the write path. Two changes for two different problems:

- **RETENTION** (storage): keep the most recent 20 snapshots per document, pruned in `save_document`.
  Last-N and NOT a time window, because a row count is a hard bound and "90 days" is not — a busy
  company still accumulates thousands inside it and a dormant one loses everything. Account deletion
  already cascades, so time-based expiry buys nothing for compliance either.
- **COALESCING** (write volume): only snapshot when the newest one has aged past 5 minutes. Fifty
  snapshots one debounce apart is useless granularity — you are not restoring a keystroke, you are
  restoring yesterday. Safe because NOTHING IN THE CLIENT READS `document_versions`; it is a recovery
  net, not a feature. The optimistic-concurrency contract is untouched: `documents.version` still
  increments every write, only the snapshot is skipped, so version numbers simply become sparse.

**Verifying it needed a second idea.** Counting rows cannot detect snapshot-per-save once retention
has capped the table — a burst adds ten rows and deletes ten and the count never moves. The VERSION
NUMBERS give it away: consecutive numbers mean every save snapshotted, sparse means coalescing works.
`scripts/retention-checks.mjs` uses that; `test/state/retention.test.js` drives it against a fake DB.

**BE HONEST ABOUT WHAT A SHORT LIVE RUN PROVES.** Coalescing and retention fight each other: you
cannot make 21 snapshots in a minute when coalescing is doing its job, so on a fresh project the
keep-window assertion is near-vacuous. It reliably catches THE MIGRATION NOT BEING APPLIED, and bites
properly on a project with real history. Stated in the checker and pinned by a test.

**WATCH: WHICH SIGNAL IS VALID DEPENDS ON WHETHER THE TABLE IS AT ITS CAP.** The first version of the
burst check demanded three snapshots to compare version numbers — so the first real run, on a fresh
project where 42 saves collapsed to ONE snapshot, was reported as a retention failure. It failed on
the best possible outcome. Below the cap the ROW COUNT is the valid signal (a burst adds one row or
none); at the cap the count cannot move at all (ten inserted, ten pruned) so only the version numbers
tell you anything. Both halves are load-bearing — reverting either reproduces a different real
failure, verified.

### Error reporting (`src/state/errors.js`)

A SEAM, not `@sentry/react`. Error SDKs capture generously by default — breadcrumbs, URLs, request
bodies, DOM text in replays — which for most apps is a feature and here is a payroll leak. So the
vendor sits behind an adapter like the auth client and storage backend, and everything passes through
a scrubber: money-shaped numbers, emails, secret-named keys, query strings on stack frames. Objects
are DROPPED rather than truncated, because a partial document is still a document.

OFF by default — no `VITE_ERROR_SINK_URL`, no network call — so dev and tests stay silent and turning
it on is a deliberate act with a reviewable diff. `reportError` never throws, because a reporter that
can fail is a way of losing the original error. `ViewBoundary` now reports as well as logs, and global
handlers catch what escapes React (most of storage and sync runs outside the render tree).

### Sentry, deliberately WITHOUT `@sentry/browser` (`src/state/sentry.js`)

Tests `test/engine/sentry.test.js` (15), guards verified by reversion.

**THE REASON IS STRUCTURAL, NOT BUNDLE SIZE.** `Sentry.init()` installs its own `window.onerror` and
`unhandledrejection` handlers, plus breadcrumb instrumentation recording fetch bodies, console
arguments and DOM text. Those capture RAW errors at the source — before `reportError()` is in the call
path — so the vendor would receive an unscrubbed message containing whatever a thrown object
serialised to. Disabling all of it is possible but is a configuration you must keep getting right
forever, against a dependency that adds integrations in minor versions. Posting the envelope ourselves
means there is NO BYPASS PATH TO MISCONFIGURE. Adding the SDK later would silently re-open it.

**THE RELEASE TAG IS RESOLVED IN `vite.config.js`, not in the deploy dashboard.** VERCEL DOES NOT
EXPAND ENVIRONMENT VARIABLES — setting `VITE_RELEASE` to `"$VERCEL_GIT_COMMIT_SHA"` in its UI stores
that literal string, so every deploy reports a release named `$VERCEL_GIT_COMMIT_SHA`. It looks like
it worked until you need to tell two builds apart. The config reads `VERCEL_GIT_COMMIT_SHA` /
`GITHUB_SHA` / `CF_PAGES_COMMIT_SHA` and injects the value via `define`, because Vite only exposes
`VITE_`-prefixed variables to browser code and the platform's own variable is not one. Guarded by a
test asserting the injected value never starts with `$`.

**Format:** `/api/{id}/envelope/`, newline-delimited JSON (envelope header, item header, payload).
`/store/` is deprecated. AUTH GOES IN THE QUERYSTRING — a custom `X-Sentry-Auth` header triggers a CORS
preflight on every send, and Sentry documents the querystring form so browsers can avoid it.

**Context becomes TAGS, not `extra`**, because tags are searchable — "every crash in Scenarios" is most
of the value. Safe only because `scrubContext()` already reduced them to short scalars; a test asserts
objects never reach a tag.

**Flood protection is ours, not the SDK's**: identical errors within 5s collapse, 25 events per page
load maximum. A render loop is one bug, not five hundred, and one bad deploy must not burn a month of
quota and bury the event somebody needed. Removing it fails a test.

**Frames are sent OLDEST FIRST** (reversed from how a stack string reads) because that is what Sentry
groups on. Unparseable lines are dropped rather than guessed at — a wrong filename groups two
different bugs together, which is worse than no frame at all.

### WATCH: the test-config guard scans code, not prose

`testconfig.test.js` failed `errors.test.js` because the regex `\bdocument\.` matched the word
"document." at the end of an English sentence in a comment. Comments are stripped before scanning now.
A guard that fires on prose teaches people to ignore it, which is worse than not having one.

## The test suite runs as TWO PROJECTS (node + jsdom)

`vite.config.js` + `test/setup.js`. Guarded by `test/engine/testconfig.test.js` (5).

**The problem, measured not assumed.** Everything ran under a global `environment: "jsdom"`, so all 67
files spun up a fake browser and only 37 touched the DOM. The engine half made the waste plain: 288
tests, 1.17s of actual testing against 13.33s of jsdom startup — eleven times their own runtime for a
browser they never use. Full suite 308s wall, of which only 68s was running tests.

**What was rejected, and why.** `pool=threads` was measured at ~20% on a slice of view files (15s ->
12s) and NOT taken. Forks is Vitest's default because a separate process cannot leak into another one;
threads share a process, and this suite is unusually sensitive to that — heavy `vi.resetModules()`,
module-level singletons in `storage.js` and `demo.js`, `fake-indexeddb/auto` installing globals. 20% is
not worth raising the odds of a confusing flake. The two compose, so it stays available later.

**Result:** engine project 27s -> ~9s (environment cost 13.33s -> ~5ms), full suite 308s -> ~236s.

**`test/setup.js` IS SHARED and guards its own DOM parts** on `typeof document` / `typeof
HTMLAnchorElement`, rather than splitting into two setup files that would drift apart. The guards
double as documentation of what is actually browser-specific.

**THE UI PROJECT IS A CATCH-ALL AND MUST STAY ONE.** `include: test/**` with `exclude: test/engine/**`,
not an explicit `test/{views,state,security}` list. A file matching NEITHER project is not reported as
failing or skipped — it silently never runs, and the suite goes green while testing less than you think.
node is the narrow opt-in; jsdom is everything else, so a new directory runs by default in the safe
environment. `testconfig.test.js` asserts exactly this and fails if the include is narrowed (verified by
reversion). It also scans `test/engine/**` for `@testing-library`/`document.`/`window.` so a rendering
test dropped in the fast project fails with a clear message instead of a confusing missing-document
error. That scan exempts itself — the patterns it looks for appear in its own source as regex literals.

**Still on the table:** ~175s of the remaining 236s is still overhead, mostly because many view tests
mount the whole app and pull in the entire module graph. That is the next lever and a much bigger job.

## MRR reconciliation

`src/engine/saas.js` (reconciliation half) + the `Reconcile` block in `SaasPanel.jsx`. Tests
`test/engine/saas-reconcile.test.js` (17) and the recording block in `test/views/saas.test.jsx`.

**Follows revenue.js's four pinned rules exactly**, deliberately — two subtly different reconciliation
doctrines in one app would be worse than either alone. Past-only bounded by the book's last recorded
month; TOTAL suppression inside that range (a gap is a recorded $0, not a month to guess at); always on,
no toggle; flag the disagreement but still use the actual. Recorded months are tagged
`confidence: "committed"` because they already happened — no confidence toggle may switch off money
that is in the bank. All three of those are verified by reversion: filling gaps from the model fails 1
test, dropping the committed tag fails 2.

**WHY IT DOESN'T RIDE ON `applyRevenueActuals`.** Project revenue is reconciled from CODED HISTORY,
because a grant payment arrives as a bank deposit that has to be attributed to something. MRR comes off
a billing dashboard and the founder already knows it — so `saas[].actuals` is `{ month: amount }`
entered directly against the book. Making somebody run a coding exercise to tell us a number they can
read off a screen would be the wrong kind of rigour. Variances still join the SAME list
(`revenueVariances`) so the "recorded revenue differs from projection" panel in Spend history -> Ledger
stays one place to look; subscription variances carry `label` because they have no project to resolve
a name from.

**RE-BASING IS A BUTTON, NOT A CONSEQUENCE.** This is the one place subscriptions genuinely differ from
grants: a grant paying short is one disappointing month, but billing short means the CUSTOMER COUNT is
wrong and therefore every forward month is wrong too. `impliedCustomers()` backs out what the record
implies (at the price the model assumes for THAT month, not month zero's). Acting on it changes the
forecast, and the standing rule is that a discovered disagreement must not silently move the runway —
so `rebaseFromActuals()` runs when somebody presses the button, having seen the gap. Making it
automatic fails 4 tests. The re-base carries every assumption across unchanged — churn, add growth and
price growth all continue on the same curve, with `newPerMonth` and `arpu` advanced to their
month-`through` values — so the forward series is EXACTLY continuous when the record matched the model,
and only moves when it didn't. Both directions are tested.

## Emailed auth links: VITE_SITE_URL

`src/state/siteurl.js`, used by `SignIn.jsx`. Tests `test/engine/siteurl.test.js` (9) + 2 in
`test/views/signin.test.jsx`.

**Reported as "the magic link sends me to a page that wants a Vercel login".** Nothing was broken: the
email sent, the token was valid, the DESTINATION was wrong. `redirectTo` was `window.location.origin`,
so a link came back to whatever host it was requested from — and a link asked for on a Vercel preview
deployment (`runway-git-branch-you.vercel.app`) returns to that preview, which sits behind Vercel's
Deployment Protection and answers with a Vercel login page.

`VITE_SITE_URL` pins the canonical origin. Unset it falls back to the current origin, which is the
RIGHT answer for local dev and preview builds — this only matters when a canonical domain exists and
the app is also reachable at per-deployment URLs. Junk values are treated as unset rather than becoming
a redirect target, and the value is normalised to a bare origin because an allow-list compares strings
and `https://x.com/` is not `https://x.com`.

**THE QUIET SECOND FAILURE, which is why the fix also SHOWS the destination.** Supabase keeps an
allow-list of redirect URLs, and an `emailRedirectTo` that is not on it is NOT rejected — it is
silently ignored and the link falls back to the project's Site URL, with no error anywhere. So a
redirect can be well-formed, correctly sent, and still land somewhere else. Both failures share a
shape: nothing errors, the link just points at the wrong host, and nothing in the product ever says
which host that is. So every "check your email" screen now names it — "The link opens app.example.com"
— and flags per-deployment hosts (`.vercel.app`, `.netlify.app`, `.pages.dev`, `.onrender.com`)
explicitly, since those are the ones that end up behind a login wall.

**TWO SETTINGS OUTSIDE THE CODE have to agree**, documented in `.env.example`: Supabase -> Auth -> URL
Configuration -> Redirect URLs must contain the origin, and Site URL should be the same origin since
that is what an unlisted redirect falls back to. Separately, Vercel -> Deployment Protection may be
enabled on PRODUCTION too, in which case every emailed link hits the wall regardless of where it points.

## New-company onboarding (landing fork -> setup wizard)

`src/views/Landing.jsx`, `src/views/Setup.jsx`, `src/state/setup.js`. Tests `test/engine/setup.test.js`
(11, pure) + `test/views/onboarding.test.jsx` (11, flow).

**What was wrong.** Two landing screens that didn't know about each other. `SignIn` was the first screen,
so the cheapest way to understand the product — the demo — was a text link at the BOTTOM of a form,
below a password input, a forgotten-password link, a magic-link button and a Google button: an undecided
visitor was being asked to authenticate first. Then the empty shell offered the demo AND import a second
time, to somebody who had already signed up — and its demo button did `hash="#demo"; reload()`, bouncing
an authenticated user into unauthenticated demo mode. Meanwhile "create from scratch" meant an empty
model and eight tabs to explore, prompted by a single cash field.

**The shape now.** Landing = two real doors (demo / set up your company) with sign-in demoted to a line
of text — not because returning users matter less, but because they know what they're looking for and
new visitors don't. `SignIn` gains `initialMode` + `onBack`, so neither door is a trap. In LOCAL mode
there is no landing screen and no account, so the empty shell keeps its demo button there and loses it
only when `syncConfigured()`.

**Account-first, so the wizard hangs off `isNew`.** Sign-up ends at "check your email", so the wizard
can't follow it in the same sitting — it fires on the next successful load instead, the same hook that
drives promotion and adoption. THREE offers can now claim an empty account and they are ordered by how
explicit the signal is: kept-demo promotion, then a model stranded in IndexedDB, then the wizard. NOTE
the restructure this forced: `adoptionDismissed()` used to `return` early, which would have swallowed
the wizard for anyone who had ever declined an adoption.

**Skipping must cost nothing.** An all-skipped wizard returns null and writes NO document, so the
account stays as `isNew` as it was found and can be offered again — guarded by two tests asserting
`uploaded` is empty after cancel and after skip-everything. "Not now" is remembered in sessionStorage,
not a schema field: the account is genuinely still empty, so asking again on a later visit is help.

**`src/state/setup.js` is pure and separately tested** — the answers->document mapping is where the rules
are. It lives in state/ not engine/ because it builds a DOCUMENT and `src/engine/**` is forbidden from
importing state (oxlint). Blank numeric fields become 0, never NaN: a NaN in `cash` propagates into
every balance and the chart silently stops drawing. Junk enums are rejected rather than written through.
Rounds default to `status: "planning"` -> INST_CONF speculative -> OFF in the base projection, because
understating runway is the safe direction to be wrong in.

**Salary is optional but warned about, not blocked.** Employees with names and titles alone produce no
burn, and burn is what a runway IS — a wizard collecting three names and no salaries hands back a model
that reads "cash-positive" forever, which is the exact document shape that white-screened Scenarios.
Blocking would push people to omit the person entirely, which is worse: a person at zero is visible in
the model and fixable, a person left out is invisible. So the wizard keeps them at 0 and says the burn
is understated. The live runway readout is what makes this honest — the number visibly fails to move.

**Adding a SECOND company from Account runs the same wizard — and now runs it FIRST.** "Add company"
opens the wizard directly (`setSetup("company")`); there is no name box on the Account page any more.
The old order asked for a name, created the company row, and THEN opened a wizard whose own first
question was the name — so you typed it twice, and cancelling out left an ORPHAN EMPTY COMPANY in the
database. Wizard-first means nothing is written until Done, so backing out creates nothing (guarded by
a test asserting no `create` RPC after Cancel). In `mode: "company"` the name is required — Next is
disabled and the skip link is hidden on step 0 — because it is the name the company gets created under.
`onDone(built, typedName)` passes the name SEPARATELY, since an all-skipped wizard returns a null
document and the name cannot ride inside it.

**The runway readout distinguishes the two 'no zero date' cases** (`classifyRunway` in `state/setup.js`,
tested in `test/engine/setup.test.js`). `zeroInfo` returns ONE null for two different situations, and
the readout used to label both "cash-positive": revenue genuinely covering costs, versus burning
steadily but outlasting the 36 months modelled. Telling a steady burner they are cash-flow positive
because their pile is bigger than our window is a wrong answer that gets believed. Four states now:
`runway` (a real date), `idle` (nothing burning yet), `positive` (net >= 0 in the final month), and
`beyond` ("36+ mo"). A REAL ZERO DATE WINS over both null cases — dying at month 5 is the answer even
if the model turns positive at month 30. Collapsing the two back together fails 2 tests.

The rule is PURE and in `state/setup.js` rather than inline in the view specifically because
`positive` is currently unreachable through the wizard, which collects no recurring revenue — a rule
that cannot be exercised through the UI still deserves to be exercised somewhere.

## Import/export moved, model name deleted, avatar placed

**Company settings -> Data, owner-only.** Import replaces the model every member of the company sees;
it was one click from every screen in the rail footer — the most destructive control in the product in
the least guarded place. Export followed it because the two belong together, and because an export is a
complete copy of the company's payroll, grants and cash position: reading it on screen and walking out
with the file are different acts.

The import confirmation states the COUNTS — "6 projects, 9 people's payroll, 14 months of history" —
because "this will replace your model" is a sentence people click past and a list of what they are
about to lose is not.

**The model name is gone.** Every company has a name; `doc.name` was a second string for the same
object with its own fallback chain, and the sidebar already fell back to the company name whenever it
could. The field is removed, the subtitle reads `companyName`, and the effect that copied the company
name into the document on render is deleted — that was a write triggered by a render, on data nobody
asked to change. `doc.name` stays in the document so old exports still import; only DEMO mode reads it,
because a demo has no company to take a name from.

**The avatar sits where the email pill was**, in the header. It was beside the runway readout, which
put an account control inside the reading of a number and left TWO entries to the same settings. On
mobile it was worse: `.railfoot{display:none}` at <=900px was hiding the whole footer, which also took
**Company settings** with it — unreachable on a phone entirely.

**TEN TESTS ASSERTED THE OLD ARRANGEMENT** and were reversed rather than deleted, each recording why:
export/import in the rail, the demo-mode guard that only made sense while they were there, the name
field, the fallback chain, and the seeding effect. The demo guard is the clearest case — the rule was
"withhold import in demo mode because it would drop a real model into a store that wipes itself", and
that rule stopped protecting anybody the moment import left the rail.

## Settings split in two — profile and company

One Account page held password, billing, layout, companies and data, with no way to tell which was
about YOU and which about THIS COMPANY. The rule that decides is one question: **does changing it affect
anybody else?**

- **Profile**, from the avatar top right: profile, appearance, advisor plan, your data.
- **Company settings**, from the rail: general, plan & seats, people, tabs, connections. In the rail
  because it is scoped to the active company and the switcher is already there — a company-scoped page
  inside a person-scoped menu is the confusion this removes.

**Two panels SPLIT rather than moved.** Billing is two products sold to two people: the company plan to
Company → Plan, the advisor plan to Profile → Advisor. Migration 024 split those tables for exactly this
reason and the UI never followed. Companies split too: switching is navigation and stays in the rail;
renaming and deleting this company are settings.

**QUICKBOOKS SPLIT BY JOB, NOT BY PAGE.** Connecting is configuration and moved to Connections; SYNCING
stayed on Spend history, because the grid a sync produces has to land in the import screen beside the
CSV import it is the sibling of. A `mode` prop decides: `settings` has no Sync (a button producing data
with nowhere to go loses it), `import` has no Connect and points at settings instead — two places to
authorise one integration is how a half-finished OAuth round trip gets abandoned.

**Owner-only pages are shown and disabled, not hidden**, with the reason. A member who cannot find
billing assumes it is broken; one who sees it greyed knows who to ask. THIS REVERSES `CompanyTabs`,
which rendered nothing for non-owners — a change of position, not a refinement.

**Settings is a ROUTE, not a modal**, so a link can name a page: `{ scope, page }` rather than a
boolean.

**THE SPLIT BROKE 29 TESTS AND THAT WAS THE SIGNAL** — they asserted one flat page where everything
rendered at once, which is the arrangement being removed. Three real mistakes surfaced while fixing
them: I invented prop names for `PasswordSection` and `CompaniesSection` instead of reading their
signatures; I dropped the export and delete-account block entirely; and I placed delete-account above
the company list, which changed button order. It belongs last anyway — the most destructive control on
the page goes after everything somebody came to do.

## Visual defect audit — five fixed, geometry now tested

Measured rather than eyeballed: label positions and text extents computed against each chart's viewBox
with real data. That catches arithmetic — overflow, collisions, format mismatches — and cannot catch
anything depending on real glyph rendering or narrow viewports.

1. **Timeline labels ran off the right edge.** Every row drew its text to the RIGHT of its dot, so a
   goal at month 20 of a 23-month span ended 109px past the viewBox. Labels now flip to the left past
   60% of the plot; the connector line already runs back to the axis, so the association survives.
2. **The band heading collided with the first row beneath it at EVERY row count** — 8px apart with a
   ~10px line box. `GAP` 26 -> 34 and the heading raised to `-16`.
3. **Six charts emitted an EMPTY legend.** It was built from `spec.series`, and the row-based shapes
   carry `rows`. The charts whose entire meaning is colour had nothing explaining it. A spec can now
   declare `legend: [{label, tone, ring}]`, and the legend renders only when non-empty.
4. **`inv.goals` declared `format: "count"` on currency values.** It never showed because the renderer
   called `money()` directly — which is its own smell: a declared field that lies and is ignored will
   eventually be believed by something.
5. **Purchase-order labels overflowed the hbar gutter** — the 22-character cap was ~115px against a
   110px usable gutter. Gutter to 132, cap to 20, and a `<title>` so the full name is on hover.

**Five geometry tests now pin this**, computing positions the same way the audit did. And a lint
warning caught the Goals label flip not applying: the anchor expected `cx + 14` and the markup said
`cx + 12`, so `tx` was computed and unused. Silent at runtime; the labels would simply not have moved.

**STILL NEEDS A BROWSER:** narrow viewports (the timelines have no responsive behaviour below ~620px
and the row fallback from the mockup was never built), long names in tiles and headings, `.ms-name`'s
fixed 190px, print styles, and focus order through the pickers and alert buttons.

## Cash crossing zero and recovering — `solvency()`

A projection can dip below zero in January and be positive again in March, because a receipt lands. The
arithmetic does not know that **a company with no cash in January does not reach March**. Anything
reading the balance ON A DATE, rather than the first crossing, calls that March date healthy.

**I got this wrong in both directions before getting it right.** First the milestones chart judged each
date against the first crossing and printed "29 days past the cash" beside a balance of +$16,080 — I
read that as a bug in the VERDICT and changed it to judge on the balance alone, which was a false green.
The verdict had been right; the EXPLANATION was wrong.

**`solvency(rows, startY, startM)`** in `engine/projection.js`, beside `zeroInfo`, is now the only thing
that computes this: `zeroAt`, `deepest`, `deepestAt`, `recoversAt`, `daysUnderwater`, `holes[]`,
`bridgeTo(t)`, `strandedAt(t)`. Returns null when the balance never goes negative, so the common case
costs nothing.

**Two facts, kept separate, because collapsing them is what failed twice.** `bal` says whether there is
money on the day; `stranded` says whether the company survives to see it. The dot is the balance, the
ring is reachability — a green dot in a red ring is "solvent that day, insolvent before it", which no
single colour can hold.

**The bridge is per-date, not global.** `bridgeTo(t)` is the worst deficit BEFORE that date. One global
number would make every date after the crossing look equally doomed; per-date, Product launch needs
$37,851 and Series A close needs $107,511, which are different problems.

**`msPass` gained a third state at the view**, not a second boolean: reachable / needs bridging / not
reachable. "Pass or fail" cannot hold "solvent that day but dead before it".

**POST-RAISE GOALS NOW USE THE FINANCING-INCLUDED SPECULATIVE RUNWAY**, and both phases get a full
`solvency` reading rather than a date comparison. The money the round creates is what pays for
post-raise goals, so measuring them against anything else judges them against a runway that was never
the plan. Each phase brings its own bridge: a pre-raise goal's bridge closes the hole before the close,
a post-raise goal's closes whatever hole remains in the financed projection.

**A post-raise goal stranded by a PRE-ROUND hole gets its own sentence** — "the round never lands" —
because the money that pays for it never arrives. The same flag would have read as "the round was not
enough", which is a different problem with a different fix.

**FALSE-GREEN SITES FOUND BY THE AUDIT:** `invMilestones`, `msPass`/`msGap`, `Milestones.jsx`,
`msWithBal`, and `invGoals` post-raise. Everything asking "when do we run out" — dashboard, portfolio,
alerts, bands, labor, scenarios, stats — was already correct. The fix went into `msWithBal`, where the
two meet, so one flag serves the chart, the view and the chips.

**A LINT ERROR CAUGHT AN EDIT LANDING IN THE WRONG FUNCTION.** `Goals` and `Milestones` share nearly
identical markup, so the recovery-marker anchor matched `Goals` first — where `spec.recoversT` does not
exist. It would not have thrown at runtime (the guard is falsy, so the JSX never evaluates), and the
marker would simply never have appeared in either chart.

## Milestones became a timeline, matching the goals chart

Same shape — one calendar, two bands, dates on every row — because they are the same question asked
about two different things, and a reader who has learned one should not have to learn the other.

**What differs is what can go wrong.** A goal can only be past the cash. A MILESTONE CARRIES A TARGET,
so the date can arrive with money in the bank and still fail: reached, and short. The bar chart this
replaces could show the balance and not the shortfall, because the target was not a quantity it knew
about — a milestone $64k short of its target rendered as a perfectly healthy green bar.

**Two bands: dates you set, and dates derived from rounds.** `Milestones.jsx` already refuses to edit
the second kind, so the split reflects a rule that exists rather than inventing one. Round-derived dates
usually carry no target and so never read as short — marking them amber would report every capital event
as a miss.

**A CONTRADICTION CAUGHT BY READING THE OUTPUT.** The first version judged each row against
`zeroInfo`'s cliff, which is the FIRST zero crossing — and cash can dip below zero and recover when a
receipt lands. It printed "Product launch · 29 days past the cash" beside a balance of **+$16,080**, a
chart disagreeing with itself in one sentence. Each row is now judged on its own `balanceAtDate` figure,
which is exact and already computed; the cliff stays as context only.

**"Short" and "past the cash" are exclusive.** A date with no money behind it is not short of its
target, it is not happening — saying both would be two verdicts on one row.

Nothing new is computed: `bal`, `target`, `pass`, `gap` and `date` all arrive in `msWithBal`.

## Investment goals have a PHASE — schema v4

A round has goals pointing in **both directions**, and the model was treating them as one list. That is
why the goals chart read oddly: it measured both against the same runway and flagged the wrong half as
late.

- **Pre-raise** — the evidence investors need before they wire. 5 kW stack, $1m booked. Must land
  before the close, on the money you ALREADY HAVE, because the round cannot fund the proof the round
  depends on. Measured against the runway with rounds removed.
- **Post-raise** — what the money is for. Scale to 50 kW, hire twelve. After the close by definition,
  measured against the runway the round CREATES.

**`lateGoals` was exactly backwards for half of them.** It flagged anything due after the close; a
post-raise goal SHOULD be after it. What is actually wrong is a PRE-raise goal filed after the close —
it cannot gate a round that will already have happened, and until the phase existed it looked identical
to a post-raise goal. Both errors are now `misfiled`, tested in opposite directions.

**Migration infers the phase** from `dueMonth <= closeMonth`, which is right for every goal written
before the field existed and moves nothing already filed correctly.

**TWO BUGS FOUND BY RUNNING IT, both of which produced a plausible-looking chart:**

1. **Both runways came out identical**, because I forced `financing: false` for both — which strips the
   round's own inflow from the "with round" case. The chart silently claimed the round changes nothing.
2. **The round is `status: "planning"`, which is a SPECULATIVE tier** (`INST_CONF`), so a
   committed-only projection excludes it entirely. The post-close runway has to be computed at the
   round's own tier, or it measures the wrong thing and looks like it measured something.

**A null cash-out date means the runway outlasts the horizon** — the opposite of a problem. Treating it
as "no answer" and colouring those goals red would report a healthy round as a failing one.

**`ledger.test.jsx` broke on the schema bump** because it asserted `schemaVersion === 3` as a literal.
Now pinned to `SCHEMA_VERSION`: the assertion means "it walked the whole chain", and a literal made it
fail for a reason that had nothing to do with ledgers.

## Projects moved out of the document — 3.8, four migrations

`documents.body` no longer carries `projects`. They live one row each in `project_docs`, ordered by
`position`, with history in `project_versions` and every write grouped by a `snapshot_id`.

**034 add and backfill · 035 dual write · 036 flip reads · 037 projects leave the blob.** Each stage was
independently reversible and gated on the golden number plus the round-trip property:
`assemble(split(doc))` deep-equals `doc`. That property is the whole safety argument —
`buildModelParts` is the ONLY consumer of the document's shape, so if it receives the identical object
nothing downstream can tell that storage changed.

**STAGE 5 (038) CLOSED THE CONCURRENCY GAP** and fixed a data-loss path found while doing it:

- **`sync_project_docs` was deleting rows the client had never seen.** A loads six projects, B adds a
  seventh, A saves with six — and B's project was deleted, no conflict raised, because the check was on
  the DOCUMENT version and A's edit was legitimate. Deletion now requires the project to be in the
  version map the client sent: a client cannot intend to delete something it does not know exists. Live
  since stage 2, and worse than the problem it sat beside.
- **An unchanged blob is no longer a write.** `save_document` bumped `documents.version` on every save,
  so A editing project X invalidated B's base version even though neither touched the blob — which
  would have made per-project checking pointless. A project-only edit now leaves the document alone.
- **Each changed project checks its own version**, and a stale one raises `project_conflict:<id>`.
  `ERR_PROJECT_CONFLICT` is distinct from `ERR_CONFLICT`: "somebody changed Catalyst while you had it
  open" locates the problem, "the document changed" does not.

**042 FIXED A DATA-LOSS BUG I SHIPPED IN 038 AND DEFENDED IN A TEST.** After a successful write the
client discarded its version map, reasoning that guessing the new versions would assert a precondition
nobody checked. The reasoning was right and the consequence was not: **a null map does not mean "check
nothing"** — on the server it means the pre-040 behaviour, no version checks and every project treated
as changed. So the SECOND save after a load rewrote every project from this client's own copy,
including stale ones somebody else had edited.

Found by testing it: A edits project 1, B edits project 2 and saves, B changes tab, B edits project 2
again — and A's project 1 is gone. There was a test asserting the discard was correct; it is now
reversed with the reason recorded.

The answer was not to guess the versions but to be TOLD them. `sync_project_docs` returns
`{id: version}` for the rows it wrote, and the client merges that in. **Stale versions are deliberately
NOT adopted** — doing so would claim "my copy is based on their version" about a copy this client has
never seen, and the next edit would overwrite them with no conflict and no question. Neither map is
ever set to null again.

**AND THE NOTICE VANISHED ON A TAB CHANGE**, which is what made the overwrite invisible. `StaleProjects`
renders on the Projects tab and unmounts the moment somebody looks at Payroll, so notices held in
component state were silently answered by a glance elsewhere. The state lives in `storage.js` now, the
component seeds from it on mount, and "Keep mine" is recorded there too. A warning that disappears
because you looked away is worse than no warning, because you then believe you have seen everything.

**041 GAVE BACK WHAT THE CONFLICT USED TO PROVIDE BY ACCIDENT.** Once B's save stops colliding with A's
edit to a different project, nothing tells B it happened — B's screen shows A's project as it was at
load, indefinitely. The obstruction was wrong; it was also the only notification.

`save_document` now returns `out_stale_projects`: the projects in the client's version map whose stored
version has moved, WITH bodies, author email and timestamp. **Computed BEFORE the sync** — afterwards
the projects this client just edited have also moved past what it knew, and reporting those would tell
somebody their own edit was made by somebody else. It returns the body rather than a flag because a
flag makes the client fetch, which is a second round trip and a second moment for things to change
underneath it.

Surfaced on its own channel (`onStaleProjects`), not through `status`: a save that succeeded is a save
that succeeded, and folding "three projects moved" into the save indicator would make a normal outcome
look like a failure. `StaleProjects` shows one line per project with "Load their version" and "Keep
mine", and CHANGES NOTHING BY ITSELF — replacing a project on screen while somebody reads it is how a
number moves under a cursor mid-sentence, and this application's whole output is a number people quote
to boards.

**AND THEN 040, BECAUSE THE CHECK CONFLICTED ON PROJECTS NOBODY EDITED.** Structural, not a slip: the
client sends the WHOLE document on every save, so B's payload carries its stale copy of a project A
just edited. The server saw a differing body, checked its version, and raised `project_conflict` for a
project B never opened.

The check was RIGHT to fire — without it B's stale copy would have overwritten A's edit. What was wrong
is that the server cannot tell "B did not touch X" from "B changed X": it holds X's version, not the
body B loaded. Only the client knows, so the client now sends `p_changed_projects`, computed by keeping
each project's `stableStringify` at load and diffing at write. A project off that list is left alone
however stale the copy in the payload.

Three things that had to be right about it: absence still means deletion, so the list is of CHANGED ids
rather than of everything present; POSITION is applied for untouched projects too, or dragging one to
the top would conflict on all the others; and null means "treat everything as changed" — the older,
noisier, safe behaviour — rather than "nothing moved", which would be a false claim.

**038 SHIPPED THE FIX AND IT DID NOT WORK, because of ordering.** The short circuit that stops a
project-only save from bumping `documents.version` was placed AFTER the conflict check, which raises
first — so two people editing different projects still collided, which was the whole point. The code
was correct and unreachable.

**039 fixes it by asking a better question.** A stale base version only matters if the write would
overwrite what somebody else put in the BLOB, and after 037 the blob holds no projects:

    if cur.version <> p_base_version and cur.body is distinct from blob_new then

Right in every case — a stale cash edit still conflicts, a project-only edit does not, and two
project-only edits are decided by their own per-project checks. `migrations.test.js` now asserts the
latest `save_document` conflicts conditionally, so reverting it to a bare version comparison fails.

That test needed fixing too: it searched the raw SQL and found 039's HEADER, which quotes the old broken
check to explain it. A scanner that reads prose as though it were code is worse than none — comments
are stripped first now. Caught only because the test was run before the reversion as well as after; the
reversion alone would have looked like success.

**AND THE CLASSIFIER SWALLOWED IT.** `classify()`'s first line is `msg.includes("conflict")`, and
`project_conflict` contains `conflict`, so the specific answer lost to the generic one. Every other
specific check in that function sits above the general one it would lose to; this one had to go above
the very first line. A substring fallback is only safe while nothing more specific shares the word —
now pinned by a test.

**WHAT IT DID NOT BUY, and this was worth measuring before promising it:** lazy loading. Compiling a
project needs `employees` for rates and `pos` for fulfilment stage, so any projection needs essentially
the whole document. And no concurrency win either — the client still sends one `p_base_version`, so two
people editing different projects still collide. **Per-project concurrency is a fifth step**, where the
client tracks a version per project. The four stages delivered the storage substrate, nothing more.

**THE BUG STAGE 4 WOULD HAVE SHIPPED SILENTLY.** `readCompanyDocument`, which feeds the advisor
portfolio, was a direct select on `documents.body` — correct until 037 took `projects` out of it. After
that it would have computed every client's runway from a document missing 44% of its model and reported
the answer with no indication anything was wrong, on the one screen whose entire purpose is to be
trusted. The read still succeeds, the document still parses, the engine still projects, and the number
is simply wrong. Nothing in the suite would have caught it; grepping every reader of
`rest/v1/documents` did.

**The stage-3 fallback is still live and must stay.** `assembleFromStorage` prefers rows and falls back
to the blob when rows are empty, reporting through `reportError`. A company that has not saved since 037
still has `projects` in its blob. Retire it when `documents_still_carrying_projects()` returns zero —
not before, and not because it looks like dead code.

**History changed meaning.** From 037 a `document_versions` row is a document with no projects.
Reconstructing a whole one means that row PLUS the `project_versions` rows carrying the same
`snapshot_id`. There is no restore path built yet; when one is, that is its shape, and it is why the
snapshot was defined at 034 rather than retrofitted later.

## Critical dates became editable, and gained a target

Reported as: milestone details cannot be altered at all. Correct — `Milestones.jsx` had `add` and
`del` and nothing else, and the thing `add` created was hard-coded to **15 May 2027**, a date that was
a year out when it was written and is a critical date you have already missed by the time anyone reads
this. The panel rendered a name and a date it gave you no way to change.

Now the row is always-editable, matching how `CashFlow` and `History` already work — an `upd(id, patch)`
and plain inputs, no edit mode to enter and leave.

**THE DATE CONVERSION LIVES IN EXACTLY ONE PLACE.** Milestones are stored `{y, m, day}` with a
ZERO-BASED month, because that is what `new Date(y, m, day)` takes and what every consumer assumes;
`<input type="date">` speaks `YYYY-MM-DD` with a one-based month. Getting that backwards moves every
critical date by a month and nothing errors, so there is a test asserting January round-trips as
`m: 0`. Neither direction builds a Date from a string — `new Date("2027-05-15")` is UTC midnight and
reads as the 14th in Denver, and the suite runs under that timezone. A half-typed date is ignored
rather than written, or clearing the field to retype it would wipe the stored one.

**TARGET CASH ON HAND.** A milestone used to pass on `bal >= 0` — "will there be any money left". A
target says how much has to be left: a covenant floor, a payroll buffer, the reserve a board asked
for. Zero is the default, so a milestone without one behaves exactly as before.

The rule went into `engine/capital.js` (`msTarget` / `msPass` / `msGap`) rather than the view because
THREE places judged it independently — the panel and two dashboard readouts — and three copies is how
the headline calls a date green while the panel underneath calls it a shortfall. `App.jsx` computes
`pass` and `gap` once, where `bal` is computed, and everything downstream reads them.

Clearing the target sets `undefined` rather than `0`: they mean different things — "no target" and "I
require a balance of exactly zero" — and only one of them should hide the gap line.

WATCH: a round's close date is still owned by the Investment tab and is not editable here, which the
panel says. Rounds also cannot carry a target, because the milestone is DERIVED from the round each
render and there is nowhere to put one. Storing it would mean either a field on the round or a
target map keyed by a synthesised id; neither was worth it before somebody asks.

## Soft delete, and the three things that had to be true at once

`companies.deleted_at` existed from 001, was filtered on in SEVEN queries, and was SET BY NOTHING —
`delete_company` hard-deleted and cascaded away memberships, documents and every version. The read
side had been built for soft delete all along; only the write disagreed, so a mis-click was final.

Making the write agree was the small part. Three things had to hold together for "deleted" to mean
anything (016):

**UNREACHABLE, not merely unlisted.** Membership rows survive a soft delete — they must, or restore
could not put anything back — so anyone who still knew a company id could have read its document
straight from PostgREST for the whole window while every list showed it as gone. `is_member` and
`can_edit` now join `companies` and require `deleted_at is null`. The latency question was worth
asking, since those two sit under every RLS policy in the schema: `memberships` is keyed
(user_id, company_id) and `companies` is joined on its primary key, inside `stable` functions Postgres
caches per statement. One extra index probe on the smallest table.

**A WAY BACK THE CUSTOMER CAN REACH.** `restore_company` plus a "Recently deleted" section on the
Account page. A recovery path that only an operator can reach protects the operator.

**AN END.** `purge_deleted_companies` hard-deletes past `company_purge_window()` — 30 days — or
"deleted" is just a lie with a longer fuse, and a data-protection answer nobody wants to give. It is
service-role and NOT scheduled from inside the database: a destructive job on an invisible timer is
how you learn about a bug in it afterwards.

TWO CONSEQUENCES WORTH KNOWING. `restore_company` and `list_deleted_companies` do their own membership
checks rather than calling `can_edit`, which now answers false for exactly the companies they exist to
reach. And `save_document` gained an explicit deleted check FIRST, with its own SQLSTATE (P0004) —
because `can_edit` would have refused anyway with `forbidden`, which tells somebody they are not a
member when they are, and that is the misdiagnosis that has already cost this project an afternoon.

THE FLAG. Delete-and-restore is not forbidden and blocking it would strand somebody mid-mistake, but
it is a shape worth seeing: a company is entitled only while it is among the oldest N you own that are
NOT deleted, so cycling delete and restore rotates which company is writable without paying for a
second one. The second restore inside the window writes `company.restore.repeated`, and the count
surfaces in the UI. One row, in the place logs are already read.

WATCH: enabling `no-undef` while doing this found `setErr` being called in `modals.jsx` where no such
function exists — a ReferenceError on the malformed-workbook path, i.e. exactly the error handler. The
rule had been off, `vite build` does not catch an undefined identifier, and it had also let two
missing imports through in a single afternoon. It is on now, with `Deno` declared for
`supabase/functions/**` and the node env for `scripts/**`, `test/**` and `vite.config.js` — declared
where those globals genuinely exist rather than switching the rule back off.

## "Could not save — forbidden": the device remembered somebody else's company

Reported live: every save 403ing with `forbidden` from `save_document`, which raises that only when
`can_edit(p_company_id)` is false — the signed-in user is not a member of the company the client is
sending. The client was sending one it had no business holding.

`readActiveCompany()` stored a BARE COMPANY ID in IndexedDB, per device, and `main.jsx` handed it to
the auth adapter at boot before anything checked whose it was. Sign out, sign in as somebody else on
the same browser, and the previous account's company id is still sitting there — so every write goes
to a company the new user cannot edit. `auth.reset()` on sign-out cleared the resolved company IN
MEMORY and the file comment says exactly why; the copy on disk was missed.

THIS IS THE THIRD TIME. `SETUP_SKIP` suppressed the setup wizard for every account opened in a tab
where it had once been dismissed; the resolved company inherited the previous user's document until
`enableHostedSync` was wired to reset it; now the persisted company id. The shape is always the same:
PER-DEVICE STATE THAT OUTLIVES THE SESSION THAT CREATED IT. Anything stored on the device that
describes a USER has to name the user, or the next one inherits it.

So the value is user-keyed — `{ companyId, userId }` — and a bare string, the old format, reads as
belonging to nobody rather than to whoever asks. Keying beats clearing because it does not depend on
sign-out RUNNING: a refresh token expires, cookies get cleared, a tab closes offline, and none of
those fire the handler. Sign-out clears it too, but as the second lock rather than the first.

WATCH: `403 forbidden` was a bad error for this. It names permissions, which sends you to RLS and
grants, when the actual fault is a stale id on the client and the fix is to re-resolve. If it recurs,
`auth.clearSelection()` already exists for exactly this and nothing calls it on a forbidden save.

## The audit log, and the two questions that decided its shape

`audit_log` existed from 001 with nothing inserting a row, under a plan that promised "every document
save, membership change and connector action logged with actor, time and IP". A schema that implies a
trail the product cannot produce is worse than no table, because the promise is what gets repeated
into a security questionnaire.

**QUESTION ONE: log saves?** No — and this is the interesting half. `document_versions.created_by`
ALREADY records who saved what and when, with the body attached, so an audit row would duplicate it
while carrying strictly less. Volume settles what taste does not: at the 30-second unsaved ceiling an
active editor makes hundreds of rows a day, against a handful of administrative events a year. What
IS logged is the set of acts that are rare, irreversible or entitlement-changing and recorded nowhere
else: company created, renamed, deleted; account data wiped; subscription changed. The trigger for
revisiting is Phase 3 putting a SECOND EDITOR in a company, at which point "who changed this" stops
having one possible answer.

**QUESTION TWO: log IP?** No, though the column exists. It is personal data and the privacy policy is
at review — quietly beginning to collect a new category of it after sending drafts to a lawyer is the
wrong order. `request.headers` is also only populated on PostgREST calls, so anything service-role
would leave it null, and a column populated for some rows and not others is worse than an empty one.

TWO THINGS THE SCHEMA ALMOST HID. `audit_log.company_id` is `on delete set null`, so deleting a
company empties the foreign key on the very row recording the deletion — under the old member-based
policy that row became unreadable the instant it was written. Fixed twice over: the policy now also
matches `user_id = auth.uid()` so your own actions stay readable, and deletion events duplicate the
company id and name into `detail`, which is what survives. And append-only held only BY OMISSION
(002 granted just SELECT); it is now an explicit revoke, because a property that holds by accident is
one somebody removes by accident.

Billing is a TRIGGER on `subscriptions`, not an edit to `apply_subscription_event`. That function is
the security boundary billing rests on and has already been repaired once for its parameter names;
rewriting it to append two lines risks the thing it protects. A trigger also catches a hand correction
made in the SQL editor at 2am, which is precisely the change somebody later wishes had been recorded.
The actor comes from the ROW, not `auth.uid()`, because the webhook runs as the service role — which
also lets a customer read their own billing history, something `subscriptions` cannot give them since
it holds only the current state and never how it got there.

WATCH: `delete_company` is a HARD delete, while `companies.deleted_at` exists and is filtered on in
seven queries and SET BY NOTHING. The soft-delete design was never built, so the audit row is now the
only surviving trace of a deleted company. Worth resolving before somebody deletes the wrong one.

## The debounce belongs to the backend, not to storage.js

`SAVE_DEBOUNCE_MS` was 400 with a comment saying it "becomes ~2500 over a network" — a note describing
work nobody had done, which is the most expensive kind of comment because it reads as a decision.
Hosted users were pushing a 40-300KB body every 400ms while somebody typed a project name.

It is now a property of the BACKEND: 400 for local and demo, 2500 for `supabase`. The module constant
survives only as the fallback for a backend that declares none — test fakes, mostly — and
`saveDebounceMs()` asks the ACTIVE backend every time it schedules. Reading it once at module load
would have been the natural way to write this and would have been wrong: sign-in swaps the hosted
backend in after load, so a hosted session would have run its whole life on the local cadence, and
nothing would have looked broken.

TWO CALL SITES, and the second is easy to miss: the scheduler in `save()`, and the reschedule at the
tail of `flush()` when an edit arrives mid-write. Work that arrived during a write is not more urgent
than work that arrived before one.

WHAT THIS COSTS, stated where somebody will find it: up to 2.5 seconds of work now lives only in
memory instead of 0.4. Not on a tab close — `pagehide` flushes — but on a crash or a battery death.
`MAX_UNSAVED_MS` still forces a write every 30s during a continuous stream, because the scheduler
takes the MINIMUM of the two, so a long debounce cannot hold work indefinitely behind edits that keep
resetting it.

The number 2500 is asserted directly in `test/state/writecadence.test.js`. If that assertion ever
fails, the question is not "fix the test" — it is whether somebody meant to change how much work a
crash can take.

## verify_jwt has to be off for every browser-facing Edge Function, and the reason is the preflight

Symptom: clicking a plan produced `Failed to fetch`, and the console said the preflight to
`stripe-checkout` "does not have HTTP ok status". Both `stripe-checkout` and `stripe-portal` answer
`OPTIONS` with a 200 on their first line, so the function plainly never ran — the gateway rejected the
request before it.

**A CORS PREFLIGHT CARRIES NO `Authorization` HEADER.** It cannot: the spec forbids it, which is the
whole point of a preflight — the browser asks permission BEFORE sending the real request and its
credentials. So Supabase's default JWT check 401s the `OPTIONS`, the browser never sends the POST, and
the function is unreachable from a browser entirely. Nothing appears in its logs, because nothing ran.

THE PLAUSIBLE-SOUNDING WRONG ANSWER is the one that shipped in the README: leave `verify_jwt` on for
checkout and portal, because "those are called by the browser and the JWT is how they know who is
asking". The second half is true and the conclusion does not follow. Every one of these functions
verifies the caller ITSELF against `/auth/v1/user` and returns 401 without a valid token; the gateway
check only proves that SOME valid token was presented, not which user, which is the thing they
actually need and have to ask for anyway. Turning it off removes a check that was never load-bearing
and was preventing the request from arriving.

Applies to `delete-account` too, and it was live with the same fault — account deletion would have
failed in the browser for exactly this reason, unnoticed because nobody had exercised it in
production.

WATCH: this is a DEPLOYMENT setting, not a code one, so no test in this repo can catch it. `config.toml`
is deliberately not in this repo — it carries the `project_id` and an archive that overwrote it would
unlink somebody's project — which means the four `verify_jwt = false` entries live only in
`supabase/functions/README.md`. That is the weakest link in the whole billing path: nothing fails
locally, nothing fails at build, and the first sign is a customer who cannot pay.

## The wizard that did not fire — and the screen that stood in for it

`src/App.jsx`: the load effect, the skip flag, and `SetupBar`. Tests `test/views/onboarding.test.jsx`;
both guards verified by reversion.

Reported as **a newly created account landing on the old "cash on hand" screen instead of the setup
wizard**. Two independent faults, plus a third thing that turned either of them into a wrong-looking
product rather than a missing prompt.

**FAULT 1 — THE TRIGGER READ STORAGE METADATA, NOT THE MODEL.** The wizard fired on `r.isNew`, which
means "the backend had no document row". That is one stray write away from false — a name seed, an
entitlement probe, anything that calls `save()` on arrival — and when it flipped, the wizard silently
did not fire. The question actually being asked is "is there anything in this model", so it is now
answered from the document in hand: `!hasSubstance(r.doc)`, the SAME predicate the adoption dialog and
the name seed already use, so the file holds one definition of an empty document instead of three.
`isNew` still gates the two offers to import somebody ELSE'S document (kept-demo promotion, stranded
local model), which is where it belongs: if the server already holds a document, offering to replace
it is not a migration, it is a conflict.

**FAULT 2 — THE "NOT NOW" FLAG WAS GLOBAL AND CLEARED NOWHERE.** `runway:setup-skipped` was a single
sessionStorage key, written on cancel/import/done and removed by nothing — not on sign-out, not on a
company switch. sessionStorage outlives a sign-out within a tab, so ANY tab in which the wizard had
once been dismissed suppressed it for every account opened in that tab afterwards. That also explains
the shape of the report — it worked when first tested and stopped later — because the flag accumulates.
It is now keyed by company (`runway:setup-skipped:<id>`), so declining for one cannot answer for
another. `currentCompanyId()` reads `activeCompany()` on the auth ADAPTER, which is synchronous and
already resolved by the time the document has been read — NOT `getSessionProvider()?.()`, which returns
the session OBJECT and crashed DocumentHost the last time somebody reached for it.

**THE THIRD THING, and the reason a trigger bug read as a design.** The empty-model screen rendered
INSTEAD of the app, so a prompt that failed to appear did not look like a missing prompt: it looked
like a different product, asking for cash on hand, with nothing on it hinting a setup flow existed at
all. In hosted mode it is retired in favour of `SetupBar` — a strip above the working app carrying
"Set up your company" and an import — so if the trigger ever breaks again the failure is a missing bar
rather than a wrong screen. The full-screen version survives in LOCAL mode, where there is no account,
no landing screen and therefore no wizard, and where it is also the only door to the demo.

The bar is deliberately NOT the unpaid bar's amber. One is an invitation and the other is a warning,
and two bars that look alike train people to dismiss both.

WATCH: the shell is keyed on the `onSetup` PROP, not on a local `syncConfigured()` call. The host
decides the mode once and passes the consequence down; re-deriving it in the child would be a second
source of truth for one fact — the trap this file already records for the auth gate, and the two DO
disagree, since the host is configured by an injected env while `syncConfigured()` reads
`import.meta.env`.

## The Scenarios white screen — and why one deref took the whole app down

Reported as "the Scenarios tab is broken and clicking it yields a blank white screen that cannot be
escaped". Two separate faults, and the second is the more important one.

**THE DEREF.** `zeroInfo(rows)` returns **`null`** — NOT `{ months: null }` — when the balance never
crosses zero (cash-positive, or simply beyond the horizon). `engine/labor.js:63` says so in a comment.
`Scenarios.jsx` was written believing the other thing and did `s.zero.months` in the legend and
`z.months` in the table. Any model with cash and no burn crashed, which is EVERY brand-new account
between entering cash and adding the first expense — a state the recent onboarding work makes more
common, not less. Fixed with a local `monthsOf(z)` that collapses both never-crosses shapes into one
nullable number, so no caller has to know the difference.

WHY THE SUITE MISSED IT: `test/views/scenarios.test.jsx` uses `demoDoc()` throughout, which always has
burn and therefore always has a finite zero date. The existing WATCH note in the scenarios section
("a directional test must keep the runway finite") documents the habit that hid this — every scenarios
test was carefully staying inside the one branch where the bug is invisible. Audited every other
`zeroInfo` consumer while here: `docsummary.js` guards with `z ? … : …`, and App's `zeroConf` derefs are
safe because `showConf = toggles.speculative && !!zeroConf`. The bug was confined to Scenarios.

**THE UNESCAPABLE PART, which is structural.** React unmounts the entire tree on an uncaught render
error, so one bad dereference produced a blank page with no rail, no nav and no way back — you could not
click to another tab because there was no tab left. `ViewBoundary` (in App.jsx, exported for test) now
wraps the VIEW AREA only, deliberately: the rail and topbar stay mounted, so recovery is real navigation
rather than a prettier dead end. It is KEYED ON THE VIEW — without that, one crash leaves the boundary
stuck in its error state for every view thereafter (guarded by a test; removing the key fails it). It
does not swallow the error: `componentDidCatch` logs it, because a caught crash that leaves no trace is
a bug nobody fixes. The card states the model is unharmed and prints the message for a bug report.

Tests `test/views/crashsafety.test.jsx` (8), both fixes verified by reversion.

## Demo mode (localStorage, a 12-hour wall clock, and ONE door to real)

`src/state/backends/demo.js` + `src/views/chrome/PromoteDemoDialog.jsx`. Tests `test/views/demo.test.jsx`
(23). Entry is `#demo` from the sign-in screen or the empty shell; auth is bypassed entirely, and
`activateDemoBackend()` swaps the whole backend at the seam so nothing reaches Supabase or IndexedDB.

**sessionStorage -> localStorage, and WHY the original reasoning survives.** The old comment justified
sessionStorage on the grounds that demo data must never land where `peekLocal()` looks, or the adoption
flow would offer to upload a fictional company into a real account. That reasoning is intact: real local
models live in IndexedDB via idb-keyval, the demo lives in localStorage under `runway:demo`, and those
are different stores. What forced the move was that sessionStorage DIES WITH THE TAB — which makes a
twelve-hour window unreachable, and (the stronger reason) loses the demo across a sign-up round trip,
since confirming an email frequently opens a different tab. The memory fallback also moved to MODULE
scope: the helpers (`demoRemainingMs`, `demoInProgress`) are called by App without a backend instance in
hand, so a per-instance fallback made them report "no demo" on exactly the browsers doing the fallback.

**The clock is WALL CLOCK from first entry**, chosen over tracked-active-use: a window you can name
("expires at 9pm") is one someone can plan around. The envelope is `{ startedAt, doc }`; `createDemoBackend`
ADOPTS an existing `startedAt` rather than stamping a new one (else every refresh restarts the twelve
hours) and `write()` carries the original forward (else every edit buys more time). Both are tested by
reversion. Expiry is checked BEFORE `activateDemoBackend` in App's `useState` initialiser, because the
backend reseeds over a closed window and would erase the one fact needed to explain what happened; the
hash is NOT a usable signal there, since routing rewrites it to `#pay`/`#proj` on the first click. The
DemoPill polls every 30s and, on expiry, marks/wipes/reloads ITSELF — self-contained precisely so there
is no parent callback to declare in the effect's deps (exhaustive-deps is an error now).

**Pill copy changed with the behaviour.** It used to say "nothing is saved", which was already slightly
false (edits survived a refresh) and is now flatly false. It reads `Demo · resets in 4h 10m`.

**Export and import are BOTH withheld in demo, for different reasons.** Import is the dangerous one and
was a live data-loss path: a real model imported into the demo dies with the window. Export contradicts
this app's own "your only backup" doctrine everywhere else, and the contradiction is deliberate — a demo
is disposable by construction, so nothing here wants backing up, and the honest replacement is "keep
this". A guard test asserts they are still present OUTSIDE demo mode, since withholding them globally
would remove real users' only backup. NOTE both this and the expiry are PRODUCT SIGNALS, NOT ENFORCEMENT:
"Leave demo" wipes and re-entry starts a fresh twelve hours, and the JSON is a devtools panel away. Real
anti-freeloading needs server-side identity, which costs the Supabase load demo mode exists to avoid.

**Promotion — a DELIBERATE REVERSAL of a previous design choice, flagged not quietly edited.** The load
effect used to bail on demo outright ("a demo has nothing to migrate, and nothing it touches is real"),
correct while demo data was strictly disposable. It no longer is. "Keep this model" calls
`stashPromotion(doc)` — snapshotting AT THE MOMENT OF INTENT, not of arrival, because between the click
and a confirmed email sits an unbounded wait that the demo's own window can close inside. The stash has
its own 7-day life and `clearDemo()` deliberately does NOT touch it, since leaving the demo is exactly
what somebody does on the way to creating the account. It is claimed by the first `isNew` account load,
checked BEFORE stranded-local adoption (more recent, more explicit signal). The dialog ALWAYS offers both
doors — "use this as my model" and "start clean" — because the demo starts as a FICTIONAL company and
there is no reliable way to tell "spent an hour making it theirs" from "clicked around for ten minutes";
the copy says plainly that the sample data comes along.

## Projection journal (Phase 1 DONE — the recorder; Phases 2-3 deferred until there is data)

`src/engine/journal.js`, `src/views/chrome/JournalPanel.jsx`, UI at **Spend history -> Forecasts**
(routable `#hist/forecasts`). Tests `test/engine/journal.test.js` + `test/views/journal.test.jsx`.

WHY: the confidence band brackets the runway from the TIERS plus measured burn variance, but the app had
never stored what it predicted, so it could not say how good its own forecasts are. The journal records
that. It is the prerequisite for a genuinely statistical band, and — arguably more valuable — for
measuring BIAS ("you consistently land 12% below your three-month forecast"), which no band width can
express. Nothing here computes statistics: with a handful of snapshots any figure would be false
precision, the same trap that kept Monte Carlo out of the band. Phase 1 starts the clock.

CADENCE IS WEEKLY, deliberately (user's call, and it is the right one). More observations per lead time,
and — the real reason — it keeps PLAN CHANGE separable from FORECAST ERROR. A snapshot pair seven days
apart cannot differ because a quarter of reality unfolded; if the curve jumps that fast, the plan moved.
Nobody plans and hires inside a week. Monthly snapshots would smear the two into one indistinguishable
jump. `planDelta(a, b)` returns `{maxAbs, days}` and is what makes that legible; the Snapshots table
shows it as "moved by".

HONEST FRAMING, stated in the UI: a gap between an old forecast and recorded cash is **plan versus
reality**, not pure forecast error, and no arithmetic separates them after the fact. We name it rather
than pretend.

DIGEST, not a document copy: `{id, takenAt, atMonth, auto, toggles, cash, curve, end, zeroMonths}`.
Curve is ANCHORED start-of-month balances (what the user actually SAW), rounded to whole dollars.
Storing the whole doc would be huge AND wrong — replaying an old doc through today's engine measures the
engine, not the forecast. `toggles` rides along because a forecast made with speculative on is not
comparable to one made with it off, which Phase 2 depends on. `atMonth` is what makes LEAD TIME
recoverable, and lead time is why this pays off in months not years: 1-month-ahead error is measurable
after ~3 months, while 12-month-ahead error needs a year.

TRAPS HANDLED: `worthSnapshotting` refuses to record an empty document (zeroes would poison the
statistics later). The auto-snapshot effect is SELF-LIMITING — appending flips `dueForSnapshot` false for
a week, so the doc change it triggers cannot feed back into another snapshot (verified: no render loop).
`JOURNAL_CAP` 600 (weekly for a decade) bounds a field that is serialised on every save. `journal: []`
lands on existing documents through the `emptyDoc` spread in `migrate()` — NO schema bump. The demo
seeds four weekly snapshots (`SEED_JOURNAL` in seed.js) so the feature is visible immediately; it is in
`demoDoc` ONLY, never `emptyDoc` — fabricated demo history leaking into real documents is exactly the
bug fixed above.

PHASE 2 (needs ~3 months of data): error by LEAD TIME, plus bias. PHASE 3 (~12 months): replace the
band's heuristic width with empirical quantiles, hard-gated on sample size per lead time and falling
back to today's tier-bracket band — saying so — when N is too small.

## Labor prioritization (DONE — leave-one-out, net + cost-only)

`src/engine/labor.js` (`laborPriorities`), tested in `test/engine/labor.test.js`. For each employee,
remove them and recompute the runway zero-date (leave-one-out), in two modes:
- NET: also strips their project labor lines + grant personnel rows, so the revenue/work they enable
  goes too — their HONEST runway impact. A well-reimbursed grant hire can cost ~0 net.
- COST-ONLY: removes just their salary; project work falls back to nominal rate. The gap net→cost-only
  = what they bring in (`broughtIn`).
Ranked by net Δ zero-date (positive = removing them extends runway = they're a net cost). Per-100-
grant-hours column shown only where the employee has grant-allocated hours (demo budgets grant labor by
ROLE with no employeeId, so per100h is null for all demo staff — correct, not a bug). Reuses
buildModelFromDoc from the scenarios work. Memoized in the UI (N rebuilds). UI: a Prioritization tab in
Payroll (`LaborPriority.jsx`), routable at #pay/priority. Tests `test/views/labor.test.jsx`.
REAL BUG the tests caught: `zeroInfo` returns bare `null` (NOT `{months:null}`) when the runway never
goes negative — my zeroMonths did `zeroInfo(rows).months` and crashed. Fixed to `z ? z.months : null`.
Two other failures were fixture assumptions (demo grant labor isn't employee-linked), not engine bugs.

## Routing (DONE — hash-based, NOT React Router, behind a hook)

Chose the hash (`#view/tab`) over React Router deliberately: the hash is client-only (never sent to a
server), so it works from a file / any static host with zero config — matching this local-first app.
React Router's clean paths would REQUIRE a server configured to serve the app for every path, which we
don't have; adding it now would break refresh on file:// for cosmetics. Behind `useHashRoute` so the
swap to React Router (when the backend + clean paths arrive) is a hook-internals change, NOT a 9-view
rewrite — views call route/navigate, never window.location.
- `src/state/hashroute.js` — pure `parseHash`/`formatHash` (#view/tab <-> {view,tab}, unknown view/tab
  falls back to default, never blank), `useHashRoute` hook (owns route, listens for hashchange so
  back/forward + manual edits work; tab change REPLACES history, view change PUSHES). Tests:
  `test/engine/hashroute.test.js` + `test/views/routing.test.jsx`.
- App's `view` comes from the hook; the 6 tabbed views take `routeTab`/`setRouteTab` and derive their
  tab from it (validated against an EARLY inline TAB_KEYS list — see the trap below).
TRAP HIT (again): validating tab against `TABS` failed with "Cannot access 'tab' before initialization"
— 3 views use `tab` BEFORE the (late) TABS definition. Build was GREEN; only vitest caught the TDZ.
Fixed by an early TAB_KEYS array. And my hardcoded TAB_KEYS drifted from real TABS (fulfil not
fulfillment, goals not rounds) — cross-checked against the actual TABS to fix. Lesson restated: run
vitest, not just build; TDZ + duplicate-const only show in the test transform.

## Routing note
## QuickBooks import — a 4-piece build (COMPLETE)

The full import turns "coded spend ledger" into a dimensioned general-ledger actuals system with grant
reconciliation. Four pieces, in dependency order; the importer is LAST because three-quarters of the
work is the actuals model underneath it.

- **Piece 1 — DIMENSIONED LEDGER (DONE).** A ledger line grew from `{ code, amount, note }` to
  `{ code, amount, note, kind?, category?, period? }`. Every new field is optional and defaults to
  today's behaviour: **absent `kind` means cost**, so all pre-v3 data and the golden number are
  unchanged (schema v2→v3 is purely additive; migration adds `customerMap`/`categoryMap`, touches no
  line). The load-bearing guarantee, pinned in `test/engine/dimensions.test.js`: a revenue line is
  money IN and never nets against spend — `monthTotal`, `codedActuals`, `overheadByMonth` all count
  cost only; `monthRevenue` and `codedRevenue` capture revenue separately (for Piece 3).
- **Piece 2 — CUSTOMER→PROJECT mapping (DONE).** A line can carry a `customer` alongside `code`, and a
  `customerMap` resolves customer→project. The unifying change: all summations now route through one
  `resolveLine(line, maps)` — customer first (more specific "which project"), then code. Backward
  compatible: passing a bare `codeMap` reproduces the old behaviour exactly (all 163 prior tests
  unchanged). UI: an "Unmapped customers" panel in the Ledger tab, twin of the code panel, built as you
  go. The importer seam now emits customer/category/period/kind on each line. Tests:
  `test/engine/customer-mapping.test.js`.
- **Piece 3 — REVENUE REPLACES PROJECTION (DONE).** `src/engine/revenue.js` (`applyRevenueActuals`),
  tested in `test/engine/revenue.test.js`. The four pinned rules: PAST-ONLY (replace up to each
  project's last recorded revenue month, per-project bound, forward forecast untouched); TOTAL
  SUPPRESSION (a recorded month removes ALL that project's projected revenue lines, incl. a recorded
  $0); ALWAYS ON (no toggle); FLAGGED (variances surfaced in a Ledger-tab panel, but the actual is
  still used). Design: a PURE pre-processing step that swaps projected-revenue lines for one-time
  actual lines, then the untouched buildProjection runs — no surgery in the hot loop. Golden-safe: with
  no revenue actuals it returns the SAME line-item reference, so the demo (5.6mo) is provably
  unchanged. PO revenue lines resolve to a project via `poProject` (poId->projectId); project lines
  carry projectId directly.
- **Piece 4 — THE IMPORTER (DONE).** The app never assumes column names — it reads any CSV/Excel into a
  raw grid and a PROFILE maps columns to fields, so it's a general expense importer that QuickBooks (or
  Xero, or a bank export) feeds. Pieces:
  * `fileToGrid(file)` — File -> { headers, rows } via SheetJS (CSV + Excel, one path).
  * `applyProfile(grid, profile)` — PURE transform -> ImportRow[]. Handles the two danger zones:
    date format is DECLARED not inferred (03/04 is March or April only per the profile; parsed at noon
    local so the UTC-midnight day-shift bug can't recur), and amount sign is a declared mode
    (signed / expensesPositive, parens = negative, strips $/,). Fully tested with no real file:
    `test/engine/profile.test.js` (15 tests).
  * `ImportModal` — file picker -> map columns (dropdowns pre-filled by fuzzy header guess or a saved
    profile) -> live preview (sample rows + a merge report: N import, M before start, K skipped, J need
    mapping) -> commit. Saves an `importProfiles` entry so re-imports from the same source skip mapping.
  * Feeds the existing `mergeImport` seam; unmapped customers/codes then flow through the Piece 2 panels.
  ALL FOUR PIECES COMPLETE.

- **Expanded-card collapse button is top-LEFT, not top-right.** The delete button (destructive) is the
  last child of the card header flex row = top-right. The collapse button was `position:absolute;
  top:14px;right:14px` = the SAME corner. Stacking a benign control on a destructive one is a hazard.
  Fix: `.projwrap>.projfold{left:13px;right:auto}` + `.projwrap .pcard-h{padding-left:46px}` moves
  collapse to the left in EXPANDED cards only; the collapsed-header chevron (`.collapsed .projfold`,
  no delete button beside it) keeps the base `.projfold` right position. Guarded by
  `test/views/foldsafe.test.jsx`. The collapsed-header chevron is ALSO moved left
  (`.collapsed .projfold{left:13px;right:auto}` + `.csum-head{padding-left:34px}`) so that clicking to
  EXPAND doesn't land the cursor where the delete button appears once the card opens — the whole point
  is the expand/collapse target is top-left in BOTH states, delete is always top-right. Watch: the
  minifier reformats `.projfold` rules, so verify via specificity (`.collapsed .projfold` and
  `.projwrap>.projfold` are both 0,2,0 > base 0,1,0), not by grepping the bundle string.

- **"View cost codes" modal** (`CodeMapModal.jsx`, button in the ledger panel header). The FULL
  code->project mapping table with add/delete — distinct from the ledger's "Unmapped cost codes" panel,
  which only prompts for codes seen in spend but not yet mapped. Both coexist deliberately: the panel is
  the nudge, the modal is the manager. Add-row offers ledger codes not yet mapped as datalist
  suggestions + quick chips. A stale mapping (project since deleted) stays visible as an option rather
  than silently vanishing. Guarded by `test/views/codemap.test.jsx`.

- **Fringe rate: itemized OR manual (`src/engine/fringe.js`, `resolveFringeRate`).** The company fringe
  % that `empCostAt` applies can be built from parts (PTO days/260, payroll tax %, 401k match capped by
  employee deferral, insurance $/person as a % of AVERAGE salary) or typed as a manual %. Precedence:
  manual wins when set; blank manual falls through to itemized; blank itemized falls to the legacy
  `settings.fringePct` default — so an untouched doc is UNCHANGED (golden safe, still 5.6). `fringePct`
  remains the single resolved output feeding everything downstream; only its computation changed, so the
  `empHourlyAt` (salary-only, grants) vs `empCostAt` (salary+fringe) convention is untouched. Insurance
  needs a salary base to become a %, so it's computed against average annual salary. UI: two-mode Fringe
  tab. Engine tests `test/engine/fringe.test.js`, UI `test/views/fringe.test.jsx`. NOTE: the fringe UI
  test needed a STATEFUL harness (a wrapper with useState) because the inner RunwayApp is controlled —
  a setDoc that just mutates a local var doesn't re-render.

- **Frictionless import (step toward the eventual QB API).** Two upgrades, both keeping the API-ready
  shape (the API will emit the same ImportRow[] the file path does): (1) TOLERANT profile matching
  (`matchProfile` in importer.js) — a saved profile matches if every column it MAPS still exists, so an
  added/reordered column between exports doesn't force a re-map; prefers the most specific satisfied
  profile. (2) INLINE code/customer mapping in the import preview — new codes/customers in the file get
  dropdowns BEFORE commit, so you don't hunt them in panels afterward. ImportModal now takes
  projects/codeMap/customerMap + setters. Tests: profile.test.js (tolerant match), import.test.jsx.
  ARCHITECTURE NOTE for the future QB API: it's Option C (hosted, backend holds the OAuth client secret
  — can't live in the browser). The app owner confirmed the destination is a real product w/ backend,
  but chose to make import frictionless FIRST (no backend yet). When the API lands it's a new SOURCE
  feeding the existing applyProfile->mergeImport pipeline, not a new pipeline. storage.js stays the
  2-function seam for that day.

## Plot against reality (per-project charts)

Each expanded project card charts projected-vs-actual over time. `src/engine/projectchart.js`
(`projectSeries`) is the pure data layer, tested in `test/engine/projectchart.test.js`:
- Three metrics — cost, revenue, net (revenue − cost) — each as a projected line plus a recorded-actual
  overlay. Projected comes from the project's compiled line items; actual from codedActuals/codedRevenue.
- The asymmetry is the point: projection runs the full horizon; the actual series STOPS at the last
  recorded month (`actualThrough`) — you can't have an actual for a month that hasn't happened.
- Monthly ⇄ cumulative toggle (cumulative is a running sum; better for "tracking to budget").
- Runway is deliberately NOT per-project — a single project doesn't run dry, the company does; that
  stays the company RunwayChart.
UI: `ProjectChart.jsx`, an inline SVG in the expanded card (all three card types via `ProjectChartWrap`,
which pulls hist/maps from ActualsCtx). Tested in `test/views/projectchart.test.js`. Note: `importProfiles` on the document is filled via the emptyDoc spread in
  migrate(), so no schema bump was needed. The full engine seam lives in `src/engine/importer.js`: `src/engine/importer.js` (`mergeImport`,
  `monthIndexOf`, `codesInRows`), tested in `test/engine/importer.test.js`. It takes already-parsed
  `ImportRow[]` ({ date, code, amount, note }) and merges them into the ledger, bucketing by month off
  the model start, appending (not replacing) existing months, and reporting pre-start / bad rows.
  WHAT'S LEFT: (1) the file parser — the ONLY format-dependent part, waiting on a real QuickBooks
  export to see the actual column names; (2) an import UI (file picker → preview report → map new
  codes → commit). A live QuickBooks *API* connection is NOT possible here: OAuth needs a client secret
  and redirect URI, which need a server, which this app deliberately doesn't have. File import is the
  fit, and everything downstream of the parsed rows already exists.
- Cost-share reconciliation (does a grant's match actually get spent?) + a real profit number — has the data shape now
- Labor prioritisation by leave-one-out: Δzero-date per 100 hours (the zero date is the discount rate)
- Routing for the ~29 addressable places

`split.py.reference` is the script that produced this from the artifact. Kept for archaeology only.
