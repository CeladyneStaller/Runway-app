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
importable `harborpoint.xlsx` fixture and re-importing.

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

## Commitments — schema v5, engine, tab

A signed obligation was real from the day it was signed and invisible until the month it was paid: a
$200k PO payable in month 20 left runway at 5.6 and every screen looking identical to not having signed
it. Verified against the engine before building anything.

**RUNWAY DOES NOT CHANGE.** `zeroInfo` untouched, golden unmoved. What is added is a SECOND reading —
`coveredMonths`, how long the cash lasts if every obligation is honoured — because "when do I run out"
and "can I sign this" are different questions.

**THE INVARIANT: every commitment owns exactly one outflow.** A promoted commitment REFERENCES an
existing cost line and creates nothing; a manual one creates its own; removal deletes the line only if
it created it. **A test asserts promoting leaves the projection BYTE-IDENTICAL** — without it, a lease
recorded as both a recurring cost and a commitment doubles the burn silently.

**COVERED RUNWAY IS `zeroInfo` ON ADJUSTED ROWS.** My first version scanned whole months while
`zeroInfo` interpolates, and reported a covered runway of **6.0 against a runway of 5.6 — LONGER**,
which is nonsense. A units mismatch reading as a finding, and the sort of number somebody repeats in a
board meeting. Both now come from the same function over the same rows with the obligation subtracted,
so they are comparable by construction and a test asserts covered <= runway.

**Cover is CUMULATIVE**, not per-commitment: two obligations individually affordable and jointly
impossible is the same failure fixed on the milestones chart.

**Month end, not month start.** Commitments carry a month index and `balanceAtDate` takes a day. A
payment due in a month is due by its END; reading the balance on the 1st would call an obligation
covered on money that leaves later the same month.

**Recurring lines are NOT promotable.** A lease's whole remaining term being "uncovered" is true and
useless — six figures of unavoidable rent permanently at the top of a list meant for discrete decisions.

## Commitments on the Cash flow → Costs sub-tab

Read-only, using the existing `roTable` helper that Payroll and Project costs already use — so it looks
like the other derived sections rather than a new kind of thing.

**IT ADDS NOTHING TO THE PROJECTION AND THE PANEL SAYS SO.** A promoted commitment references a line
that was always in the plan; a manual one created its own; cost share is derived from the award. The
money is already below. A reader who thought this section ADDED to the projection would conclude the
runway was wrong, so the subtitle states it outright and a test asserts the sentence is present.

**Editing stays on the Commitments tab.** Two places to change one obligation is how the two disagree.
A test checks no writing control appears here.

**THE ANCHOR APPEARED TWICE.** `{baselineOpex > 0.5 && (` exists in both the net-cash-flow branch and
the costs branch, and a first-occurrence replace put the section on the Net tab — where it rendered
nothing at all, because that tab never shows it. The tests failed with the section apparently missing
rather than misplaced, which is the confusing version of that bug. Anchor on `{tab === "costs"` first,
then find the marker within it.

Degrades without `rows`: some render paths mount the view before the projection exists, and a table
missing its cover column beats a tab that does not render.

## Project plan — milestones, gates and tasks (schema v7)

**ONE FLAT LIST, ONE VOCABULARY.** `kind: "milestone" | "gate" | "task"`, a task carries `parentId`.
Nesting tasks inside milestones reads better in a mockup and is worse here, because THE FILED TABLE IS
FLAT — one row per entry in a fixed order — so every reorder, renumber and export would have to flatten
it first.

**⚠️ THE NAMING IS CONFUSING AND IT IS THE FORM'S FAULT.** On Appendix E a milestone occupies a TASK row
(column 1 is "Task Number or Subtask Number") and the work beneath it occupies SUBTASK rows typed
"Task". So `kind: "milestone"` prints in the task-number column and `kind: "task"` prints in the
subtask-number column. Storing the form's words would mean a field called `task` that is sometimes a
milestone; storing ours and translating once, at export, keeps every other file honest.

**Order is TARGET FIRST, THEN ITS TASKS — never by date.** Sorting by month interleaves one milestone's
tasks with another's, which is not the shape the agency asked for. Task 1.1.1 is month 3 and still
prints after its month-6 milestone.

**NUMBERS ARE ASSIGNED, NEVER TYPED**, and deleting does NOT renumber siblings — the numbers are in a
filed document, so a gap is correct. An orphaned task is kept and shown rather than dropped.

**MONTH 0 IS Q1**, not Q0. The form counts quarters the way people count them aloud, and an off-by-one
here is printed in a filed table.

**A GATE HAS NO DEFAULT OUTCOME.** What a failed gate does to an award is a term of that award;
defaulting to "stops entirely" would put a cliff in the projection nobody agreed to. It is listed as a
gap instead.

**GAPS ARE REPORTED, NEVER ENFORCED.** Requiring verification text before a row saves would stop people
recording the DATE, which is the part the model needs.

**Verification is ONE field, not four** — the form prints a single cell, so four inputs would mean
joining them back and guessing the punctuation.

**Two mistakes of mine worth keeping:** a regex adding props to `Projects` stopped at the first `}`,
which belonged to `setRouteTab = () => {}` rather than the parameter list; and `monthLabel(y, m, idx)`
takes THREE arguments — I summed the last two myself and the date rendered as NaN until a test caught
it.

## Overhead adjustment — Corey's negative-line idea, and the trap in it

**The idea works: a negative recurring cost line reduces spend.** But it would have CANCELLED ITSELF.

    companyOpexNow  = recurring cost lines starting <= month 0     <- a negative line was IN this
    itemizedOpex    = companyOpexNow + payrollNow
    baselineOpex    = max(0, derivedBurn - itemizedOpex)           <- so this GREW by the same amount

**A -$5,000 line shrank `itemizedOpex` by $5,000 and grew the baseline by exactly $5,000.** Net zero,
silently — a founder with tracked spend history types "reduce overhead by $5,000", watches nothing
happen, and has no way to see why. **Worse than the feature not existing.**

**Fix: `!l.adjustment` in the `companyOpexNow` filter.** The line still spends; it just must not feed
the subtraction it is trying to reduce.

**⚠️ THE FLOOR IS VISIBLE.** A cut larger than what is being spent would make overhead pay you.
Clamped at the headroom, and the clamp is SHOWN — somebody who types $80,000 against $22,200 must see
the difference was refused, or they read a runway built on a number they did not enter. **Existing
adjustments count against the headroom**, or two cuts would both apply and take it negative between
them. An INCREASE is never clamped: there is no ceiling on what somebody could choose to spend.

**IT LIVES ON OPERATING COSTS, not the baseline tile** — Corey's call, and right: "how much could I
save" is a question about operating costs, and the routing through the derived baseline is an
implementation detail nobody should need to know to ask it. **The baseline tile's copy changed with it**
— it used to say "itemise more to move it", which became untrue the moment this shipped.

**`if (!targetId) return []` swallowed it.** An adjustment has no target — that is its whole point —
and the guard was written for edit and remove.

**`-0` needed normalising.** It compares unequal to `0` under Object.is and prints as "-0" in anything
derived from it.

## Scenario forms — real fields, real controls

**MONTH FIELDS ARE A MONTH AND YEAR NOW.** "8" in a Starts field means eight months into the projection,
which somebody has to compute from a start date they may not have in mind. The pair is what people think
in; **the index is shown underneath** because it is what the model stores and what an agency form asks
for, so the two cannot drift apart.

**DOTTED KEYS REACH INTO NESTED OBJECTS.** A grant's terms live under `project.grant`, and a registry
that could only patch top-level fields could describe a project's NAME and nothing that decides its
cash. Projects now carry agency, cost share and type, reimbursement timing and lag.

**CONDITIONAL FIELDS.** A round's terms depend on its type — showing "rate APR" on a SAFE, or "royalty %"
on a note that converts, invites somebody to fill in a field the engine never reads. Same class of bug
as an invented key, arrived at from the other direction.

**DEBT IS OFFERED AGAIN.** It was excluded because the old form could not carry a rate or a term, and a
facility without them is money that arrives and never leaves. The conditional fields supply them, so the
reason for the exclusion is gone.

**⚠️ `fulfilCost` WAS INVENTED AND THE GUARD CAUGHT IT.** Cost to fulfil is not a PO field — the model
expresses it as a FULFILMENT PROJECT linked by `projectId`, where labour is your own team's time and can
follow a real salary. A number on the order would have been a second, disagreeing place for the same
cost.

**THE GUARD NOW CHECKS THE ENGINE AS WELL AS THE DEMO.** `maturityMonths` is read by `capital.js` but no
seeded round is a maturing note — checking only the demo would fail correct keys, and checking only the
source would pass a typo that happens to appear in a comment.

**STILL TO BUILD:** operating costs "change existing" against the DERIVED BASELINE — adjusting untracked
overhead without a line item. That is not a patch on any collection; it needs a settings-level
adjustment the projection reads, and `buildmodel` has no such lever yet.

## Cash on hand from QuickBooks

**IT WAS NEVER THERE.** `qbo-sync` pulled `ProfitAndLossDetail` and `AgedPayableDetail` — an income
statement and an aged payables report. **Neither carries a bank balance**, which is why the ledger has
synced since day one while the founder typed their cash figure in by hand every month. That figure
drives where the runway and clean-exit scans BEGIN and the `anchorToActuals` offset for the whole
forward projection.

**`BalanceSheet` with `accounting_method=Cash`.** ⚠️ Accrual would be the wrong number: on accrual the
bank line can include amounts recognised but not received, which is not runway.

**⚠️ `bankAccountsSource` RETURNS THE LIST AND NEVER A SUM.** QuickBooks' Bank type includes a merchant
holding account, a foreign-currency account, an escrow — things a founder may not count as runway.
Summing them is the obvious rule and quietly wrong for some companies.

**IT EXCLUDES THE SECTION TOTAL.** "Total Bank Accounts" would appear as a selectable row and, ticked
alongside its members, would double every balance.

**The choice is remembered BY ACCOUNT ID**, so it survives a rename in QuickBooks — and every account is
still SHOWN, because a remembered choice that filtered would hide an account added since.

**NOTHING IS OVERWRITTEN.** The import shows what it found beside what is recorded, with the difference,
and waits. A hand-entered figure may be the better number — reconciliation lags, and somebody who looked
at their bank this morning knows something QuickBooks does not.

**WIRED.** The panel sits on the Cash on hand sub-tab beside the column it fills, and `App` supplies
`onPullCash` from the same sources as the payables pull — read at RENDER, not held, so a connection made
in another tab does not need a reload.

**⚠️ ABSENT UNLESS QUICKBOOKS IS CONNECTED.** A "pull cash" button that opens a connection flow is a
different promise from one that reads a balance, so `onPullCash` is null and the panel renders nothing.

**The account choice lives on the document** (`settings.qboCashAccounts`), not in component state —
component state would ask the same question every month.

**⚠️ THE PARAMETER-LIST REGEX BIT A SECOND TIME.** `[^}]*` stops at the `}` of `takeSnapshot = () => {}`
— a DEFAULT VALUE, not the end of the list — and mangled `History`'s signature twice before I stopped
patching the patch and rebuilt the line from the recovered prop names. Adding a prop to a component
whose signature contains an arrow default needs the LAST brace on the line, not the first.

## Scenarios rebuilt on the eight factors — in progress

**⚠️ THE TILES REPLACED SEVEN HARDCODED INTENTS.** The old builder asked somebody to name a MECHANISM
("add an item to `rounds`") or picked from seven fixed questions that could not express the eighth thing
anybody wanted. The factors are the buckets the runway is made of, so a scenario built from them is
expressed in the same terms as the number it moves.

**`factors.js` — one registry driving the scenario form**, so it cannot express something the real
editor cannot open. Add / Change existing / Remove existing, with removal carrying an optional DATE.

**⚠️ REMOVAL FROM A DATE IS AN EDIT, NOT A DELETION** — it sets the item's end month, so everything it
produced up to then survives. A deletion that wiped the accrued cost share would flatter every scenario
built this way, in the direction founders least need it. This is a failed go/no-go typed by hand, which
is what keeps the milestone plan isolated.

### Five real regressions found by deleting the old form

Each was behaviour the dedicated fundraise form carried and the generic builder lost:

1. **⚠️ `{ kind: "item", op: "add" }` MATCHED NOTHING.** `applyPatch` dispatches on `kind === "add"` and
   `kind === "remove"` — every scenario built by the new tiles would have applied NOTHING and shown an
   unchanged runway, looking like the feature simply did not work.
2. **A round needs `scenarioRound`**, which fills `capType`, `confAuto` and `goals`. A generic object
   compiles to no instrument at all.
3. **The financing toggle.** Financing is a separate axis defaulting to off, so a scenario adding a
   round showed no change whatsoever at any status.
4. **Debt is excluded when adding.** A facility without terms is money that arrives and never leaves.
5. **"Closed" is excluded when adding** but kept when EDITING, where it is the whole point.

### Three test-harness bugs

**Factor names collide with nav-tab labels** — `btn(c, /Payroll/)` finds the TAB, clicks the rail, and
leaves the builder untouched. The old intent names could not collide.

**No `afterEach(cleanup)`**, so stale renders matched selectors. Same leak as the plan-io tests.

**The form had no `aria-label`s** — not merely a test affordance: a select labelled only by adjacent
text is announced as "combo box".

### ⚠️ THE WORST ONE: INVENTED FIELD KEYS

Four factors named fields that **do not exist on the document**. I wrote them from what the UI SHOWS
rather than from what the model HOLDS:

    pay.salary      -> the field is `amount`
    saas.customers  -> `startCustomers`;  saas.price -> `arpu`
    saas.churn      -> `churnPct`;        saas.growth -> `newGrowthPct`
    confidence on employees and lines — neither carries one

**A patch on a key nothing consumes saves, applies, and moves no number** — indistinguishable from the
feature being broken, and invisible in review because the form looks right.

`factors.test.js` now walks every factor's fields against a real item from the demo document and fails
on any key that is not there. It found `pay.salary` the moment it was written.

### Status ordering was a real choice too

The old form listed **committed first**, not chronologically. Somebody adding a round to a scenario is
usually asking "what if this lands" — the default the select opens on should be the one that moves the
number, not the one that moves it least.

### The last three

**The speculative warning was lost with the old form.** A planned or raising round counts as
speculative, and speculative is OFF by default — so a scenario adding one shows no change and reads as
a broken feature rather than as a correct answer about money that might not arrive. Restored as a
warning, not a block: "what if we raise and it stays speculative" is a legitimate question.

**Cash and confidence had no `fields`,** so their tiles selected and then offered nothing — a dead end
where the two most common changes live. The form renders from `factor.fields`; a factor without them
renders nothing.

**And they have no `collection`,** so the "which one" gate had to stop applying to them.

**DONE: all 35 scenario view tests pass.** Every one of the eleven failures was a real regression — a
rule the dedicated form carried and the generic builder lost — except the last two, which were tests
routing through an escape hatch that no longer needs to exist.

**ALL 35 PASSING**, all in the fundraise and "something else" blocks.
Every fix so far has been a real regression rather than an assertion adjustment; the remaining ones
should be treated the same way.

## The staleness feature was inert, and lint found it

**⚠️ `withFingerprints` WAS IMPORTED AND NEVER CALLED.** No patch ever carried an `fp`; `staleness()`
skips any patch that lacks one, so it always returned `[]`. **The badge never showed, the chart flag
never showed, and apply-to-plan never asked for acknowledgement.** The engine and all three display
sites were built and the single wiring call was not written.

**Fifteen passing tests hid it** because every one of them builds fingerprints by hand. The thing that
actually caught it was an `unused import` warning in a lint run — which is the argument for reading
warnings rather than only counting errors.

**It belongs at the ONE point a patch is added**, because a fingerprint records what a patch read AT THE
MOMENT IT WAS WRITTEN. Attaching it later would record the wrong instant and report every scenario as
fresh. Verified end to end: fresh document → 0 flags; the read field moved → "Series A: status was
planning when this was built; it is now raising"; the item deleted → "no longer exists in the model —
this change does nothing".

**Also cleared:** the duplicate `projects` prop on `<History>` (React took the last, so nothing
misbehaved, but it arrived when I threaded `doc`/`setDoc`/`onPullCash` in), and **the corpse of the old
intent form** — `pick`, `setR`, `ready`, `add`, `valueField`, `current`, ten pieces of dead state and
its empty-state fragment, which was a second answer to a question the factor tiles already answer on
the tile. Warnings 91 → 82, errors 0.

## First real suite run after the blocked-registry stretch — 5 failures, 3 causes

**1259 passed, golden green.** The five failures sorted into three kinds, and only one was a code bug.

**⚠️ A DEAD TERNARY BRANCH, and the test found it the first time it ran.**

    legendMode = (count) => (count <= 2 ? "endpoint" : count === 0 ? "none" : "swatch")

`0 <= 2` is true, so **"none" was unreachable** and an empty chart drew an endpoint legend. **Lint does
not flag a dead ternary arm** — this needed the assertion. The zero check comes first now.

**Three stale assertions in `plotframe.test.js`**, all the same cause: `monthTicks` started returning
`{i, year}` objects when the density rule landed, and the test still compared bare indices. **The test
file was written in a container where the suite could not run**, which is exactly how a shape change
gets away without its assertions following it.

**⚠️ `planxlsx.test.js` POINTED AT THE SANDBOX UPLOAD PATH** — `/mnt/user-data/uploads/...` — which
exists on no other machine, so it failed with ENOENT everywhere but where it was written. **`test/
fixtures/` already existed** (it holds `harborpoint.xlsx`); the convention was there and I did not use
it. Both SOPO workbooks are committed there now, and the suites `skipIf` the fixture is absent rather
than passing silently — a suite that quietly stops checking a real agency workbook is worse than a
visible skip.

**`sf424a.test.js` — pre-existing and not from this work.** `exportBudget` calls `XLSX.writeFile`,
and xlsx takes its BROWSER download path under the test environment rather than writing to disk.
Fixing it means either stubbing the write or having `exportBudget` return the workbook and letting the
caller save it — the second is better and is a small refactor.

**Windows note:** `TZ='America/Denver' npx vitest` is bash syntax. In PowerShell, `$env:TZ='America/
Denver'` once per session.

## The year rule, third and final version

**Corey noticed the runway chart carrying a year on every tick and preferred it.** That was not the
patch working — `RunwayChart` is not adopted and still uses `monthLabel()`, which formats every tick
`Jul 26`. But **the preference was evidence**: that chart labels every 2–6 months, which is exactly the
case where years cost nothing, because the ONLY reason to omit them is a smear and at six labels there
is none.

**So the rule measures instead of guessing.** Year on the first label always; on EVERY label when
either:

1. **They all fit with one** — derived from the same width measurement that already picks the step, so
   it stays one rule rather than "except on the runway chart", which is the conditional-rule trap that
   made version one worse.
2. **⚠️ A MONTH NAME REPEATS IN THE LABEL SET.** At a twelve-month step every label is the same month:
   `Jul 26 · Jul · Jul · Jun` — three Julys in three different years, indistinguishable. **The fit test
   alone produced exactly that on a 36-month phone chart**, and it only surfaced because the output was
   printed and read rather than assumed. Checking the ambiguity DIRECTLY (`new Set(i % 12).size <
   idx.length`) also catches a six-month step whose anchoring January falls outside the window.

**None of this is a per-chart setting**, which means adopting `RunwayChart` will preserve the labels
Corey likes rather than taking them away.

## Phase 0 — where it actually stands

**Done:**

- `src/engine/plotframe.js` — the single geometry source, pure functions, no JSX.
- `src/views/chrome/PlotFrame.jsx` — `PlotChrome` and `PlotLegend`.
- **`Chart.jsx`** — `scale()` and `xAt()` delegate; `TimeAxis` delegates its LABELS while still drawing
  a tick per month. Two of its three call sites pass the model start so the year rule applies; the
  third (`Axes`) has no start in scope and uses the fallback, which renders the caller's own labels.
- **`ProjectChart.jsx`** — delegates both scales.

**⚠️ A SECOND X MODE WAS NEEDED AND IS THE INTERESTING PART.** `ProjectChart` and `RunwayChart` place
marks at a CONTINUOUS position in a time domain (`t / tMax`), not at the i-th of n months — **a
milestone at month 6.5 is a real thing.** Forcing them into the index model to share a frame would have
moved every marker, which is the opposite of what the extraction is for. `plotFrame` now returns both
`x(i)` and `xt(t, tMax)`.

**⚠️ `RunwayChart.jsx` IS NOT ADOPTED, DELIBERATELY.** Its `y` is a multi-line function, it carries the
milestone markers and stranded logic, and it is the renderer I flagged as needing a screenshot before
and after. **Adopting it blind, with no test suite, at the end of a session is precisely what the plan
said not to do.** It still defines its own `x` and `y`; the duplication is down from three to two.

**VERIFICATION UNDER A BLOCKED REGISTRY.** npm has returned 403 since the container reset, so no suite
ran. Instead: **113 geometry points compared for `Chart.jsx`** and **58 further checks for
`ProjectChart` and the year rule**, all by reconstructing the previous implementation and diffing
outputs under Node. Zero real differences — the single reported mismatch was **my expectation being
wrong** (Dec 2025 + 1 month IS a January, so it correctly takes the year), which is worth recording
because the instinct is to edit the assertion.

**BEFORE TRUSTING ANY OF THIS: run the suite.** Then adopt `RunwayChart`, screenshot first.

## Phase 0b/0c — the chrome component, and Chart.jsx delegating

**`src/views/chrome/PlotFrame.jsx`** renders the chrome and NOTHING ELSE — frame, rules, ticks, zero,
the today divider — and hands the scales back through `plotFrame`. `PlotLegend` picks endpoint labels
or a swatch row from the series count, and orders the swatch row top-band-first to match a stack.

**The split is deliberate.** `RunwayChart` carries milestone markers and stranded-milestone logic that
has no business in a generic renderer; folding the three renderers together to share an axis would have
dragged all of it along.

**⚠️ `Chart.jsx` DELEGATES RATHER THAN RESTRUCTURES, and that was a decision forced by conditions.**
The npm registry started returning 403 after a container reset, so `vite` is missing and **the test
suite cannot run**. Restructuring a 630-line renderer blind is how a session ends with something that
looks finished and is not. Instead `scale()` and `xAt()` now call `plotFrame` and return the same shape,
so the 600 lines below them are untouched — the duplication is gone, the rendering is not disturbed.

**PROVED EQUIVALENT NUMERICALLY.** The pre-delegation implementation was reconstructed and compared
against the new one across six value sets and six month counts: **113 geometry points, 0 differences.**
That is not the test suite, but it is a stronger claim about this particular change than the suite would
have made.

**STILL TO DO IN PHASE 0**, and it wants a working suite first:

- Swap `TimeAxis` in `Chart.jsx` for `PlotChrome` — the visible half of the house style.
- Adopt in `ProjectChart.jsx`, then `RunwayChart.jsx` LAST, because its milestone markers are positioned
  against its current scale and are the most likely thing to move.
- **Take a screenshot before each adoption.** It is the only way to tell "it moved because the frame is
  shared now" from "it moved because I broke something".

## Phase 0a — `plotframe.js`, the single geometry source

**⚠️ THREE RENDERERS EACH DEFINED THEIR OWN `x` AND `y`.** `Chart.jsx`, `RunwayChart.jsx` and
`ProjectChart.jsx` all computed their own scales and two carried their own `PAD` — three independent
answers to "where is zero on this canvas". A gridline two pixels off its own baseline is the kind of bug
nobody reports and everybody notices.

**THE MODULE OWNS THE GEOMETRY, NOT JUST THE DECORATION.** Drawing chrome while each renderer kept its
own scales would have left them free to disagree, which is the failure the extraction exists to remove.
Pure functions, no JSX, so it tests without a DOM.

**What it settles, each with a reason in the source:**

- **`412k`, one unit all the way up.** Switching to `1.24M` halfway up an axis nobody expects to change
  scale is how a reader misjudges a magnitude by three orders.
- **⚠️ THE DOMAIN ALWAYS INCLUDES ZERO.** Starting at 300k because the data sits between 300k and 600k
  doubles the apparent slope of a decline.
- **Four rules, fixed.** Adaptive counts make two charts on one screen disagree about where the rules
  sit, which reads as a difference in the data.
- **Year on the first label and every January** — Corey's rule, which replaced mine. I had "January
  only" plus a fallback for windows containing no January plus another for phone widths that drop it.
  **Two exceptions to a rule that fires "usually" is a rule that fails in the cases nobody tests.**
- **Labels thin on a FIXED sequence** — 1, 3, 6, 12 — so the same chart does not label differently on
  two devices.
- **No vertical rules on bars or stacks.** They already divide the months.
- **The legend switches on series count**, not on a setting: 1–2 endpoint labels, 3+ a swatch row.
- **Zero is reported separately from the rules** and drawn heavier — it is a real event here.

**Decisions settled by Corey before build:** chart building is **ungated** (an unsaved custom chart is
not a write, and gating it would make an unpaid account look broken rather than limited); **an advisor's
saved charts live with the advisor**, not the company.

**⚠️ THE TEST SUITE COULD NOT RUN IN THIS CONTAINER** — the npm registry returned 403 after a reset and
`vite` is missing. `test/engine/plotframe.test.js` is written and committed; **the 31 assertions were
verified by running the module directly under Node instead.** Run the suite before trusting the file.

## Scenario staleness — flagged in all three places

**⚠️ THE FINGERPRINT IS STORED; THE FLAG IS DERIVED.** A fingerprint records what a patch READ at build
time and cannot be recomputed later — the past is gone. The comparison is a pure function of
`(fingerprint, doc)` computed at render, because a cached staleness flag would be a SECOND source of
truth about the document. **This session produced three bugs of exactly that shape**: a dashboard and a
tab disagreeing on the clean-exit date, a workbook writer re-deriving the milestone number and drifting,
and `RunwayChart` recomputing `pass` and keeping a false green.

**ONLY THE FIELDS THE PATCH TOUCHES.** Fingerprinting the whole item would flag a scenario every time
somebody edited a note, and **a warning that fires on everything is one people learn to ignore**. A test
asserts a scenario stays quiet when a field it never read changes.

**An ADD reads nothing**, so it can never go stale.

**THREE PLACES, because that is everywhere the effect is visible.** Verified: `applyScenario` appears in
exactly three call sites — the chart curves, the suggested-scenarios panel, and apply-to-plan. It never
reaches the headline runway, so the chart really is the only display.

1. **A badge on the scenario**, carrying what moved in its title so the claim is checkable.
2. **A flag under the chart, NAMING the curve.** With three lines a bare warning says something is wrong
   and not which one to distrust — the same failure as a disclosure triangle with nothing beside it. The
   stale curve is also dashed.
3. **⚠️ APPLY-TO-PLAN CONFIRMS rather than flags.** It is the one irreversible action: it writes the
   scenario into the real document, and unlike the chart you cannot undo it by toggling off. The button
   is disabled until an explicit acknowledgement, **which resets on every open** — left sticky, somebody
   who ticked it once would find the next scenario pre-confirmed.

**Reused the file's own `fmt`** rather than adding a second formatter, which is how one value ends up
printing two ways in two places.

## Tab icons — the three-way collision resolved

**Investment, Commitments and Scenarios all rendered `invest`.** I reached for the nearest glyph when
adding the last two. **In a ten-tab rail a repeated mark is worse than none** — it implies a
relationship between tabs that have none.

Two new glyphs in `icons.jsx`, drawn to the set's own spec (24x24, 2px, round caps) so they do not read
as imported from elsewhere:

- **`promise`** — a signed document with a tick, which is what a commitment is
- **`fork`** — one path splitting in two. Chosen over a curved `branch` because the endpoint dots stay
  legible at the **19px the rail actually renders**, where a curve muddies

Of the seven previously unused icons only `swap` was even plausible; the rest are ACTION glyphs — trash,
upload, plus — and in a navigation rail those read as controls rather than places.

`navorder.test.jsx` now asserts all ten icons are distinct, so the collision cannot return quietly.

## Tab order, and Company settings at the foot

Dashboard · Spend history · Cash flow · Sales · Payroll · Projects · Milestones · Investment ·
Commitments · Scenarios.

**The order reads as the sequence somebody works in**: what happened, what is happening, what brings
money in, what it costs, what is promised, what might change.

**⚠️ COMPANY SETTINGS WAS ALREADY ABOVE `.railfoot` IN THE MARKUP AND STILL NOT AT THE BOTTOM.**
`.railfoot` carries `margin-top:auto`, so a button placed above it is pushed to the TOP of that gap —
sitting under the last tab while the meta line sat at the bottom. **Markup order said "bottom"; the
layout said otherwise**, which is why reading the JSX was not enough to see the bug. Moved INSIDE the
foot, above the projection-start line.

`navorder.test.jsx` asserts the full label sequence and the settings placement, so a future reorder that
drops or duplicates a tab fails rather than shipping.

## The Milestone Number column — filled in, per kind

    thrust     blank — it is a heading
    milestone  ITS OWN NUMBER. The task number and the milestone number are the same thing.
    task       THE NUMBER OF THE MILESTONE IT SITS UNDER, not its own.
    gate       1, 2, 3 in CHRONOLOGICAL order across the WHOLE project

**⚠️ THE TASK RULE DIFFERS FROM THE SUPPLIED TEMPLATE**, which writes a task's own number (1.1.1) in
this cell. Corey specified the milestone's, which is the more useful reading — the column then says
WHICH TARGET each row serves — and the template's example rows are unfilled placeholders. The comment in
`appendixERows` names the line to change if a funder ever objects.

**GATES NUMBER ACROSS THE PROJECT, not per thrust.** A funder counts decision points through the award,
not within a block of work. Tested with an early gate in the SECOND thrust, which correctly numbers 1.

**ONE SOURCE.** The workbook writer used to re-derive this cell and had drifted from the printed table;
it now reads `r.milestoneNumber` like everything else.

**Three older assertions were written against the template's placeholders** — em dash for a task, blank
for a milestone — and were corrected with the rule.

## Thrust reordering, and the internal card's section order

**⚠️ REORDERING THRUSTS IS THE ONE OPERATION THAT DELIBERATELY RENUMBERS ROWS IT DID NOT TOUCH.**
Everywhere else the rule is that a number, once assigned, is held — it may be in a filed document. Here
it is broken on purpose: **thrust order IS the numbering**, so a thrust dragged above another whose
milestones kept 2.x would print a table where TASK 1 contains 2.1.

The person dragging a thrust is restructuring the document, not editing a cell — a different intent
earning a different rule. It is the only place, and a previously filed table will not match afterwards.
A test asserts the comment saying so is still in the file.

**EVERY ROW IS DRAGGABLE NOW.** A thrust has no parent to move INTO but it has a POSITION, so
reordering is a real operation rather than a destination-less move. What ACCEPTS a drop is still typed:
task→milestone, milestone/gate→thrust, thrust→thrust.

**THE INTERNAL CARD RENDERS THE PLAN ITSELF**, between the cost block and the chart — timeline → what
the project is judged on → the plot, because the chart is a READING of the first two. The generic mount
now skips internal projects, or it would render twice.

## Delete confirmation — and a real bug it exposed

**⚠️ DELETING A THRUST LEFT ITS GRANDCHILDREN.** `removePlanEntry` removed the entry and its DIRECT
children, so a thrust took its milestones and LEFT THEIR TASKS — which then rendered as orphans nobody
had created, from a delete they thought they understood. It now walks the whole subtree.

**Found by asking what the confirmation should say.** Writing "this will also remove N tasks" meant
counting them, and counting them showed they were not being removed.

**CONFIRM ONLY WHEN SOMETHING ELSE GOES WITH IT.** A task takes only itself and deletes immediately;
a thrust or milestone asks. **Asking on every delete teaches people to click through the question, and
then they click through it on the thrust.**

**COUNTED, NOT VAGUE.** "Are you sure?" is a question somebody can answer wrongly. "Delete this thrust?
It will also remove 1 milestone, 1 go/no-go, 2 tasks" is one they can answer.

**Two test-harness mistakes of mine:** `textContent === "Delete"` missed because the JSX puts the label
on its own line and the whitespace comes with it; and I asserted 3 rows in a 4-row fixture.

## Dragging tasks

**EVERYTHING BUT A THRUST IS DRAGGABLE.** A thrust is the top of the tree — there is nothing to drop it
into, and making it draggable would offer a move with no destination.

**⚠️ WHAT ACCEPTS A DROP DEPENDS ON WHAT IS BEING DRAGGED.** A task goes into a milestone; a milestone
or gate goes into a thrust. Letting anything land anywhere would create shapes the form cannot print —
a task under a thrust has no number, and a milestone inside a milestone has no meaning. Only the row
that will actually take the drop highlights.

**A task RENUMBERS into its new milestone** — 1.1.1 under milestone 1.2 becomes 1.2.n, or the filed
table contradicts itself. The milestone it left keeps its own numbering, per the delete rule.

**A null destination orphans it deliberately**, the same escape the type control offers: the app never
invents a parent, so it must let somebody remove one.

**⚠️ THE TEMPORAL DEAD ZONE AGAIN — SECOND TIME THIS SESSION.** `cls` reads `accepts`, and the
declaration landed below it. Lint does not catch a TDZ and React only reports it at render, as "Cannot
access X before initialization". Caught proactively this time by remembering the last one; the pattern
is that adding a derived value to a row's className means the declaration must move ABOVE the className,
not sit where the old one did.

**And a test expectation was wrong rather than the code:** I asserted the gate was not draggable. It is,
and should be — a gate belongs to a thrust and can move between them.

## Changing an entry's type

**⚠️ THIS IS NOT A FIELD EDIT.** The kind decides what an entry's PARENT may be and what its number
means, so `setPlanKind` moves the row in the tree:

- **→ thrust** loses its parent entirely; a thrust is the top of the tree
- **→ milestone / gate** parents to a thrust — its own, or the one its old parent sat under
- **→ gate** also loses its number, because the form leaves that cell blank
- **→ task** parents to a milestone, and is REFUSED if there is none

**⚠️ ITS CHILDREN ARE ORPHANED WITH IT.** A milestone demoted to a task cannot keep its tasks — a task
owns nothing — so they are cut loose alongside it.

**I BUILT THIS TWICE AND THE FIRST VERSION WAS WRONG IN TWO DIRECTIONS**: it guessed a new parent for
the tasks, and it REFUSED the change when it could not find one. Both are the same mistake — **the app
making a structural decision on somebody's behalf, silently, in a document they file.** An orphan is
visible, sits at the end of the list, and is one drag from correct. A wrong parent is invisible and
prints.

**Nothing is refused now.** Orphans are marked — a caution tint and a "no milestone" chip instead of
"task" — and the editor says "1 task left without a milestone; they are at the end of the list",
because a dropdown that quietly detaches rows is how somebody loses work they cannot then find.

**`const orphan` landed BELOW the `cls` that used it** — a temporal dead zone crash React reported as
"Cannot access 'orphan' before initialization", visible only because three tests went red at once.

**A test broke on `querySelector("select")`** — the type control is now the first select in the editor,
so the gate-outcome test was reading the wrong one. Rewritten to find it by its options: **a positional
selector in a form that gains fields is a test that breaks every time the form grows.**

## Collapsing — four levels

Budget, the milestones panel, thrusts, and milestones.

**COLLAPSE STATE IS A SET OF WHAT IS SHUT, not of what is open.** A new thrust arrives expanded, which
is what somebody who just created it expects — the opposite default would hide the thing they made.

**A ROW IS HIDDEN IF ANY ANCESTOR IS SHUT**, walked up the parent chain rather than checked one level.
A task under a collapsed milestone stays hidden even when its thrust is reopened.

**THE CARET LIVES IN THE NUMBER CELL**, not a column of its own — a column empty on two of four row
kinds reads as a missing control. Two test assertions read `.pn` textContent and had to strip it.

**A SHUT ROW SAYS WHAT IT IS HIDING** — "3 hidden" beside the dates. A caret with nothing beside it is a
control people learn not to open.

**NO CARET ON A ROW WITH NOTHING INSIDE**, so an empty thrust does not offer a control that does
nothing.

**THE IMPORT/EXPORT TRIGGER SURVIVES A COLLAPSED PANEL.** Collapsing the table to get it out of the way
should not take the control with it — asserted, because it was the obvious thing to break.

**The budget collapses too**, and it is the tallest block on a grant card by a wide margin: somebody
working on deliverables should not have to scroll past every category to reach them.

**A replacement targeting the wrong indentation silently did nothing** — the panel toggle never landed
and two tests caught it. `grep -c` on the new class confirmed zero before the fix.

## Thrusts — the third level (schema v8)

The template's `TASK 1` rows are a real structural level and the import was DISCARDING them as headings.

**⚠️ THE GO/NO-GO BELONGS TO THE THRUST, NOT TO A MILESTONE.** It has no number, it is the last row of
its block, and its date is the end of the budget period. I had built gates as siblings of milestones —
close enough to look right, and wrong in the one way that matters: **a failed gate ends the thrust**,
and the thrust is what you would describe to an agency when it does.

**THE NUMBERING HAD ALREADY TOLD US.** Milestone `1.1` and task `1.1.1` both carry the thrust's `1` in
first position, so the level was in the data all along — encoded in a string with nothing holding it.

**A GATE IS NOT NUMBERED AT ALL.** I had gates sharing the milestone sequence on the reasoning that both
occupy a task row; the real template leaves the cell blank. Four tests asserted the old convention and
were corrected — they were putting a number in a filed cell the form leaves empty.

**THE GATE RENDERS LAST IN ITS THRUST whatever its month**, because that is what it means. Sorting by
date would scatter it among the milestones it judges the moment somebody moved one.

**A THRUST'S DATES ARE DERIVED** — the span of what sits inside it. Typing one creates a fourth place
for a date to live and the form has no cell for it. A thrust is never reported as a gap for a missing
date either.

**NO THRUST IS INVENTED ON MIGRATION.** A plan with loose milestones is valid and renders as it did.
Adopting existing milestones into a thrust nobody created would renumber work somebody may have filed.

**DRAG MOVES A MILESTONE OR GATE BETWEEN THRUSTS**, and only those — a task moves with its milestone
and a thrust is the destination, so making everything draggable would let somebody drop a thrust into
itself. **Moving renumbers the moved target AND its tasks** (1.1 → 2.1, 1.1.1 → 2.1.1), because the
number encodes the thrust. What it leaves behind keeps its number, per the delete rule.

**THE REVIEW COULD NOT NAME A THRUST.** The parser reads "TASK 1" rows as thrusts, but the type
dropdown offered only milestone/gate/task — so a row read wrongly could not be corrected TO a thrust,
and a thrust misread as a milestone could not be corrected either. **The review is the last chance to
fix what gets filed; a level it cannot name is a level it cannot fix.** A thrust'''s unused cells are
blanked rather than left editable, because typing a description into a cell the export drops is worse
than showing nothing — somebody would believe it was saved.

**React writes `draggable={false}` as the string "false"**, not as an absent attribute — a test asserted
`null` and failed.

## Milestone import/export moved into an SF-424A-style modal

**ONE ROUTE.** The panel's inline paste box and file button are gone, replaced by a single `iobtn`
trigger opening the same modal shape the budget uses. Two routes to one action is how somebody learns
the app has two importers, and then finds out it does not.

**⚠️ ONE DELIBERATE DIVERGENCE FROM SF-424A: import offers ADD as well as REPLACE.** The budget's
import replaces everything with no undo, which is survivable for one screen of numbers somebody can
retype. A milestone table can be an afternoon of typing. Both buttons name their OUTCOME — "Add 14
rows", "Replace all 11" — so nobody has to remember which importer they are in, and NEITHER APPEARS
UNTIL THE REVIEW HAS RUN, so the destructive one is never what you press to find out what is in a file.

**THE REVIEW IS THE FILED TABLE — all eight columns, every cell editable.** The moment to fix a misread
quarter is before it becomes a row somebody sends to an agency. The modal widens only when the review
is showing.

- **The quarter is DERIVED, not editable.** Two editable date columns is two places for a date to live
  and disagree, and the form's quarter is a function of its month.
- **Flagged cells are shaded with the reason UNDER THE CELL** — "quarter 5 read as month 12" is a claim
  somebody can check against the file in front of them; a banner count is not.
- **A row can be dropped here and nowhere else.** Importing something unwanted and deleting it after
  leaves a numbering gap the app deliberately will not close.
- **The clash column appears only when something clashes.** A conflict step shown for a clean import is
  one people learn to click through, and then click through on the occasion it mattered.
- **"Keep both" renumbers the INCOMING row.** The existing numbers may be in a filed document; the
  arriving ones have not been anywhere.

**⚠️ THE TRIGGER WAS ONLY IN THE HEADER WHEN THE TABLE HAD ROWS.** On an empty plan it rendered below
the copy, so its position depended on the state of the data — and a control that moves is one people
look for twice. SF-424A's is always top-right; this is now too, asserted in both states.

**Seven panel tests MOVED rather than being deleted** — paste box, review counts, quarter flagging,
parenting — because the behaviour moved. What is left in `projectplan.test.jsx` is the panel's own
contract: one route, and none for a viewer.

**`afterEach(cleanup)` was missing** and two renders in one file made `data-testid` ambiguous — the
failure reads as a broken assertion rather than a leaked DOM.

## Milestone import/export, matched to a REAL SOPO workbook

Corey supplied an actual DOE SOPO template. **It differs from the printed appendix in four ways, and an
importer built from the form alone gets all four wrong:**

1. **TASK GROUPING ROWS EXIST** — "TASK 1 | Demonstrate current and next-gen ..." with no type. I had
   removed these from the mockups as invented. They are real, they carry the task title, and they are
   headings rather than entries — dropped on import, and their title is carried onto the rows beneath
   so an untitled go/no-go still says which task it decides.
2. **A MILESTONE'S Milestone-Number CELL IS BLANK.** Its identity IS its task number (1.1); there is no
   separate M-number. Only TASKS fill that column, and they repeat their own number into it.
3. **A GO/NO-GO ROW HAS NO NUMBER AND NO TITLE** — just the type, a verification note and dates.
4. **THE QUARTER IS A BARE INTEGER** (2), not "Q2". Reading only "Q2" meant every row from a real
   workbook arrived undated.

**⚠️ AND THE HEADER IS NOT ROW 1.** The template opens with "Project Title:" and "Budget Period:", so a
reader that assumes row 1 imports two lines of metadata as data and then matches no columns at all.
`sheetToText` finds the row containing "Task Number".

**ONE PARSER, TWO DOORS**, the same shape as `sf424a`: the workbook is converted to text and fed to the
SAME parser the paste box uses. A pasted table and an uploaded file cannot disagree about what a column
means, which is how two importers end up with different bugs. Round-trip is tested through it.

**A file that parses to nothing opens the paste box** rather than failing silently — the person can see
what came out and fix it, which beats "nothing happened".

Twelve tests run against the real workbook, not a fixture I wrote.

## Plan editor layout, and Appendix E import/export

**THE EDITOR WAS A VERTICAL STACK.** Title/month/number sat in their own grid, then Description and
Verification fell below as full-width blocks — five rows deep for one entry, so a table of fifteen could
not be read while any one was open. ONE six-column grid now: three fields across the top, the two prose
fields side by side beneath, and `margin:0; padding:0` on the labels because one was inheriting
indentation and stepping each field further right than the last.

**IMPORT MATTERS MORE THAN EXPORT** and is built as the primary path on an empty plan. Nobody starts a
project in this app — they start it in a proposal where the table is already written and agreed.

- **Columns match on CONTENT, not position.** Recipients reorder columns, drop the quarter and rename
  headings; a table through three proposals still lands. `WBS`/`Deliverable`/`Evidence` resolve.
- **"Milestone Description" goes to description, not title** — it matches both patterns and pattern
  order decides.
- **⚠️ A QUARTER IS NOT A MONTH.** The form has both columns and recipients fill in whichever their
  proposal used. Q6 becomes month 15 and SAYS SO — a silent guess puts a gate two months out.
- **NOTHING IS DROPPED.** An undated row imports and is flagged. Losing it because a cell was blank
  produces a table that does not match the one they filed, and they will not notice until an agency
  does.
- **A task is parented to the target ABOVE IT IN THE PASTE**, not by number prefix — these tables are
  hand-edited across years and the numbering is often inconsistent.
- **Export flattens tabs and newlines inside a cell.** Verification is free prose and one stray newline
  would split the row and shift every column after it. Round-trip tested.

**Two more stale header assertions found**, both in `shell.test.jsx`, both from the name moving to the
eyebrow. One of them was itself a test about a hardcoded string surviving a narrow assertion — so its
own point applied to it.

## ⚠️ THE PLAN IS DELIBERATELY ISOLATED — do not connect it

**This is a decision, not an omission.** The plan touches nothing: not the projection, not the
document-level `milestones`, not `grant.milestones` billing, not alerts, not the advisor. Verified —
`engine/plan.js` has exactly one importer.

**The value is that a founder can build the whole grant profile in ONE PLACE — the deliverables and the
budget — not that the deliverables move the money.**

**Every connection costs an assumption the app would then be making on the user's behalf:**

- **Gate → projection.** Requires deciding what a failed gate does, when the last drawdown lands, and
  whether accrued cost share survives. Award terms differ, and a wrong guess puts a cliff in somebody's
  runway that their award does not contain.
- **Milestone → billing.** A DELIVERABLE milestone and a PAYMENT milestone are different things that
  share a word. Linking them assumes an invoice follows a deliverable immediately, which is exactly the
  reimbursement-lag assumption this product exists to stop people making.
- **Milestone → the timeline.** Would put technical targets on a cash chart, implying they move cash.

**A go/no-go modelled rigidly is worse than one not modelled at all**, because the founder can reason
about a date on a page and cannot reason about a cliff the app inserted.

**What IS worth building inside the isolation:** the Appendix E export. It completes "one place" without
adding a single assumption — the table goes out in the shape it came in.

**NOT BUILT AND NOT TO BE BUILT WITHOUT A DECISION: the gate as a projection primitive.** A failed gate
stopping the award, with accrued cost share surviving it, would make the clean-exit date WORSE as the
runway shortens. That needs one real award's terms — and, per the above, an explicit choice to give up
the isolation.

## "Last updated" renamed to "Cash on hand updated"

It is the latest month with a recorded cash figure, so it moves when you CLOSE A MONTH, not when you
touch anything. Calling it "last updated" implied the whole model — somebody who had just edited a
payroll line would read a months-old date and think the app had lost their work.

**Two test files had to follow the header change**, and both had been failing since it landed:
`header.test.jsx` asserted the old string, and `companyname.test.jsx` looked for the company name in
the SUB line, where it no longer is — the name moved to the eyebrow precisely because the sub line was
repeating what sat directly above it. Its assertions were also anchored on "name ·", a separator that
went with the rest of the old line.

## Projection setup moved to Company settings

It sat at the top of Spend history, above a table of recorded months, and read as part of them. It is a
property of the COMPANY — the origin every month index is measured from — so it belongs beside the
company's name.

**THE SPOT WAS ALREADY THERE, AND ALREADY WRONG.** `CompanyGeneral` had a read-only row explaining that
the start is set during setup "because changing it re-bases every line, actual and milestone" — while
the editable control lived on another tab the whole time. **The warning was being made in the one place
the change could not be made.** It now travels with the control.

`setDoc` had to be threaded App -> Account -> CompanyGeneral; the page already had `doc`.

## Commitments tab: overflow, period grouping, and collapse

**THE OVERFLOW WAS ONE MISSING `min-width: 0`.** `.crow-l` is a flex row holding a label and a tag, and
a flex item will not shrink below its content by default — so a long commitment name pushed the amount
off the edge instead of truncating. **The row grew rather than the text ellipsing**, which is the exact
defect that makes a table look broken rather than merely tight. Applied to `.crow-l`, `.cgroup-h b` and
first table cells.

**COST SHARE NOW GROUPS BY BUDGET PERIOD INSIDE EACH AWARD.** `period` had to come back on the rows — I
dropped it when they gained a billing rhythm, and a monthly-billed award has TWELVE rows inside one
period. A funder checks the match per period, so a flat list of thirty-six rows across three periods is
one nobody can reconcile against anything they were sent.

**PERIODS DEFAULT CLOSED**, with the total and an entry count on the summary line. The total is what
somebody wants — it is what a funder checks — and the rows are there for reconciling. **A disclosure
triangle with nothing beside it is a thing people learn not to open**, so a closed fold says how much it
is hiding.

**One test broke and deserved to**: it looked for `.crow` rows without opening the folds, and was
passing on a layout that no longer exists.

## Two screens, one figure, two dates — and months counted from the wrong place

**THE DASHBOARD IGNORED THE TOGGLES.** It called `commitmentPressure(doc, rows)` with no options, so it
always counted debt, while the Commitments tab honoured `settings.exitCountsVentureDebt` /
`exitCountsNoteDebt`. Corey saw 8/31/2026 on one screen and 3/31/2027 on the other. **Two screens
showing the same figure with different dates is worse than either being wrong**, because both look
authoritative. The dashboard now reads the same settings.

**MONTHS WERE COUNTED FROM THE MODEL'S START, NOT FROM TODAY.** `zeroInfo().months` and `coveredMonths`
are indices into the projection — which is right for every internal comparison and wrong for every human
reading them. For a model started in January and opened in June, "5.6 mo" was wrong by five months IN
THE REASSURING DIRECTION.

`monthsFromNow(date)` derives the display figure from the DATE rather than by subtracting indices, so it
is correct whether the model starts in the past or the future, and clamps at 0 rather than going
negative. **`months` is untouched**, so the golden canary and every internal comparison still hold —
`fromNow` and `coveredFromNow` are additions, not replacements.

**A parity test caught it**, which is what it is for: `onemodel.test.jsx` compares the rendered runway
against the engine's, and it started failing the moment the UI showed a different figure. It now
compares against what the UI is SUPPOSED to show.

## Full view-suite pass — 12 failures down to 2

**None of them were the window work.** All twelve predated it; I had only ever run subsets.

**FIVE FILES ASSERTED THE WRONG RUNWAY, AND MY FIRST CORRECTION MADE IT WORSE.** I measured 3.9 from raw
projection rows and updated the tests to that; the app renders **5.5**, because it anchors to actuals
first. **Measuring the wrong pipeline is how a fix becomes a second bug** — the assertions had to be
corrected twice.

**THE SCENARIOS TAB CRASHED, AND IT WAS MY DEMO SEED.** I wrote `patch: { employees: { defer: 3 } }`, a
shape I invented; the real one is `patches: []` of `{ kind, collection, item }`. Six tests died with
"Cannot read properties of undefined". **Inventing a data shape for a demo is worse than leaving the
feature undemonstrated** — the demo is what people load first, and it crashed the tab it existed to show
off. Removed rather than guessed at again.

**A FINANCING ASSERTION WAS DESCRIBING THE OLD WORLD.** The UI used to add a second patch turning
financing on so a round would visibly move the runway. With financing defaulting on, that patch is a
no-op the user did not ask for, and the UI correctly stopped adding it.

**THE JOURNAL TEST WAS TIME-DEPENDENT AND ROTTED.** It asserted exactly four snapshot lines; the demo
seeds four dated to July 2026, and the app takes an automatic snapshot when one is DUE. Once the clock
passed 29 July the mount produced a fifth and the test began failing with nothing wrong in the app. **A
test that depends on how long ago the fixture was written fails on a date nobody chose.** Now asserts
`SEED_JOURNAL.length` to `+1`.

**REMAINING, BOTH PRE-EXISTING AND UNRELATED:** "FLUSHES pending work before switching" fails alone —
a save failing inside `switchCompany`, about company switching rather than runway — and "declining is
remembered", which passes alone and is order-dependent.

## The forecast window — runway and clean exit stop scanning history

**`forecastFrom(doc, today)` = today's month, clamped at 0.** A cash figure is the balance at the START
of a month, so an entry for the CURRENT month is a real anchor AND the month is still in progress — it
is the last month you can still act on. ROUNDS DOWN: a month becomes canon on the first of the next, so
a purchase on the 28th is not counted as forecast and then again as actual.

**Both scans use it.** `zeroInfo(rows, startY, startM, from = 0)` — defaulted, so the golden canary and
every existing caller are untouched. The clean-exit scan takes the same window.

**⚠️ THE HALF THREE EARLIER ATTEMPTS MISSED: the entering balance comes from the ANCHORED rows.** I kept
moving the starting index while comparing against a balance that had been shifted to line up with
history, so a company mid-history looked already-past and the window saturated at zero. Anchored rows
carry the real figure where one was recorded and the shifted forecast where none was — correct in both
cases, and gaps need no special-casing.

**ALREADY OUT IS AN ANSWER.** If the window opens on a month already negative there is no
solvent-to-insolvent crossing left, and the loop returned null — "never runs out", the most dangerous
possible wrong answer. Now zero months at the window, flagged `alreadyOut`.

**Future cash entries no longer anchor** — `anchorToActuals` takes a `maxMonth`. A figure typed against
next quarter is a sketch, and letting it set `starts[m]` rewrote the projection to agree with a guess.

**`solvency()` deliberately still reads the WHOLE curve.** A milestone in June is genuinely stranded if
the company went under in March. The two questions have different windows and that is not an
inconsistency: "when will I run out" is about the future; "did anything kill us getting here" is about
the whole line.

**The Cash on hand table was off by one, and one record holds two months.** `cashActuals[m].cash` is the
opening balance of month m; its revenue/grants/additional are the flows of month **m−1**, typed on the
1st. Reading every field as though it belonged to the key put January's revenue on the February row.
Fixed by DISPLAY: a row draws cash from its own record and flows from the next. No migration.
`prevCashOf` reached back to `m−1` and is replaced by `openingOf`/`closingOf`, so derived spend is
computed across the right pair. Header renamed to "Cash at start of month".

**⚠️ 12 VIEW TESTS ARE FAILING AND WERE ALREADY FAILING BEFORE THIS CHANGE** — fallout from adding
commitments to the demo, which moved its runway 5.6 -> 3.9. Three files were corrected; the rest are
scenario tests reporting "no change", which may be a real consequence of financing defaulting on rather
than a stale assertion. **NOT DIAGNOSED.** This is the third time in this session that running a subset
of the view suite has hidden breakage: a glob is not a test run.

## RESOLVED (was: open defect — clean-exit date inside recorded history)

**Not fixed. Two attempts, both reverted, and the reason is worth more than either.**

The date can be reported inside months already closed with actuals. Anchoring the scan after the last
actual removes that — and BREAKS the figure: a company already below its closure debt at the first
forecast month saturates, the window is zero, and no obligation can shorten a window of zero. Adding a
million-pound facility then changes no number, which is what Corey saw on the second attempt.

**Two requirements, only one satisfiable here:**
  (a) never report a date inside recorded history
  (b) an obligation you owe must be able to move the date

**(b) kept**, because a figure that cannot respond to its own inputs is not a figure.

**THE REAL FIX IS NOT IN THIS ARITHMETIC.** A model that starts in January with five months of actuals
is walking history as though it were forecast. Rebasing the model start to the last closed month
satisfies both at once — and it is a change to the DOCUMENT, not to the closure calculation.

**A process note on how badly I handled this.** After the second revert I adjusted a test fixture's cash
three times looking for a value where a monotonic assertion happened to hold. That is fitting the test
to the code. Two assertions were removed rather than tuned — they claimed "earlier draw, strictly
earlier deadline", which the anchoring does not guarantee — and one was rewritten to assert what IS
guaranteed: the toggle changes what is counted.

**Fixed alongside, and kept:** a facility is now listed whatever month it is drawn (measuring the
listing at month zero filtered out anything drawn later), and nothing is owed before its draw month.

## Three errors in the clean-exit date

**1 · NOTHING IS OWED BEFORE IT IS DRAWN.** `outstandingDebt` summed every future repayment from month
zero, so a facility closing in April was a liability in January. Corey's example: clean until 2/28 with
the debt excluded, "not now — after Jan 31" with it included, for money not yet taken. `closeMonth > m`
now skips it entirely. **A liability that predates its own cause is the clearest kind of wrong**, and it
made the toggle look broken rather than the arithmetic.

**2 · THE "FORWARD-LOOKING" FIX WAS WRONG AND IS REVERTED.** Two requirements conflict and only one can
hold: never report a date in the past, OR let an obligation move the date. Anchoring the scan to today —
or to the end of actuals, which I tried second — satisfies the first and DESTROYS the second: a company
whose cash is already negative at that point fails on the first month tested whatever it owes, so the
date pins there and a million-pound facility changes nothing.

That is what Corey saw, and it is worse than the bug it replaced. **A figure that cannot respond to its
own inputs is not a figure.** The scan runs from month zero again; a date in the past is the model
saying the company was already past a clean exit before today, which is information.

**AND THE LISTING MEASURED AT MONTH ZERO**, so a facility drawn in February reported $0 and was filtered
out entirely — the "counted and shown nowhere" failure arriving through a third door. It is now measured
at its own draw month.

Restored behaviour, measured: no debt 4.78 · drawn month 0 → 0.00 · month 1 → 3.29 · month 3 → 3.59 ·
excluded → 3.81. Earlier draw, earlier deadline; excluding it moves the date back out.

**2b · WHAT WAS ACTUALLY WRONG ORIGINALLY:** It started at month zero, so a model beginning in January 2025
that dipped in month two reported an exit date already in the past. A decision deadline that has gone by
is not a deadline. The scan now starts at today, and the interpolation no longer reaches behind it.

**3 · THE TOGGLES WERE COMPONENT STATE** and reset on leaving the tab. They live in
`settings.exitCountsVentureDebt` / `exitCountsNoteDebt` now, defaulting to counting so an absent value
behaves as before. **A setting that silently reverts is worse than no setting** — the next reading is
wrong in a way nobody notices.

**Wording:** the tile shows months and nothing else; "not now" read as an error message rather than a
number, and the sentence underneath already carries the date and the consequence.

**Three earlier tests marked a facility `closed` and left its close month in the future**, which under
the fix means not yet drawn. Corrected to draw at month zero — the tests were describing a state that
cannot exist.

## The Commitments tab, restructured into four sections

    Debt and notes        total
      Venture debt        total + "count in clean exit"
      Note debt           total + "count in clean exit"
      Royalties           no toggle
    Withstanding payments total, flat
    Cost share            total, grouped by award, then by period
    Shutdown costs        total, flat

**ONE `Group` COMPONENT FOR EVERY GROUP**, so a group cannot look like a section by accident. The visual
hierarchy IS the argument — a section is "what kind of obligation", a group is "which one" — and two
implementations would eventually disagree about which is which.

**`withDebt` became TWO toggles.** A lender with a security interest is not a noteholder, and a founder
asking "could I settle everyone else" usually means one of them specifically.

**NO TOGGLE ON ROYALTIES, because there is no decision to make.** Stop trading and nothing further is
owed; offering a switch would imply otherwise. The group says so instead.

**SHUTDOWN COSTS ARE THEIR OWN SECTION**, lifted out of the payments table. They exist only because you
stopped, and sitting them among dated obligations made a null due date read as data somebody had failed
to fill in. The payroll wind-down appears here as a row tagged "assumed", which is where the
`noticeWeeks` assumption becomes visible rather than being a number inside a formula.

**Cost share is grouped by award and then by period** because that is how a funder checks it — a flat
list of rows from three grants is one nobody can reconcile against anything they were sent.

## Counted and shown nowhere — TWICE

A convertible note did not appear on the Commitments tab despite moving the clean-exit date. Two
separate omissions, both mine, both the same mistake:

- **`debt` filtered on `kind === "debt"`** while `outstandingDebt` counted notes too, so a note repaying
  at maturity moved the figure and appeared in no table.
- **Royalty notes generate cost through `indexedLines`** and were listed nowhere at all.

**I NAMED THIS FAILURE WHEN ADDING THE DEBT SECTION** — "an obligation that moves a headline figure and
appears on no screen is one people stop believing" — and then did it again in the same feature, twice.
Writing the principle down did not prevent it; the missing piece was a test that ASSERTS it.

There is now one: if `outstandingDebt` is non-zero for a round, `commitmentPressure().debt` must list
something. It runs over both shapes.

**Also renamed "Drawn debt" to "Debt and notes"**, with a per-row `what` — "drawn" or "repaid at
maturity" — because the section heading was part of why a note looked out of place there.

## A royalty trigger of zero reported "never fires"

**`cum >= trig && trig > 0`.** A note with NO threshold — the common case, and the most aggressive terms
— could never fire, because the guard required the trigger to be positive. Zero means "from the first
dollar", not "never".

**The app then printed "the obligation is real and it is not in this picture" about an obligation that
starts immediately**, which is the opposite of the truth and the most misleading thing it could say
about a royalty note. Found because Corey read the sentence and asked what the number referred to.

**And the sentence never said what its number was.** "At its most optimistic this projection reaches
$3,492,098" — reaches with what? It is CUMULATIVE REVENUE over the whole horizon on the most optimistic
toggles. Now named, with the horizon stated: "Cumulative revenue reaches $X over 36 months even at its
most optimistic, short of the $Y threshold."

**A number in a sentence that does not say what it measures is a number nobody can check** — and this
one was wrong, which is what unnameable numbers hide.

## Convertible notes, and a toggle for drawn debt

**A NOTE THAT REPAYS AT MATURITY IS DEBT IN EVERYTHING BUT NAME** — principal plus accrued, due on a
date, owed whether or not you close — and it was counted nowhere, because `outstandingDebt` looked only
at `kind === "debt"`. A convertible that CONVERTS owes nothing; one that REPAYS owes everything. Now
counted, and only while the maturity is in the future: past it the cash has moved and the projection has
it.

**A ROYALTY NOTE IS AN INDEXED COMMITMENT**, derived from the capital stack the way cost share is
derived from a grant. It scales with revenue and stops when that stops, which is the definition already
in use.

**It does NOT add to the closure figure, and that is correct rather than convenient.** A royalty is paid
out of revenue you are earning; stop trading and there is no revenue and nothing further owed. Unlike a
maturity repayment, walking away discharges it. It carries its cap so the tab need not imply it runs
forever.

**⚠️ IT STILL MOVES THE EXIT DATE, INDIRECTLY**, because it costs cash and the balance is lower. My
first test asserted the date was unchanged and failed — the TEST was wrong, not the code. An indexed
obligation that costs money must move every downstream number. The right assertion is that the GAP
between "cash runs out" and "cannot close cleanly" is unchanged, which is what it now checks.

**DRAWN DEBT IS TOGGLEABLE, ON BY DEFAULT.** A lender is owed whether or not you close, so it belongs in
the figure. But a facility can dwarf everything else, and then the exit date says only "you owe a bank"
— hiding whether the rest of the business could be made whole. Excluding it shows the timeline for
settling everybody ELSE, which is a different and also useful question. The total stays reported either
way.

## A round marked CLOSED deleted its own money

**THE WORST SHAPE A BUG CAN TAKE: a destructive no-op triggered by recording good news.**

`compileInstrument` skipped the draw for ANY closed round, reasoning that closed money is already in
cash on hand. True of a round closed last month. FALSE of one closing in month four — so marking a
future round closed produced no line, no warning, and a runway that shortened as though the raise had
never happened. The user's instinct in that situation is that they did something wrong.

**`close <= 0` is the test.** At or before the model's start the cash is on the balance sheet; after it,
the cash still has to arrive. Obligations were never skipped and still are not — a drawn loan is repaid
either way.

Reproduced by noticing that six-month revenue was IDENTICAL with financing on and off. A toggle that
changes nothing is either useless or hiding something.

## Two smaller changes

**FINANCING DEFAULTS ON.** It was off, so a company with a closed round saw a runway ignoring money in
the bank. A test documented the trap — "a round added moves the runway not at all, at ANY status, and
looks like a broken feature" — and **that trap no longer exists**, which is the best argument for the
change.

**CASH FLOW LEADS WITH NET FLOW, not the runway band.** `defaultChartFor` takes the first chart
registered for a tab, and Cash flow led with the runway line inside its band — the DASHBOARD's question
asked twice. Somebody who has opened Cash flow has already seen the runway and wants to know what moves
it. The existing sub-tab lenses then narrow the same chart to money in or money out.

**`outstandingDebt` filtered on `x.stage`; the field is `x.status`.** Nothing was ever drawn, so the
whole term was silently zero on real data — and the test passed because it set the same wrong field.
**A test that agrees with the bug is not a test.** Drawn debt now also has its own section on the tab,
because an obligation that moves a headline figure and appears on no screen is one people stop
believing.

## Drawn debt is a closure obligation — it was in neither place it belonged

**Venture debt moved the runway and never the clean-exit date.** The repayments are cost lines, so the
projection always had them; the closure figure did not, so a company could look able to close cleanly
while owing a lender the balance of a facility.

**ONLY DRAWN DEBT COUNTS.** `stage === "closed"`. A commitment letter is not a debt, and counting one
would make the exit date depend on a decision nobody has taken.

**⚠️ IT IS THE REMAINING SCHEDULED PAYMENTS, not the principal.** On acceleration a lender is owed
principal plus accrued interest, which is LESS than future payments — those include interest not yet
earned. So this is CONSERVATIVE for amortising debt and EXACT for a fixed-multiple facility, where the
multiple is the whole obligation however early you stop. Conservative is the right direction for a
bankruptcy figure.

Measured on the demo: undrawn, outstanding is $0 and the exit date is unchanged at 3.40. Drawn, the
facility is $2.6m outstanding and the exit date goes to zero — correct, and it exposed that "0.0 mo"
is not a sentence. It now reads **"not now"**.

## The dashboard showed a green tick for a milestone it could not reach

**`pass` ASKS WHETHER THE BALANCE IS POSITIVE ON THE DAY.** It says nothing about whether the company
survives to see it — so a projection that dips below zero in January and recovers by March, because a
milestone payment lands, showed a healthy figure and a checkmark. The company died in February.

**The Milestones tab has asked both questions since the false-green audit.** `msWithBal` has carried
`stranded` and `bridge` the whole time; the dashboard tile was reading `pass` alone. The fix is three
lines and no new arithmetic — the data was already there, being ignored.

Now: danger accent when stranded, and the meta reads **"$120k projected — needs $90k to reach it"**.
"You cannot get there" is a dead end; "you need this much to get there" is the next thing to do, and
`solvency().bridgeTo(t)` already computes it — the deepest deficit BEFORE the date, not the global
worst.

**AND THE GRAPHIC BESIDE IT WAS STILL WRONG AFTER THE TILE WAS FIXED.** `RunwayChart` had
`const pass = ms.bal >= 0` — its OWN second definition of whether a milestone passes, ignoring
`stranded` entirely. So the corrected tile sat next to a chart drawing a green dot and a tick for the
same unreachable milestone.

**A second definition of one question is what let one of them stay wrong.** `msWithBal` already carried
both answers; two consumers derived it independently and only one was updated. The chart now reads
`ms.stranded`, uses the dot-and-ring convention the milestones chart uses (dot is the balance, ring is
whether you survive to it), and names the bridge rather than drawing a cross.

**A lesson about where this class of bug hides:** the audit that found the original five false-greens
scanned the tabs. The dashboard summarises the tabs and was not on the list, so it kept a stale copy of
a question everything else had stopped asking.

## The demo now demonstrates the commitment flavours

Five commitments, one of each shape: a dated DEBT (tooling PO), a dated PLANNED cost (patent renewal),
a CLOSURE-TRIGGERED payment with no date (lease break), a RECURRING lease, and an INDEXED royalty at 2%
of revenue. Plus `noticeWeeks: 4` and a saved scenario.

**⚠️ THE DEMO NOW DIVERGES FROM THE SEED DATA, deliberately.** Two tests asserted the demo reproduces
the golden 5.6 — a contract keeping the two in step. The seed has no commitments, so the demo cannot
both carry them and match.

I tried raising the demo's cash to restore 5.6 and reverted it: that keeps the NUMBER while making the
two documents different companies, which is worse than an honest divergence. **The demo keeps the seed's
cash and reads 3.9.** The golden canary still guards the SEED, which is what it was for; the demo's own
number is asserted separately, so a change to either is still caught. Two numbers now, not one.

**SaaS was seeded and then removed.** `saas-integration.test.js` asserts the demo carries no
subscription, and its premise is sound — it isolates the engine by starting without one. Seeding a
product would have meant rewriting that test to accommodate the demo, which is the wrong way round.
**Recurring revenue remains unexercised in the demo**, noted rather than hidden.

**Fifteen tests broke on the change**, all measuring the fixture rather than behaviour. Two lessons
recorded: `demoDoc()` is no longer a blank slate, so tests that measure what a commitment DOES need a
stripped model; and a hardcoded `payMonth: 9` was "after the cash runs out" only for one cash figure —
derived from the runway now.

## Covered runway rebuilt as the SOLVENT WIND-DOWN DATE — steps 1-4

**The old definition had no correct case.** "Cash minus what you have signed" double-counted, because
every commitment is already in the projection. Proof: a promoted line — same line, same projection —
moved covered runway 5.10 -> 4.41 purely because somebody marked it signed. No cash had moved.

**The new one is a COMPARISON, not a subtraction**, so it cannot double-count by construction:

    closureDebt(t) = unpaid payments marked DEBT + closure-triggered payments
                   + shortfall(t) + payroll wind-down
    covered        = last t where balance(t) >= closureDebt(t)

Measured: promoting moves neither number; a $150k debt after cash-out drops covered 4.78 -> 3.33 while
runway stays 5.56; the same amount marked PLANNED leaves covered untouched; a closure fee with no due
date drops it to 3.33 and creates no cost line at all.

**Recurring commitments appear nowhere in it** — they are in the projection and stop when you do.

**`shortfall(t)` is one number doing two jobs**: the clawback in `closureDebt` and the unmatchable
figure in `uncovered`. Two computations would eventually give two figures for one fact.

**Eligible funds are approximated** from `rows[m].inNonGrant`, added to the projection because that loop
is the only place that knows a line's origin. Right in the case that matters — a company funded solely
by an award has zero eligible funds and the whole accrued match is a shortfall, which is TRUE.

**A NUMBER THAT IS QUIETLY ZERO IS WORSE THAN ONE THAT IS OBVIOUSLY WRONG.** `windDownCost` first read
`e.salary / 12` — a field that does not exist — and returned zero for every model, so payroll silently
vanished from the closure figure. `empCostAt` is the function the model already uses.

**Fractional, not whole months**, for the same reason as the first version: whole months once produced a
covered runway of 6.0 against a runway of 5.6, longer, which is nonsense.

**QBO PROVENANCE FIXED.** `addManual` hardcoded `source: "manual"` and dropped `extRef` — so the same
bill would re-import on every sync. It has never fired because nobody has synced twice.

**Renamed everywhere to "Clean exit until".** "Covered runway" invited comparison with runway as though
they measured the same thing; they answer different questions.

**Two tests asserted the old definition** and were corrected with it — including one that asserted
`covered == runway`, which under the new definition asserts that closing is free.

**STEPS 5-7 · uncovered split, and the notice assumption made visible.**

`uncovered` is now `unpayable` + `unmatchable`, kept as a sum for anything still reading it but split
because THE REMEDIES DIFFER: unpayable is fixed by money or by moving a date; unmatchable is fixed by
NON-GRANT money specifically and by nothing else. A bank balance made entirely of drawdowns against an
award cannot match that award, however large it is.

Verified on a grant-only model — revenue lines, POs, subscriptions and rounds all removed — which
reports **unmatchable $18,342 and unpayable $0**. Nothing is late; they simply cannot match. That is the
case the approximation exists for, and it is exactly right there rather than approximate.

**`unpayable` counts PLANNED costs; the clean-exit date does not.** The questions differ: "will I be
able to pay this" is true of a patent fee, "can I close cleanly" is not.

**The shortfall is measured at the month the cash runs out**, not at the horizon — measuring at the
horizon would report a match shortfall for a company already long gone.

**`noticeWeeks` LIVES BESIDE THE NUMBER IT DRIVES**, on the Commitments tab, not in a settings page.
A closure figure computed from an assumption is fine provided the assumption is visible and can be
argued with; hidden in settings it is just a number somebody has to trust. Reads: "Clean exit assumes
[4] weeks' notice for everyone, and that every debt below is settled."

**THE THREE FLAVOURS ARE NOW REACHABLE.** A picker on the add form, and it comes FIRST because it
decides what the rest of the form asks for.

- **recurring** — creates a real recurring cost line and is `kind: "planned"` by construction, so it is
  never a closure debt. That is the whole reason the flavour exists: it needs no closure handling
  because it is not there once you close.
- **indexed** — creates NO line. `indexedLines()` builds them from the model at projection time, because
  the amount is not known until the thing it indexes is. Indexes against revenue, project spend (with an
  optional single project) or profit.
- **payment** — a due month, or BLANK for a closure-triggered cost, plus the debt/planned badge.

Measured: recurring $5k/mo takes runway 5.56 -> 5.26 and adds a line; indexed 5% of revenue takes it to
3.99 and adds none; a $50k closure fee leaves runway at 5.56 and drops the clean-exit date to 3.96.

**⚠️ PROFIT IS MEASURED PRE-OBLIGATION.** A share of profit changes the profit it is a share of, which
is circular. Pre-obligation is both the standard commercial reading and the only definition that
terminates — a test asserts two 10% obligations cost about twice one rather than compounding.

**`indexedLines` runs AFTER the other lines and is APPENDED, not folded in**, so an indexed commitment
cannot measure against itself.

## Cost share was double-counted in covered runway — corrected

**COST SHARE IS NOT AN EXTRA COST. IT IS A SPLIT OF ONE.** `computeGrant` computes `total = direct +
indirect` and `costSharePct` divides that into a federal share and yours. The project's `cashOut` is
`t.total` either way — **setting `costSharePct` to zero leaves the runway at 5.56, unchanged**, because
you spend the same and are simply reimbursed less.

So that money is ALREADY LEAVING in the projection as project spend. Counting it in `unpaid` made
`commitmentPressure` subtract it a second time, reporting covered 5.41 against a runway of 5.56 — a
0.15-month gap that did not exist. **The same cash, counted twice.**

**WHY THE INVARIANT DID NOT CATCH IT.** "Every commitment owns exactly one outflow" was tested properly
for the promoted and manual paths — the byte-identical projection test. Cost share was REASONED about:
`lineId === null` proves it creates no line, and I concluded it therefore could not double-count. But
the double count was never in the projection. It was in the covered-runway arithmetic, which subtracts
from rows that already contain the spend. **An invariant tested on two of three paths is an invariant
tested on two of three paths.**

**Corrected:** `unpaidCommitments` is stored commitments only. `commitmentPressure` returns `costShare`
and `costShareTotal` separately, reported and never counted. Covered runway now equals runway when cost
share is the only obligation, and still moves for a real cash commitment (4.41 against 5.10 with a $40k
deposit).

**Its own table on the tab, "Grant cost share"**, saying plainly that it is not owed on top of the plan
— it is the part of spending already happening that never comes back. **And excluded from the Cash flow
Costs section entirely**, because the project cost lines directly above it already include it: showing
the same money twice on ONE screen is worse than showing it twice across two.

**Found by tracing the model to answer a question**, not by a failing test. Three tests asserted the
wrong behaviour and had to be corrected with it.

## Password reset — three bugs, two of them the same line

**1 · THE LINK BEHAVED LIKE A MAGIC LINK.** `setRecovering(true)` fired only on the `PASSWORD_RECOVERY`
event, which supabase-js emits ONCE, when it consumes the link's hash. Miss that instant — a slow first
paint, a reload — and the user is left holding an ordinary session and lands in the account. The hash is
the durable evidence: `type=recovery` is in the URL whether or not anybody was listening, so recovery is
now read from it synchronously at mount.

**2 · SIGNING OUT WENT BACK TO THE NEW-PASSWORD SCREEN.** The app is hash-routed, so Supabase's
`#access_token=…&type=recovery` sits exactly where the router keeps its view. Nothing cleared it, so
every later navigation re-read it. One `history.replaceState` once the marker has been consumed.

**3 · A SUCCESSFUL RESET LEFT THEM SIGNED IN.** Now `signOut()` and back to the form with a banner
saying why. The recovery session came from a link in an inbox — anybody with that inbox, a forwarded
mail, or a shared machine with the tab still open is holding it. Ending it means the new password is
used at least once by the person who set it.

**The old-URL warning is not a bug**: `siteOrigin()` returns `VITE_SITE_URL` or the current origin, so
it names the vercel host because that is where the app is deployed. It resolves when the app moves to
`app.waterline-runway.com` — see GO-LIVE.

**Two placement mistakes again.** The banner first landed inside `if (resetting) return (` — a screen
only reachable by ASKING for a reset, which is exactly where somebody arriving FROM a completed reset
never is. Then `rindex("return (")` put it before the JSX root rather than inside it. And `notice` was
already local state driving the "we sent a link" screen, so the prop had to be `banner`; had it parsed,
it would have shadowed and broken that screen.

## Commitments opened the dashboard from every tab but the dashboard

**`cmt` was in the NAV and not in `VIEWS`.** `parse()` in `hashroute.js` falls back to the default for
an unknown view, so clicking Commitments rewrote the hash to `dash`.

**WHY IT SEEMED TO WORK FROM THE DASHBOARD**, which is what made it confusing: from `dash` the hash does
not change, so nothing is re-parsed and React state alone carries the click. From anywhere else the
route is re-read and the fallback bites. The symptom looked tab-specific and the cause was routing-wide.

**ADDING A TAB TO THE NAV IS NOT ENOUGH — IT MUST BE IN `VIEWS` TOO.** A comment now says so at the
list, and `test/state/navroutable.test.js` compares the two in BOTH directions, reading the NAV out of
`App.jsx` rather than restating it: a list retyped in a test is a list that drifts, and the test would
then pass while the bug returned.

**This bug shipped a week of work ago and was found by using the app, not by testing it.** Every
commitment test mounted the view directly and so never touched the router — a whole feature was
unreachable and 1047 tests were green.

## Mobile audit — measured, not eyeballed

Audited by parsing every rule in `styles.css` and testing it against a 360px viewport, because the
previous pass was done by eye and these are precisely the defects an eye skips.

**FIVE FIXED WIDTHS THAT OVERFLOWED A PHONE**, all real: `.members-form .inp` at min-width 220px (used
by the new Commitments add form), `.cf-actions .addbtn` 180, `.empty-cash .inp` 180, `.ms-name` 190,
`.jfield` 150. A 360px screen has ~300px usable, so any of these pushes the row sideways and takes the
page with it.

**THE iOS INPUT-ZOOM DEFECT.** `.inp` is 12.5px and `.sel` is 12px. Safari zooms the whole page to ~130%
when a focused input is under 16px, regardless of viewport settings, and leaves it there — so tapping
any field on an iPhone jerked the layout. Fixed with a font size rather than `user-scalable=no`, which
breaks pinch-zoom for people who need it.

**AND TWO RULES WERE MORE SPECIFIC THAN THE FIX.** `.members-link .inp` and `.ncebox .sel` both set 12px
and would have won on specificity, so the zoom would have survived in exactly the two places a phone
user meets a select. Specificity, not source order.

**No page-level overflow guard existed**, so one missed wide element scrolled the entire page. Added —
using `overflow-x:clip`, NOT `hidden`: `hidden` makes the element a scroll container and silently kills
`position:sticky` on descendants, and `.panel-h` is sticky inside scrolling tables at this exact
breakpoint.

**Eight components added this session had NO mobile rule at all**: `.trialbar`, `.subpill`, `.cmt-empty`,
`.agree`, `.terms-gate`, `.ncebox`, `.stat`, `.members-form`. The terms gate's footer was the worst —
two buttons with `space-between` clipped the primary action at this width.

**⚠️ THE AUDIT ITSELF HAD A BUG WORTH REMEMBERING.** The first pass flagged twenty "fixed widths"
because `max-width: 520px` contains the substring `width: 520px`. Anchoring the property to a start
boundary cut twenty false positives down to five real ones. A detector that cries wolf gets ignored,
which is worse than not having one.

**THREE SIGNUP TESTS HAD BEEN FAILING SINCE THE TERMS TURN** and were not caught, because the run at
the time was scoped to `s*.jsx` and `t*.jsx` and the file is `password.test.jsx`. **A glob is not a test
run.** Fixed by ticking the box in the tests that submit.

## Terms acceptance — migration 046

**A CHECKBOX THAT WRITES NOTHING IS WORTH NOTHING.** If anybody ever asks whether a given user agreed to
a given version of the terms, the answer has to be a row with a timestamp, not "the form required it".

**THE ACCEPTANCE TRAVELS IN SIGNUP METADATA, NOT THROUGH AN RPC.** With email confirmation on, `signUp`
returns NO SESSION — so nothing can be written to `profiles` until the user confirms and signs in, which
may be days later or never. Recording it then would timestamp the CONFIRMATION rather than the
AGREEMENT. The client passes `terms_version` and `terms_accepted_at` in `options.data`; `my_profile()`
copies them across the first time it runs with a session.

**Copied ONLY when nothing is recorded yet**, so a later sign-in cannot overwrite a real acceptance with
a fresher timestamp, and a stale client cannot backdate somebody into terms they never saw.

**`accept_terms` refuses anything but the current version.** A client one deploy behind would otherwise
write an old version string and read as accepted, which makes the whole record worthless. It exists for
when the terms CHANGE; new accounts come through the metadata path.

**The version is a DATE, not a counter** — "2026-08-04" names when the document was published, which is
what anybody investigating an acceptance actually wants to know. `TERMS_VERSION` in `plans.js` must
match `terms_current()`, and a test reads both.

**THE SCANNER CAUGHT A REAL APPLY FAILURE**: `my_profile()` gains three return columns, and Postgres
refuses `create or replace` when the return type changes. Without `drop function if exists my_profile()`
the migration would have failed on apply with "cannot change return type of existing function" — found
here rather than at 2am against production.

**Not asked when resetting a password.** Somebody resetting agreed long ago, and asking again would
imply the reset was itself a new agreement.

**The wizard now states the trial at step 0** — creating a company is what starts the clock, and under
the one-trial rule that is a decision rather than a free action. Saying it on a billing page they have
to go and find is saying it too late.

**THE RE-ACCEPTANCE GATE LIVES IN THE SHELL, not in `DocumentHost`.** DocumentHost has six conditional
returns — invite, loading, load failure, setup, demo, main — and a gate rendered from one of them would
be absent from the other five. `RunwayApp` is what everything usable comes through, so it takes
`termsRequired` as a prop.

Two placement mistakes on the way there, both the same shape as the Commitments-section bug: anchoring
on a string that exists in a DIFFERENT COMPONENT (`TrialBar` renders in RunwayApp; `termsRequired` lives
in DocumentHost), and then inserting after a `return () => { alive = false; }` inside an effect rather
than the component's JSX return, which was a syntax error rather than a silent misplacement. **When
moving JSX between components, find the component first and the marker within it.**

**The gate cannot be dismissed by clicking away** — the overlay deliberately has no click handler,
unlike every other modal. A gate that closes on an outside click is optional in practice while looking
mandatory, and the record it produces is then worth nothing. The two ways out are reading the terms and
signing out, and it says plainly that the model is unaffected and still exportable.

**`profile()`'s fallback now names every field a caller reads.** It returned a two-key object, so
`terms_required` was `undefined` rather than null on any path where the RPC came back empty — and
`undefined` is falsy, so the gate would have silently never appeared.

## App icon — the duck's head

Cropped to the head from the existing mark. The frame was MEASURED, not eyeballed: rendering the artwork
on magenta and finding the non-background pixels gave content at x 0..857, y 23..1018 and the red
crown-and-beak at x 377..804, y 169..453. My first four candidate crops were built from reading a
coordinate grid by eye, were wrong by a factor of the render scale, and cut the beak off.

**The maskable variant is zoomed out by 1/0.8** so the whole head sits inside Android's 80% safe circle.
Verified by actually circle-cropping the render rather than trusting the arithmetic — a beak shaved off
on somebody's launcher is not visible from here.

**Pine was tried as a background and rejected**: the green crest disappears into it. Bone.

**⚠️ THE PWA TEST WAS READING A MANIFEST THE APP NEVER SERVED.** `index.html` references
`/site.webmanifest`; `test/engine/pwa.test.js` read `public/manifest.webmanifest`. Two manifests
existed with different colours and different icon lists, and the tested one was the one no browser ever
loaded — so the icons could have been wrong in every install and the file would still have been green.
It only surfaced because deleting the unused manifest broke the read.

The test now DERIVES the path from `index.html`, which makes that drift impossible. Two checks added
while there: the manifest's `theme_color` must match the page's own `theme-color` meta (they disagreed —
#0a2846 in the page, #10876B in the untested manifest, and neither was the current palette), and every
icon the manifest promises must exist on disk.

## One trial clock per account — migration 045

**A REGRESSION, NOT A MISSING FEATURE.** 008 entitled "the oldest company you own" — an account-level
free slot. 022 replaced that clause with `c.trial_ends_at > now()`, which is right for a per-company
subscription model and silently removed the account-level limit the old clause had been providing.
`trial_ends_at` is NOT NULL with a default, so every company created got a fresh fourteen days.

**Limiting it to one unpaid company at a time does not close it.** Create on day 1, delete on day 13,
create again, get another fourteen. Corey caught this in the proposal before it was built. The clock has
to belong to something the user cannot delete.

**`profiles.trial_started_at` is the clock**, started on the FIRST COMPANY rather than at signup —
somebody who signs up, is invited to a colleague's company and returns a month later has not used
anything up. Backfilled from each account's oldest owned company so nobody mid-trial loses time.

**THE FIX NEEDS NO CHANGE TO `company_entitled`.** `create_company` writes the ACCOUNT'S end date into
`companies.trial_ends_at` instead of letting the column default. A company created on day 10 gets four
days; one created on day 20 is born expired. The read path is untouched.

**Two rules, neither sufficient alone:** one clock per account (stops create-delete-create), and one
unpaid company at a time (stops ten companies riding one trial and then expiring into ten separate
subscription decisions).

**`trialing` is deliberately absent from the paid check** — that is Stripe's trial vocabulary, not this
product's, and accepting it would let a card-less checkout unlock a second company.

**Ownership, not membership.** An advisor in five client companies owns none of them. Counting
memberships would repeat the `advisor_usage.companies` mistake exactly.

**A TEST MODEL SUBTLY STRICTER THAN THE RULE IS WORSE THAN NO TEST.** My JS mirror of the SQL required a
status before checking the period; the SQL's OR does not (`status in (...) or current_period_end >
now()`), so a cancelled subscription inside its paid period counts as paid. The test failed and the SQL
was right.

## QuickBooks unpaid bills -> commitments

`AgedPayableDetail`, a DIFFERENT REPORT answering a different question: `ProfitAndLossDetail` is money
that has already left, this is money that has not left and is owed. The existing sync could never have
produced a commitment however it was wired.

**No windowing.** Payables returns what is outstanding NOW, so there is no date range to split and no
truncation to chase — one call, one grid, unlike the P&L path.

**⚠️ A BILL IS NOT A SIGNATURE.** QuickBooks raises a bill when an INVOICE arrives; a commitment begins
when you SIGN. So this finds obligations already invoiced and misses everything signed and not yet
billed — precisely the long-dated purchase order the whole feature was built for. It is a FLOOR on what
you owe, never the whole of it. **The UI says so on every import, not only when the list is short**,
because an empty list read as "nothing outstanding" would be worse than not importing at all.

**Drafts, not commitments.** Nothing is written until somebody confirms. An import that silently added
obligations would change a company's runway on the strength of a report nobody had read.

**Columns matched by NAME, not position** — position is what breaks when somebody adds a column. And
`due_date` is requested explicitly because it is NOT in the default column set; without it every bill
imports with no payment date, which is a number with nowhere to sit on a runway.

**Three ways a row can fail to import, all COUNTED:** no due date, already recorded, or a credit note.
A credit is a NEGATIVE open balance — importing it as an obligation would overstate the total by twice
its value. A row that vanishes silently is a support ticket.

**A TIMEZONE BUG CAUGHT BY THE SUITE'S OWN TZ.** `new Date("2026-08-01")` is UTC midnight by spec, and
`getMonth()` in any negative offset reads it as 31 July — so a bill due on the FIRST of a month landed
in the month BEFORE it, everywhere west of Greenwich. The assertions that passed were the ones with
mid-month dates. Date-only strings are now parsed as local, with boundary tests pinning it.

**The CSV path needs nothing further:** `payablesToCommitments` takes a grid, and the CSV importer
already produces one.

## Cost share follows ACTUAL billings

Cost share is a percentage of what has actually been BILLED. Dividing a period's share evenly across
its months assumes billing runs to plan — and a grant that under-bills for two months then catches up
owes a different amount at each point than the even split claims.

**PAST FROM ACTUALS, FUTURE FROM PLAN**, the same hybrid the projection already uses via
`anchorToActuals`. Months up to the last recorded actual are weighted by what was really billed; beyond
it there is nothing to use but the plan, and pretending otherwise would be inventing a figure.

**A MONTH THAT BILLED NOTHING OWES NOTHING.** With actuals `{0: 0, 1: 0, 2: 60000}` the first two rows
are $0 and the third carries the draw. With flat billing the result is identical to the even split,
because flat billing IS an even split — a good check that the weighting is doing nothing gratuitous.

**Unbilled months fall back to the MEAN of the months that do have a figure**, not to a guess. It says
"we expect the rest to look like what we have seen", which is the least invented assumption available.

**`accruedCostShare` now SUMS THE WEIGHTED ROWS rather than interpolating.** Interpolating across a
period would undo the weighting and hand back a straight line — exactly the even split this change
replaces.

**THIS IS THE WHOLE QUICKBOOKS AND CSV INTEGRATION.** Both write `project.actuals`, and reading that is
all the wiring there is. Nothing further is needed on this side when the QBO connection lands.

**I fumbled the weighting first** — a convoluted expression with a dead `billedShare` variable and a
`void` to silence it. That is a signal, not a matter: the rewrite is a weights array, a total, and a
proportional split, which is what it should have been.

## Cost share is due at the REPRESENTATIVE PERIOD

Cost share is verified against what you BILLED, so it falls due on the rhythm you bill on — not on a
calendar of its own. `reimburseTiming` now drives the schedule:

- **monthly** — twelve small proofs of match, one per month of the period. Treating these as period-end
  understated how soon the money was needed.
- **arrears** and **advance** — both reconcile at the period end. Being paid up front does not move when
  the match is PROVEN; the funder still checks what the advance was spent on at the close.
- **milestone** — spread across milestones in proportion to what each draws.

**THE LAG IS DELIBERATELY NOT APPLIED.** `reimburseLagMonths` is how long the FUNDER takes to pay YOU.
Your match is due when you bill, not when they settle — applying it would push every obligation later by
the funder's own slowness, which is backwards. A test pins this.

**A MILESTONE-BILLED AWARD WITH NO MILESTONES YET falls back to period ends** rather than producing
nothing. The obligation is real; only the rhythm is unknown. Dropping it would make a liability vanish
because a schedule had not been filled in — the same silent disappearance this feature exists to
prevent, and my first version did exactly that.

**EVERY TIMING SUMS EXACTLY to the award's own cost-share figure.** Rounding each row independently left
the total $1 under across all four rhythms — the drift comes from rounding parts, not from any one
schedule. A `settle` pass puts the remainder in the LAST row, because that is where a real
reconciliation happens. "$1 short" in a funder reconciliation is not a rounding curiosity.

## Cost share is PER PERIOD, and grants gained a no-cost extension

**COST SHARE IS NOT A LUMP SUM AT AWARD END.** It accrues as a percentage of what has been BILLED, and
must be satisfied WITHIN EACH BUDGET PERIOD — a funder does not let you under-match in year one and make
it up in year three. Modelling it as one payment at the end was wrong twice: it understated the
near-term obligation, and it put the whole of it after a runway it should have been pressing against.

On the demo model that is the difference between one $62k obligation at month 11 and **two — $30,570 at
month 5 and $31,567 at month 11**. The first falls INSIDE the 5.6-month runway, so covered runway moves
5.6 -> 5.4. The lump-sum version hid that entirely.

`accruedCostShare(doc, month)` gives how much is already owed, so the obligation reads as a rising line
rather than a cliff somebody thinks they can plan around.

**NO-COST EXTENSION: MORE TIME, NO MORE MONEY.** Put in `nMon()` in `time.js` — the ONE place a
period's length is decided — so everything downstream follows without being told: spend spreading,
reimbursement timing, the burn split, the pace charts. A second definition of "how long is this period"
is how an extension gets honoured in one place and not another.

**Three sites used `p.end` directly and would have ignored it**: the cost push, monthly reimbursement,
and arrears reimbursement. `periodEnd(p)` now. The arrears one matters most and is the half people
forget — an extension delays the MONEY too, not just the deadline.

Verified: +6 months leaves the budget total identical at $310,688, moves the cost-share deadline 11 ->
17, and lengthens runway slightly as the same spend spreads thinner. A test asserts the total does not
move, because if it does it is not a no-cost extension.

**COST SHARE IS DERIVED, NOT STORED**, so it cannot drift from the award it comes from — edit the
budget and the obligation moves. `computeGrant().grand.costShare` is the figure, which is what the
Projects tab already totals, so the two cannot disagree. It creates no cost line: the spend is already
in the project, the same invariant as a promoted line reached differently.

**TWO WRONG FIELD GUESSES, both found by running it against the demo model.** `budget × costSharePct`
is not a thing — `costSharePct` lives on `project.grant`, not the project, and the total comes from
`computeGrant`. Then `g.endM` does not exist either: a grant's dates live in `periods[]`, so the first
working version dated EVERY cost-share obligation to month 0 and reported it due immediately. Wrong in
the alarming direction is still wrong, and that one was wrong by the entire length of the award.

**THREE TESTS BROKE BECAUSE THE DEMO MODEL NOW HAS A COMMITMENT.** "Returns null when nothing is
committed", "explains the concept when empty" and an uncovered total asserted as a bare number were all
about the fixture rather than the behaviour. Each now builds a model with no awards, or measures a
DELTA. Worth noticing: a derived feature changes what every fixture means.

**Built:** schema v5, `engine/commitments.js`, the tab, the dashed committed series on `flow.runway`,
the dashboard tile (shown only when covered runway differs by half a month or more — a tile that always
appears teaches people to stop reading it), the advisor tile, and grant cost share.

**Not built:** QuickBooks `AgedPayableDetail` — the highest-value source and a real addition, since
`qbo-sync` pulls `ProfitAndLossDetail`, which is spend that already happened.

## A new plain user landed on the portfolio; a new company never mentioned its trial

**`advisor_usage.companies` COUNTS EVERY MEMBERSHIP, not companies advised.** 031 built it that way for
`AdvisorBilling`, where the correct sentence is "if this plan ends you take a seat in each of the N
companies you are in" — which IS memberships. I read the field name and assumed it meant clients, so
`plan.companies > 0` made an advisor of anybody with a single company of their own.

**`allowed` is the test**: the advisor flag, or a paid advisor plan. Fixed in two places — I had made
the same mistake in the landing setting, which would have offered the portfolio option to every user.

⚠️ **`advisor_usage.companies` is misnamed for its content** and this will mislead somebody again. Its
one existing consumer is correct, so renaming needs a migration and a careful read of `AdvisorBilling`.

**THE TRIAL WAS ONLY VISIBLE INSIDE COMPANY SETTINGS -> PLAN.** All of it worked — `companies.trial_ends_at`
is NOT NULL with a default (022), `company_plan` returns it, `planSummary` derives `trialing` and
`daysLeft` correctly — and none of it appeared on any screen somebody uses. A new company is on a
fourteen-day clock and the first sign of it would have been the day it stopped working.

`TrialBar` now sits above `UnpaidBar`, turning amber at three days. **Deliberately not an alert**: a
trial with time left is not a problem, and dressing it as one every day for two weeks teaches people to
ignore the bar that eventually matters.

## Landing page — where somebody starts (migration 044)

`engine/landing.js` is a pure rule with four inputs, kept out of the component because the settings UI
needs the same answer to show somebody what their choice resolves to.

- **One company** -> that company. The portfolio is BLOCKED, not hidden: a list of one is a worse
  version of that company.
- **Several** -> a company they OWN, then the OLDEST. Owning is the strongest signal a company is theirs
  rather than one they were invited to; oldest is stabler than most-recent, which would move the landing
  every time somebody adds them to something.
- **Advisor** -> the portfolio, and they may still choose a company instead.

**A STORED 'portfolio' IS REFUSED FOR A NON-ADVISOR**, not silently honoured — a preference saved while
somebody was an advisor must not survive them ceasing to be one. It is still STORED, though, so a lapsed
and resumed advisor plan does not lose the choice. What is allowed is decided on read.

**On `profiles`, beside `last_company_id`**, because a landing choice follows the PERSON. In localStorage
it would mean signing in on a laptop and a phone to two different screens.

**The setting says what "decide for me" RESOLVES TO**, using the same function the app lands with —
otherwise somebody changes the setting just to find out what it was.

**TWO HOOK BUGS, and the second cost 31 test failures.**
1. `account?.advisorPlan?.().then(...)` — `?.()` guards the CALL, not the chain after it, so a stub
   without the method threw during render.
2. **The landing effect sat BELOW five conditional returns.** On any render taking an early exit —
   loading, bad load state, setup wizard — React saw fewer hooks than the render before. The message,
   "rendered more hooks than during the previous render", names neither the hook nor the component, and
   removing the two suspects one at a time was the only way to find it.

**The logo was missing because I dropped it two turns ago**, replacing the invented `brandmark` element
with text and leaving the image out — the rail kept its words and lost its mark.

## The profile menu was missing from the advisor's own home

The avatar was in the company app's header and nowhere else, so an advisor — whose HOME the portfolio
is — could only reach their own settings by first opening somebody else's company. The one thing that
follows a person across every company was reachable only from inside one.

**The avatar is on every screen or it is on none.** Now in a `.topright` beside the Open button, on both
the portfolio and each company tab.

Worth noting the class-existence test added minutes earlier would have caught a typo in `.topright`
immediately — the first time this session that a guard written for one bug paid for itself on the next
change rather than the next regression.

## The advisor portfolio rendered as unstyled HTML

**`.rw` SCOPES THE ENTIRE STYLESHEET.** Every screen wraps in it — `RunwayApp`, `Account`, the sign-in —
and `AdvisorHome` returned a bare `.shell`. Correct structure, correct data, no character at all.

**Five class names were invented**: `navitem`, `brandmark`, `railgrp`, `navr`, `fine`. The real ones are
`nav` (on the BUTTON, not a container), a `.brand` block with two lines, and `.meta` for a stat's
supporting text. They rendered as nothing and nothing failed.

**`<nav className="nav">` wrapping `<button className="nav">` was its own bug**: `.nav` is the button
class in this app, so a container sharing it matched every selector first — including the tests' clicks,
which is why three of them broke while looking like they were about routing.

**ALL EIGHT EXISTING TESTS PASSED WHILE THE PAGE WAS VISIBLY BROKEN.** They asserted text content and
behaviour, and both were fine. Two new tests close it: one requires `.rw` to be an ANCESTOR of `.shell`,
the other collects every class the component renders and fails on any the stylesheet does not define.
Verified by removing the wrapper and watching the first one fail.

**This is the second time today that a component tested green and rendered wrong** — the milestones
chart was the first. Both were caught by looking at the running app, not by the suite. Worth treating
"the tests pass" as weaker evidence for view code than for the engine.

## Advisor focus — migration 043, Layer 1 only

The owner chooses which tabs an advisor works on. Per ADVISOR, not per role: two advisors on one company
are usually there for different reasons, and the tax person does not need the cap table.

**A FOURTH LAYER of tab visibility, and the ORDER is the rule.** `tabIsVisible` checks
`companyHidden` BEFORE focus, so the company's own hidden tabs are a FLOOR — focus takes away further,
never adds back. Otherwise an owner could grant an advisor a tab their own staff cannot see.

**`null` is not an empty list.** Absent means "everything the company shows"; empty would mean "no
tabs", and an advisor with no tabs is a removed advisor. The server refuses to store one, and the client
says "remove them instead" rather than surfacing an error.

**⚠️ THIS IS FOCUS, NOT CONFIDENTIALITY, AND THE LABELLING CARRIES THE WHOLE WEIGHT.** `load_document`
delivers the model as one blob, so an advisor's browser receives every salary whatever is set here — it
hides the TAB, not the data. Every string says "what they work on"; none says access, permission or
private. A checkbox labelled "Payroll" that does not withhold payroll is worse than no checkbox: it is a
promise the software does not keep. And a user who believes salaries are hidden will never ask for the
feature that would hide them. **The panel says so in its own body text, not just in a comment.**

**THE BANNER IS NOT OPTIONAL.** Without it this is indistinguishable from a bug, and the first thing a
focused advisor does is email the owner asking why half the app is missing — the opposite of what the
owner wanted. Said once at the top, never repeated at each gap: placeholder tiles turn a focused view
into a list of what you are not trusted with.

**A tab the company has turned off shows as ticked-and-disabled with the reason**, rather than a tick
that does nothing. A control lying about its own effect is the same failure as the labelling one, at
smaller scale.

**043 FAILED ON FIRST APPLY: `column m.is_advisor does not exist`.** `is_advisor` is a column on
PROFILES (022) and a FUNCTION reading it — it was never on `memberships`. `list_members` (032) returns
it as a COMPUTED column, which is exactly what made it look stored. Both uses now call
`is_advisor(m.user_id)`, as 032 does.

**Two more things fixed while checking the rest rather than shipping the one-line fix:** `advisor_focus`
folded its permission check into the WHERE clause, so a non-owner got zero rows — indistinguishable
from "this company has no advisors", for the caller and for whoever debugs it. It now raises
`forbidden` like `list_members`. And it uses `lower(u.email)`, matching 032.

**A NEW SCANNER: every aliased column read must resolve to a real column.** Two failures in writing it,
both instructive:
- **It cried wolf on the first run** — alias `s` is `staff` in 014 and `subscriptions` two functions
  later, and searching the whole file produced three confident falsehoods. Now scoped to the statement.
- **Then it passed on the reintroduced bug.** The window ran from `from` FORWARDS, and in SQL the
  select list comes first, so `select m.is_advisor ... from memberships m` fell outside it entirely.
  Found by putting the real bug back and watching the scanner not care. **A scanner never tested
  against the bug it was written for is decoration.**

**Layer 2 — real withholding — is documented and NOT built.** It needs `employees` out of the blob and a
role-aware `load_document`. Plan: `LAYER-2-advisor-confidentiality.md` in outputs.

## Advisor UI — scenarios on the company tab (stage 3, complete)

`AdvisorScenarios` is mounted on the advisor's company tab. **Mounted, not rebuilt** — it was already
parameterised, and a second smaller version would be a second definition of what a scenario does.

**It is the one writing act on a screen where an advisor is otherwise a viewer**, which is the whole
answer to "so what can they actually do here".

**THE TILE AND THE PANEL SHARE ONE FETCH.** The Scenarios tile would otherwise have called
`myScenarios` itself to say "3 yours · 1 offered" — two fetches for one list, and two chances to
disagree about a number both are showing on the same screen. The panel reports its list up through
`onCount`, and until it arrives the tile is ABSENT rather than reading zero: undefined means nobody
fetched, `[]` means the advisor has none.

**The callback is held in a REF, not a dependency.** Adding it to `load`'s deps re-fetches whenever the
parent re-renders with a fresh function — a refetch loop that presents as a slow network rather than as
a bug. Lint caught the missing dependency; the ref is the honest fix rather than silencing it.

## Advisor UI — scenarios on the company tab (stage 3, complete)

`AdvisorScenarios` is mounted on the advisor's company tab. It already existed and was already
parameterised, so this was a mount rather than a build — the alternative, a smaller advisor-shaped copy,
is how a product ends up with two definitions of what a scenario does.

**THE TILE READS WHAT THE PANEL LOADED.** `onCount` was already on the component for exactly this. A
second fetch would let the scenarios tile and the list six inches below it disagree, which is the worst
kind of disagreement because both look authoritative. A test asserts `myScenarios` is called ONCE.

**`undefined` and `[]` stay distinct all the way through.** Nobody has fetched them yet versus the
advisor has none — the tile shows nothing rather than "0 scenarios", which would be a lie with a very
short shelf life.

**A SPREAD THAT WOULD HAVE DEFEATED AN EARLIER GUARD.** The mount read
`advisorTiles({ ...doc }, ...)`, and `{ ...null }` is `{}` — truthy, empty, and exactly the shape the
tile layer refuses on purpose so a model that would not load cannot report a burn of zero. The
component's own null check catches it first TODAY, which is what makes this the dangerous kind of bug:
harmless, invisible, and one refactor away from mattering.

## Advisor UI — the landing route and the rail (stage 2)

`AdvisorHome.jsx` is now the default screen for anybody with an advisor plan. The rail is their client
list; each entry opens that client's tab in place; `onEnterCompany(id, view)` hands over to the ordinary
app at a NAMED TAB, and `startView` makes it open there. `onBackToPortfolio` is the way back, in the
rail beside Company settings.

**Landing is decided ONCE per session**, on the first successful `advisorPlan()` read. An advisor who
has navigated into a client must stay there on the next render — this chooses where a session starts,
not where every render goes.

**Somebody with an advisor plan and no clients still gets the portfolio.** It is the screen that
explains what happens next; dropping them into an empty company model would not.

**Loading is progressive and per-client.** Twenty models is twenty round trips and a screen that waits
for the slowest looks broken for the nineteen that arrived. A client whose model fails is MARKED, not
dropped — omitting it would tell an advisor they have fewer clients than they do, and a blank cell would
read as a client with nothing wrong.

**An unknown runway sorts LAST, not first.** Still-loading clients at the top of a list sorted by
urgency would be a queue of false alarms that reorders itself as it settles.

**Above eight clients the rail lists only what needs attention.** A rail with twenty entries is a
scrollbar, which is not navigation.

**THREE WRONG IMPORT PATHS, all found by the build rather than by review:** `readCompanyDocument` is a
method on the account API, not a module export (and it must go through `load_document` +
`assembleFromStorage`, because the blob no longer carries projects — reading the table directly was a
silent wrong-runway bug once already); `runwayMonths` lives in `views/chrome/docsummary`, not
`engine/stats` or `engine/docsummary`. Guessing a path from a function's name cost four build cycles.

**A `str_replace` assertion aborted a script mid-write and left `App.jsx` half-edited** — the back
button inserted, its prop never declared. The build caught it immediately, but it is the fourth
string-matching failure in this session; the working fix was to edit the line by index instead.

## Advisor UI — the tile layer (stage 1 of 3)

**Built:** `src/engine/advisor.js` (`advisorTiles`, `TILES`) and `src/views/chrome/AdvisorCompany.jsx`.
**Not yet built:** the advisor landing route and the rail listing clients — the two pieces that make
this the DEFAULT view for an advisor rather than a component nothing mounts.

**The tiles are the navigation.** One per tab; clicking Payroll opens that client's Payroll tab, not
their dashboard. An advisor between meetings already knows which part of the business they are worried
about.

**NOTHING IS NEW ARITHMETIC.** Every figure comes from where its tab gets it — `payrollNow` and
`derivedBurn` from `buildModelParts`, `spentToDate` for grants, `saasSeries` for MRR, `instConf` and
`closeMonth` for the round, `msWithBal` for the next date. **If a tile ever disagrees with its tab, the
tile is wrong by definition.**

**A PLAUSIBLE ZERO IS WORSE THAN AN ERROR.** The first payroll tile summed `l.amounts[0]` across
`employeeLines`, and those lines carry a flat `amount` with no per-month array — so every payroll tile
read "0k/mo · 0% of burn". Nothing threw; the tile simply lied. `payrollNow` was already computed two
fields away.

**ABSENT AND ZERO ARE DIFFERENT STATEMENTS**, in three places here: a company with no SaaS has no MRR
tile rather than an MRR of nothing; `myScenarios` undefined means nobody fetched them, while `[]` means
the advisor has none; and **a document that would not load returns no tiles at all** rather than a
company-shaped set of zeros — without that guard, `rowsOf` built a projection from `{}` and reported a
burn of zero beside the portfolio's "could not read this model".

**Tab visibility is read, not reinvented** — `hidden` and `canSee` are passed in, so `company_tabs` and
the role gate stay the single source.

**A TEST I COULD NOT VERIFY WAS REPLACED RATHER THAN FORCED.** I could not reliably hand-build a
document that produced no tiles — emptying employees, projects, rounds, saas, history and lines still
left a cash-flow tile from a field I had not found. The empty-state test now drives the branch through
`hiddenTabs`, which is verifiable. A test whose premise I cannot confirm is worse than no test.

## Mobile: timelines become rows, tables signal their scroll

**THE TIMELINES DROP THE AXIS BELOW 640px.** At 328px the axis costs everything and buys nothing: 34
characters of label have nowhere to go, and a dot's position along a 276px line resolves to a fortnight
either way. `TimelineRows` renders the same data as a list — dot, name, date, verdict.

**The substitution is lossless because every row already stated its own date.** That was a decision made
when the goals chart was built, for a different reason, and it is what makes the axis droppable now.
The narrow version actually shows MORE: the wide chart truncates labels at 36 characters because they
must fit beside a dot, and a row has the whole width.

**The verdict is worded identically in both.** Two phrasings of one verdict is how a reader on a phone
and a reader at a desk end up describing different things to each other.

**A media query cannot reach inside an SVG**, so the switch is a `matchMedia` subscription rather than a
CSS rule — and subscribed rather than read once, because rotating a phone changes it and a mount-time
check would keep drawing an axis into 328px until some other render came along.

**Tables now SIGNAL their scroll.** The panel scrolls, but on a phone there is no visible scrollbar and
a cut-off column edge reads as the end of the data — a scroll nobody knows about is a table with missing
columns. Two pinned gradients with `background-attachment: local, scroll` show a shadow only at an edge
you have not reached.

**PER-TABLE COLUMN PRIORITY IS DELIBERATELY NOT DONE.** Hiding low-value columns needs class attributes
on `<th>`/`<td>` pairs across 21 tables in eight files — the exact markup editing that went wrong three
times in this session. The scroll affordance helps all 21 for one CSS rule; the column work helps two
and risks the rest. It should be done deliberately, per table, not appended to a long session.

## Mobile: the rail and touch targets

**THE RAIL SCROLLS IN ONE ROW.** At <=900px it turned horizontal with `flex-wrap:wrap`, and ten items
measure roughly 950px of buttons across a 328px screen — three wrapped rows, about a fifth of a phone
screen spent on navigation before any content appeared. Now `flex-wrap:nowrap` with `overflow-x:auto`
and `scroll-snap-type: x proximity`, so a half-cut button is not the resting state.

**`.brand{width:100%}` was defeating the row on its own**, before any nav item was measured. Easy to
miss because the symptom — a wrapped rail — looks entirely like a wrapping problem.

**EVERY TAPPABLE CONTROL MEASURED UNDER 44px**: `.linkbtn` ~25, `.iconbtn` 28, `.avatar` 30, `.pitem`
and `.setnav-i` ~31, `.addbtn` ~36, `.nav` ~37. `.linkbtn` is the serious one — almost no padding, so
its hit area is the text box, and "Remove", "Cancel" and "Load their version" sit next to each other in
table rows at 12px tall.

**All raised to 44, INSIDE THE MEDIA QUERY ONLY.** At 44px everywhere the desktop tables would gain
about 20px a row, paid by people who are not using a thumb.

**Two techniques worth keeping.** In a table row the target grows through a NEGATIVE MARGIN rather than
padding, so the row height does not change. And the avatar's circle stays 38px while its target is 44,
through a transparent `::after` inset — a 44px filled circle in the header reads as a button demanding
to be pressed rather than an identity mark.

**One number was 43.5 by arithmetic** — line-height plus padding — and is now stated explicitly. A
target that misses its own guideline by rounding is a target nobody checked.

## Mobile: chart text and table overflow

**EVERY CHART LABEL WAS 4-5px ON A PHONE.** The viewBox is 720 wide and scales to its container, so a
font size declared in pixels is multiplied by the scale factor — on a 390px screen that is 0.50, turning
8.5px axis text into 4.2px. Below about 8px text is not small, it is absent.

`.ch-svg` now sets `clamp(10.5px, 2.5vw, 11px)` and every label class sizes in `em`, which decouples
them from the scale entirely. **The floor is 10.5 rather than 9**, and the first attempt got that wrong:
the floor is a BASE the em sizes multiply DOWN from, so it has to clear 8px AFTER multiplication, not
before. At 9px the smallest class still landed at 7.4px. Four tests pin the arithmetic, including one
that fails if any label goes back to a pixel size.

**TABLES SCROLL RATHER THAN COMPRESS.** `.tbl` was `width:100%` with no overflow rule anywhere, so ten
columns across a 328px screen gave each cell 32px — `$1,204,000` needs about 70px. Done on `.panel`
with `overflow-x:auto` and `min-width:640px` on the table, rather than wrapping 21 tables across eight
files: the same fix without editing markup in eight places, which is where regex-over-JSX had already
gone wrong twice today. `.panel-h` is sticky so the header does not scroll away from what it labels.

**640 is chosen against the widest cell, not rounded.** Ten columns still get 64px, so the widest tables
are usable rather than comfortable. The comfortable version hides low-value columns below 640px per
table, which is per-table judgement rather than a stylesheet rule.

**A TEST OF MINE PASSED ITS WAY TO A FALSE FAILURE.** The `emOf` matcher was escaped for the template
literal as well as the regex, so it matched nothing, every size read as 0, and the failure looked like a
product bug rather than a broken test. Third escaping mistake today; the fix was to stop writing regexes
through a shell heredoc.

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
