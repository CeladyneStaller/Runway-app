# QuickBooks integration — build plan

Expands §3 of `BACKEND-PLAN.md`. That section says what Phase 2 IS; this one says what order to build it
in and where to stop.

**ORDERED BY WHAT COULD KILL IT, NOT BY WHAT DEPENDS ON WHAT.** The dependency order would be
app → tokens → functions → UI → data, which spends the expensive weeks before answering the question
most likely to end the project. This order front-loads the two things that can say no — *does
QuickBooks carry the coding this model needs*, and *what does keeping a connection alive actually
cost* — and defers every artifact until they have said yes.

Each stage states what it PROVES and what would make you STOP. Stopping is a result, not a failure: the
file import already covers the need, so an abandoned Phase 2 leaves the product exactly as it is today.

**The Connected tier stays "Not available yet" until Stage 8.** Selling it earlier is the one failure no
refund fixes.

---

## The seam this is all aimed at

**CORRECTED 28 Jul 2026 — the seam is a GRID, not `ImportRow[]`.** The pipeline is

```
fileToGrid → applyProfile → mergeImport
     ^ this is the only step a live source replaces

Grid = { headers: string[], rows: (string|number)[][] }
```

The original version of this file aimed `quickbooksSource()` at `ImportRow[]`, one step too far down.
That would have meant deciding IN CODE which QuickBooks field becomes `code` — and the Classes result
below shows that decision cannot be made in code, because it differs per company. A landscaping firm
whose accounts ARE its categories wants Account; a nonprofit running four awards through one payroll
account has to use Class or Customer, since the account just says "Salaries".

Emitting a Grid hands that decision back to `applyProfile` and the mapping screen that already exists —
a dropdown per field, tolerant profile matching, save-and-reuse. `ImportModal` needs one change: where
it calls `fileToGrid(file)`, it can equally call `quickbooksSource(report)`. Everything after that is
untouched, including the preview, the merge report and the saved profiles.

So **the Classes question stops being a blocker and becomes a fixture.** If a company tracks Classes the
column is in the grid and the user maps it; if not, they map Account. No branch in our code either way.

Which means **almost none of this plan is modeling work.** It is OAuth token custody, a sync trigger,
and operations. Phase 1 stored numbers people typed; Phase 2 stores credentials to their accounting
system. That is the escalation.

---

## Stage 0 — An app and a sandbox
**Cost:** an hour. **Proves:** you can get keys, and the terms are acceptable.

Intuit developer account, an app, a sandbox company. Read what the production scopes require before
building anything against them.

**STOP IF:** the terms, the scope requirements, or the App Partner obligations are unacceptable. Better
to find that on day one than after the token vault.

---

## Stage 1 — THE DATA QUESTION
**Cost:** an afternoon. **Proves:** whether QuickBooks can answer the question this model asks.
**Highest chance of killing the project. Do it first.**

The model's whole value is attribution: which grant, which project, which cost category. `ImportRow.code`
carries it. So the question is not "can I read QuickBooks" — it is **"is the coding this app needs
present in a customer's books, and does the API return it?"**

Two halves, and the second is the one people skip:

**1a. The API half.** `npm run qbo:probe`, with `QBO_ACCESS_TOKEN` and `QBO_REALM_ID` in the
environment. It pulls the GeneralLedger report — the closest analogue to the file export the importer
already eats — prints the columns that actually came back, counts how many rows carry each candidate
source for `code`, shows the first rows as `ImportRow[]`, and saves the raw response as Stage 2's
fixture. `--fixture <file>` replays it with no network, through the same code path.

Three things it handles because the Reports API demands them, and each is a way to get a wrong answer
rather than an error:

- **The accounting method comes from `Preferences` and is passed to the report.** Cash and accrual are
  different numbers. A runway date that disagrees with what somebody sees in their own QuickBooks is a
  trust problem before it is a data problem.
- **Asking for a column that does not exist returns an EMPTY CELL, not an error.** So the probe reports
  what came back and names what it asked for and did not get, rather than trusting its own list.
- **Responses cap at 400,000 cells with no pagination**, appending "Unable to display more data" instead
  of failing. The probe says so when it happens; the real sync will have to walk the range in chunks.

One structural detail worth knowing before reading the output: **QBO report rows are a tree, and the
account lives in the SECTION HEADER rather than on the line.** The probe carries headers down to the
leaves, because if the account is where a company's attribution lives then that walk IS the mapping.

**1b. The reality half.** Sandbox data proves the MECHANISM and tells you nothing about the MAPPING.
Grant-funded organisations code spend in whichever place their bookkeeper chose — sub-accounts, Classes,
Customers/Projects, or a naming convention in the memo — and it differs per organisation. So get one
real chart of accounts and one real GL export.

**The instrument for that already exists and needs no integration: the file importer eats a GL export
today.** Ask a prospect for one, run it through the existing import, and watch whether the profile
matcher finds their codes. That answers the mapping question with zero QuickBooks code written, and it
is a customer conversation worth having regardless of whether this phase ever ships.

**FIRST RESULT, 28 Jul 2026 — sandbox, and the probe was wrong before it was right.** GeneralLedger
returned 335 rows, every one carrying a code, and the probe called it 100% attributable. Every code was
`Checking`. Two faults, one in the report and one in the question:

- **A GENERAL LEDGER IS DOUBLE-ENTRY.** Each transaction appears under BOTH accounts it touches, so
  importing it counts everything twice with opposite signs, and the account a row is filed under is as
  likely to be the bank as a category. `importer.js` says in its own comment that it matches "a typical
  expense-register export" — one row per transaction. GL is not that. The default is now
  **ProfitAndLossDetail**: grouped by income and expense account, one line per transaction, no
  balance-sheet noise and no opening balances.
- **THE PROBE ASKED "IS THERE A CODE" RATHER THAN "IS IT THE RIGHT DIMENSION."** A bank account name
  fills the code slot and carries no attribution. It now scores rows as USABLY coded, prints a
  histogram of accounts, and flags rows whose date, document number and magnitude match another row —
  the signature of double entry. Both checks fail on the very fixture the first version passed.

**SECOND RESULT, same afternoon — ProfitAndLossDetail, and Stage 1a is PASSED for account coding.**
123 rows across 30 genuine income and expense accounts (Landscaping Services, Plants and Soil, Design
income), 100% usably coded, customer names arriving via the `name` column, and no meaningful double
entry. The seam holds: an account-coded company maps onto `ImportRow` without argument.

The probe failed it anyway, and that was a THIRD bug in the question rather than the data: 4 rows out
of 123 tripped the double-entry check because rows with a blank `doc_num` collapse the key to
date+amount, so two unrelated discounts on one day look like one transaction seen twice. The key now
skips rows without a document number and the verdict uses a threshold rather than a tripwire — genuine
double entry is most of a report, not a rounding error, and a check that fails on any coincidence is a
check people learn to ignore.

**THE CLASSES QUESTION, ANSWERED AS FAR AS A SANDBOX CAN.** `klass_name` came back empty on both
reports. The probe now checks why before reporting it, and the answer is that class tracking is OFF in
this company and ZERO classes are defined — so the empty column says nothing about the API. Craig's
Landscaping has no classes to return.

That can be closed in ten minutes (enable class tracking, tag two transactions, re-run), and it is
worth doing for the second fixture. But it stopped being a gate the moment the seam moved to a Grid:
a Class column, if present, is simply another column the user can map.

**STOP IF:** attribution cannot be recovered from what the API returns — for example, coding lives only
in Classes the report does not expose, or in free-text memos with no convention. Then the live
connection would import numbers nobody can allocate, which is worse than the file path: it looks
automatic and is wrong. **Stop here and the total spend is one day.**

---

## Stage 2 — `quickbooksSource()`, offline and pure
**Cost:** a day. **Proves:** the seam holds, permanently and in CI.

Save the Stage 1 response as a fixture. Write `quickbooksSource(reportJson) -> Grid` as a pure function
with no network in it, tested in `test/engine/` against that fixture like everything else in the engine.

Its whole job is flattening: QBO report rows are a TREE whose sections carry the account, so the
function walks it and emits a rectangle, **synthesising the section header as an `Account` column**
because that is where the account lives and a grid has no other place to put it. Whatever else came
back — Class, Customer, Memo, Num — becomes a column under its own `ColTitle`. It decides nothing about
meaning; `applyProfile` and the user do that.

Pure and fixture-driven is not fastidiousness: it means every later stage can break the network, the
tokens or the UI without anyone having to wonder whether the mapping still works. It is also the only
part of this phase that belongs in `src/engine/` — everything after it is state and plumbing.

**STOP IF:** nothing. This stage is cheap and its output survives even if the phase is abandoned — a
saved fixture and a mapping function are notes-to-self with tests attached.

**DONE 28 Jul 2026.** `src/engine/qbo.js` — `quickbooksSource(report) -> Grid` plus `columnValues()`
for showing somebody what their accounts actually contain before they pick one. Nine tests in
`test/engine/qbo.test.js`, built from the shapes the probe really returned. Four of them exist because
they are how this quietly goes wrong:

- **Section totals are not transactions.** A `Summary` counted as data would double the report.
- **The outermost header is emitted as `Section`.** Not decoration: ProfitAndLossDetail reports income
  as a POSITIVE number and `parseAmount` in signed mode reads positive as COST, so sign alone inverts
  every revenue row. `profile.kindColumn` fixes it and needs a column to point at.
- **Duplicate headers are disambiguated.** GeneralLedger returns a column called "Account" and we
  synthesise one too; `applyProfile` resolves by `indexOf`, so the second would be mapped and never
  read — a silent wrong answer rather than an error.
- **Short rows are padded.** Otherwise the synthesised columns slide left onto a different field and
  produce plausible numbers in the wrong place.

**CORRECTED THE SAME DAY, by running it against the real fixture.** The `--grid` cross-check agreed on
row counts — 126 from both walks — and then showed the design fault the shallow fixtures could not:

`Section` was meant to be the OUTERMOST header, a clean Income/Expenses column for
`profile.kindColumn`. Against the sandbox it produced **nineteen distinct values**. Real reports nest
deeper and unevenly — sub-accounts inside sub-groups inside a wrapper, some levels unnamed — so
"outermost" resolved to a different depth on different branches, and an unnamed level let a sub-group
look like a root. It is now `Section Path`: every ancestor, joined, which cannot be wrong because it
claims nothing.

**AND THE KIND QUESTION IS HARDER THAN IT LOOKED, which is the real find.** Intuit's top-level wrapper
is called **"Ordinary Income/Expenses"**. Any rule that decides revenue-vs-cost by looking for "Income"
in the ancestry marks EVERY ROW AS REVENUE. Sign does not settle it either: P&L Detail reports income
as positive, and `parseAmount` in signed mode reads positive as cost. So `qbo.js` derives nothing —
what a name means is not knowable from the name — and the probe now prints the SIGN DISTRIBUTION PER
ACCOUNT so the question gets answered from data rather than from naming conventions.

**THE SIGN DATA CAME BACK AND IT IS UNAMBIGUOUS: income and expenses are BOTH POSITIVE.**
`Design income +7/-0` sits next to `Fuel +6/-0`. So sign carries no kind information whatsoever, and
`parseAmount` in signed mode reads positive as COST — an unmapped import books every dollar of revenue
as spending, and a runway model with its income turned into burn reports zero. `Discounts given`
inverts the other way: all negative under Income, so a contra-revenue account would import as revenue
and inflate it.

Nor is the tree any help. The paths do not share a root — `Expenses > Fuel` is two levels while
`Ordinary Income/Expenses > Income > Design income` is three — and `Pest Control Services`, an INCOME
account, sits directly under the wrapper with no `> Income >` in its path at all. No positional rule,
no substring rule.

**SO `profile.revenueCodes` WAS ADDED TO `applyProfile`** (`src/engine/importer.js`): a list of code
values that mean revenue, matched case-insensitively, taking precedence over both the sign and
`kindColumn` because a named account is more reliable than anything inferred. Five tests, including one
that asserts the WRONG answer without it — the revenue row booking as cost — because that is the
failure being prevented and it should be visible in the suite.

This helps file imports too, immediately and for free: the same accounting package exports the same
shape to CSV, so a QuickBooks file import had the identical inversion waiting in it.

The full paths, once the probe stopped truncating them at 40 characters, made the second half of this
worse than the first: **47 of 126 rows — 37% — sit in NEITHER branch.** `Pest Control Services` and
`Sales of Product Income` are income accounts hanging directly off the wrapper; `Decks and Patios`
lives under a `Job Materials` root of its own. So the ancestry cannot classify better than two thirds
of a report even when you are willing to match on names.

Carry into Stage 6: the mapping screen has to let somebody tick which of their accounts are income,
once, and keep it in the profile.

**A NOTE ON THIS PROBE, worth carrying into anything similar.** Every wrong call it has made has been in
a VERDICT — the double-entry tripwire that failed a clean report on 4 rows in 123, the "outermost
section" that meant to yield two values and yielded nineteen, and a separation test that answered
"sign DOES separate" for income `+56/-5` against expense `+18/-0`, where both branches are
overwhelmingly positive and sign settles nothing. The TABLES underneath were right every time, and in
each case reading them is what caught the verdict.

The lesson is not "write better heuristics". It is that a diagnostic's job is to SHOW, and every
summary line it adds is a new thing that can be confidently wrong — which is more dangerous than
silence, because a verdict is what gets read when the output is long. That is one more control on a screen that already has one per field,
and it is the correct place for it — a person looking at their own chart of accounts knows the answer
instantly, and no rule we could write does.

`npm run qbo:probe -- --fixture <saved.json> --grid` runs BOTH implementations over the same response
and compares. The probe walks by ColType, the engine walks by header; a disagreement on a real report
means one of them is wrong about a shape no fixture here contains.

---

## Stage 3 — OAuth by hand
**Cost:** a day or two. **Proves:** what a live connection costs to KEEP, which is the second thing that
can kill this.

One real authorization, done manually. Refresh token in a local `.env`, sync run from a script. No
database, no Edge Function, nothing user-facing.

What this stage is actually for is the operational reality, which is where QuickBooks integrations rot:

- **Access tokens last 60 minutes. Refresh tokens ROTATE ON EVERY USE** — each refresh returns a new one
  and invalidates the old. Store the newest one every single time; a crash between "received" and
  "stored" costs the connection.
- **An unused refresh token expires in about 100 days**, so a customer who syncs once a quarter comes
  back to a dead connection. For a monthly-use product this is a design constraint, not a footnote:
  either something refreshes on a schedule whether or not anyone asked, or reconnection has to be
  pleasant. Probably both.
- **Refresh tokens now have a hard five-year ceiling** under Intuit's revised policy, so a reconnection
  flow is required eventually no matter what the keep-alive does.
- **Realm ID identifies the QuickBooks company**, and one Intuit login can own several. This app is
  multi-company too, so the connection is realm↔company and a person can absolutely connect the wrong
  pair. Whatever the UI ends up being, it has to show the QuickBooks company NAME back for confirmation.

**BUILT 28 Jul 2026.** `npm run qbo:sync` — refresh, fetch, flatten, report — and
`npm run qbo:keepalive`, which does only the refresh and is the whole of what a scheduled job needs to
do. Config from `.env.qbo` or the environment; tokens in `.qbo-tokens.json`; all four gitignored.

Two pure pieces moved into `src/engine/qbo.js` because Stage 5 will need them again and they are
testable without a network — 9 more tests:

- **`dateWindows(start, end, months)`.** The Reports API caps a response at 400,000 cells and does NOT
  paginate; past the cap it appends "Unable to display more data" and returns **200**, so a sync that
  checks only the status imports a partial year and reports a confident wrong number. Windowing is
  therefore not an optimisation, it is correctness. Done on the STRING: `new Date("2026-01-01")` is UTC
  midnight and reports as 31 December in Denver, and this suite runs under `TZ=America/Denver` so that
  assertion means something.
- **`mergeGrids(grids)`.** Headers are UNIONED, not assumed identical — a quarter where nothing carried
  a Class returns no Class column, and concatenating positionally would file its amounts under a
  different heading. Plausible numbers, wrong field, no error.

**THE THING THIS STAGE EXISTS TO GET RIGHT is that a refresh token is SINGLE-USE.** Every refresh
returns a new one and kills the old immediately. So the script persists the new token BEFORE the access
token is used for anything, and writes it atomically — temp file then rename, 0600 — because a crash
between "received" and "written" disconnects the customer and the only repair is asking them to
authorise again. Verified by simulating a crash with a half-written temp file: the store stays intact.
Stage 4 gets the same property from a transaction instead of a rename.

It also stores `x_refresh_token_expires_in` as an absolute time, prints the days remaining, and names
the company back from `/companyinfo` — one Intuit login can own several companies and this app is
multi-company too, so the realm-to-company pairing is something a person can get wrong silently.

**FIRST RUN, and both faults were in the script rather than in QuickBooks.** `401 invalid_client`
followed by a native crash:

- **`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`** — libuv aborting on Windows because the
  script called `process.exit()` while a fetch socket was still open. It reads like a broken API client
  and is nothing of the sort. Nothing in the file exits any more: failures throw a `Fail`, `main()`
  catches it and sets `process.exitCode`, and the event loop drains on its own.
- **`.env.qbo` still held the template's dots.** `invalid_client` is about the CLIENT ID AND SECRET,
  not the refresh token, so the error pointed at the Intuit app rather than at a copied placeholder.
  Config is now refused before the network is touched — the same guard the Stripe test script already
  had for its uuid, which should have been carried over and was not. The `invalid_client` message also
  now names its three real causes, including production keys against a sandbox realm.

**IT RAN, and produced 126 rows — the same count the probe got by a different path.** Two findings and
one more corrected verdict:

- **ROTATION IS ~DAILY, NOT PER CALL.** Three refreshes inside a minute returned the SAME refresh
  token, which the script labelled "UNCHANGED — unexpected". It is the normal case. The fourth verdict
  line in this exercise to be wrong, against tables that have been right every time.
- **The expiry belongs to the TOKEN, not the call.** 101 days did not move across three refreshes,
  because only a rotation issues a token with a fresh window. So a keep-alive has to run often enough
  to CATCH a rotation — comfortably inside the window, not just before it. Monthly is ample if
  rotation is daily; annually would be a dead connection with a scheduled job pointed at it.
- **27 requests to find 126 rows, 24 of them empty.** Asking "everything since 2020" walked years that
  could not contain data. `CompanyInfo.CompanyStartDate` is the answer and costs nothing — the range
  is now clamped to when the books begin.

**So the windowing strategy inverted: WIDE BY DEFAULT, SPLIT ONLY WHEN PUNISHED.** Twelve months per
request, halved recursively when a response comes back truncated, to a depth of four. The cell cap
depends on transaction volume, which is unknown until a request returns — so a fixed small window taxes
every quiet company for the busiest one's data. A window that is still truncated after splitting is
now reported as an ERROR rather than a warning: it means the row count is a lie, and Stage 5 has to
treat it that way.

**STOP IF:** the keep-alive obligation is heavier than the feature is worth. A connection that dies
silently between quarters produces "the sync is broken" support load against a $149 tier.

---

## Stage 4 — Token custody — **DONE 28 Jul 2026**
**Cost:** a day. **Proves:** nothing new about QuickBooks. This is the price of more than one user.

`supabase/migrations/017_qbo_connections.sql`. The decisions worth knowing:

- **THE TOKEN IS NOT IN THE TABLE.** Not encrypted in it — not in it. The row holds a `secret_id` into
  Supabase Vault, which keeps the value encrypted on disk under a per-project key held outside SQL and
  preserved through backups. `select * from qbo_connections` yields a uuid and no way to use it.
- **`authenticated` has NO GRANT on the table at all** — not narrowed, not RLS-filtered. Every other
  table here is readable by its members because the data is theirs; this one holds a credential, and
  the client never needs it. It asks the server to sync. Three isolation probes assert the table, the
  decrypt function and the anon key all fail OUTRIGHT rather than returning zero rows: an empty array
  would mean RLS is doing the work, and RLS is one policy edit from not doing it.
- **No access token is stored.** It lives 60 minutes and the refresh rotates daily anyway, so keeping
  it would add a second secret to protect to save a round trip Stage 3 measured at under a second.
- **`qbo_connect` is an upsert, which is the five-year fix.** Connect and reconnect are one call:
  the secret is replaced IN PLACE (a new secret plus a repointed row would strand a live credential),
  `realm_id` and the saved mapping survive, and `authorized_at` restarts because the customer just
  consented again. `qbo_connection_status` computes `reauth_due_at` and warns 30 days out, so the five
  year rule has one definition and it is server-side.
- **A delete trigger removes the Vault secret.** Cascading the row away without it would leave a
  usable credential to somebody's books in a table nobody looks at any more.
- **`qbo_due_for_keepalive`** is what the scheduled job asks for: active connections untouched for 25
  days. Rotation is daily and the idle window ~100 days, so monthly catches a rotation with three
  months to spare.

WATCH: a `vault.create_secret(...)` carrying a LITERAL token can put it somewhere the Vault does not
reach. Supabase's default is `log_statement = 'ddl'`, so ordinary calls are NOT logged — an earlier
version of this note said otherwise and was wrong. What remains true: pgAudit is preloaded and a broad
scope captures function parameters, and the dashboard SQL Editor keeps a query history that no
Postgres setting governs. Every write in 017 passes the token as an RPC PARAMETER, which PostgREST
sends in the request body and executes as a bind variable, so it never appears in statement text.
Check with `show log_statement;` and `show "pgaudit.log";` — and never paste a live token into the
SQL Editor.

`qbo_connections`: company-scoped, RLS on, token columns encrypted with a key in Supabase Vault rather
than relying on disk encryption — disk encryption protects a stolen drive, not a leaked read of the
table. Tokens never leave the server; the client asks for "sync now" and the server does the talking.
Audit connect and disconnect via `log_audit` (015).

---

## Stage 5 — Edge Functions
**Cost:** two to three days. `connect`, `callback`, `refresh`, `sync`, `disconnect`.

**`connect` MUST BE RE-RUNNABLE AGAINST AN EXISTING CONNECTION.** This is the entire cost of handling
the five-year ceiling, and it is only cheap if it is designed in now. A refresh token carries TWO
clocks: an idle one of about 100 days, which a monthly keep-alive resets forever, and an ABSOLUTE
ceiling of five years from the original authorization, which rotation does NOT reset — that is the
point of the policy. On that day the refresh returns `invalid_grant` and only the customer can fix it.

So reconnection is just connection plus a flag and a banner, PROVIDED `connect` can run against a row
that already exists:

1. `status = 'needs_reauth'`, set when a refresh fails with `invalid_grant` or `refresh_expires_at`
   comes close.
2. **The row is NOT deleted.** The realm mapping and the saved column profile survive, so reconnecting
   does not mean mapping every account again — which would turn a two-click repair into an afternoon.
3. The same authorize flow behind the same button.

If `connect` assumes it only ever happens once, all three get rewritten later, under time pressure,
years after anyone remembers how it works.

**The banner says why, in the customer's terms.** Something close to:

> **Reconnect QuickBooks.** QuickBooks requires apps to be re-authorized every five years. Your
> mapping and history are kept — use *Connect QuickBooks* to reauthorize.

Naming the cause matters: a reconnection prompt with no explanation reads as "this app broke", and the
customer's next move is support rather than the button.

Three lessons from the billing functions apply directly and should save a day of the same debugging:

- **`verify_jwt = false`** for all of them, with the caller verified inside against `/auth/v1/user`. A
  CORS preflight carries no `Authorization` header, so leaving the gateway check on makes them
  unreachable from a browser with nothing in the logs.
- **Use `_shared/cors.js`.** It fails closed, allows the headers a Supabase client actually sends, and is
  tested. Hand-written header literals produced three separate CORS failures during billing.
- **Parse every module-scope secret defensively.** A malformed value that throws at load means the
  function never boots, and the browser reports it as a CORS error pointing at nothing.

---

**BUILT 28 Jul 2026.** Five functions, plus two shared modules that carry the parts worth testing.

- **`_shared/oauth-state.js`** — HMAC-signed `state`, 9 tests, weighted toward refusals. The callback
  is the only unauthenticated entry point in the product: no session, no auth header, no CORS, so the
  ONLY thing identifying the request is the state we signed and got back. A forged one attaches
  somebody's QuickBooks to the wrong company. Signed rather than stored, because a pending-state table
  needs a lifecycle, a cleanup and its own RLS while an HMAC needs a secret we must have anyway. The
  signature is checked BEFORE the payload is parsed — parsing first means acting on attacker-controlled
  JSON — and it expires in ten minutes so a signed link cannot be replayed out of a browser history.
- **`_shared/qbo-intuit.js`** — every Intuit call in one place, because a refresh token ROTATES and
  three functions storing the new one is three chances to get the order wrong. It also classifies
  `invalid_grant` as TERMINAL, which is what lets callers tell "reconnect" apart from "retry later".
- **`_shared/qbo-report.js`** — the Stage 2 flattener MOVED here, with `src/engine/qbo.js` re-exporting
  it. One implementation, two runtimes: the Edge Function bundles only what sits under
  `supabase/functions/`, the browser build imports from `src/engine/`, and a mapping fix landing in one
  and not the other is exactly the class of failure this phase keeps finding.

The three billing lessons applied and cost nothing this time: `verify_jwt = false` on all five with
the caller verified inside, `_shared/cors.js` rather than hand-written headers, and no module-scope
parse that can prevent boot.

**Two functions are unauthenticated for DIFFERENT reasons, which the README now spells out.**
`qbo-callback` has no caller to verify and is guarded by the signed state. `qbo-refresh` is not
user-facing at all — gated by `x-cron-secret`, no CORS headers on purpose, and it fails closed when
the secret is unset rather than leaving an open endpoint that walks every connection in the database.

**Ordering decisions worth not re-litigating later.** Membership is checked at CONNECT, never at the
callback, because the callback has no session to check it with. The rotated refresh token is stored
BEFORE the access token is used for anything. Disconnect revokes at Intuit FIRST and deletes locally
even if that fails, because a token we have thrown away but not revoked stays valid and we no longer
hold it to revoke later.

## Stage 6 — The UI
**Cost:** a day or two, because it is mostly reuse.

Connect / disconnect / sync-now, and the sync result goes through **the existing import preview** —
same mapping screen, same commit, same merge report. New source, not new pipeline. Show the QuickBooks
company name wherever the connection is displayed (Stage 3).

---

**BUILT 28 Jul 2026.** `views/chrome/QuickBooks.jsx`, four client calls on the account API, and one
change to `ImportModal`. 13 tests.

**THE SYNC BUTTON DOES NOT IMPORT ANYTHING.** It fetches a Grid and opens the SAME import screen a
file opens — mapping, preview, merge report, commit. An integration that writes straight into the
numbers is one nobody can check, and this product's entire output is a date computed from those
numbers. `ImportModal` gained `initialGrid`, and the file path and the live path now share one
`acceptGrid`, so profile matching and the guesses cannot drift between them.

**THREE SYNC FAILURES ARE TOLD APART**, because they need three different actions: reconnect, wait, or
sync a shorter period. A single "sync failed" would send all three to support.

**THE RECONNECT BANNER CARRIES THE REASON** — "QuickBooks requires apps to be re-authorized every five
years. Your mapping and history are kept." Without the cause, a reconnect prompt reads as the app
being broken. `Sync now` is hidden while the connection cannot work, so the only offered action is
the one that helps.

**A THIRD STATE THE FIRST DRAFT DID NOT HAVE.** `undefined` = not looked yet, `false` = QuickBooks is
not available here at all, `null` = available and not connected. Collapsing the last two put a Connect
button in front of local-mode users that could never do anything; a test caught it.

**FIRST LIVE SYNC, and the failure was a permission surface nobody looked at.** `qbo-sync` refreshed
and rotated correctly, then failed reading `realm_id` STRAIGHT FROM THE TABLE over PostgREST — the one
place any of these functions touched a table instead of an RPC. The response came back as an error
object rather than an array, `?? []` turned it into `[]`, and `[0]?.realm_id` reported `undefined` as
"no realm_id", a state that cannot exist.

Either `service_role` lacked a grant that 017's revoke never restored, or RLS-with-no-policies returned
zero rows; both produce the same shape and the repair is the same. **NOTES.md already records this from
migration 001** — RLS and privileges are two independent gates, and a missing GRANT fails DIFFERENTLY
from an RLS denial. Second time, same trap.

018 fixes the CAUSE rather than the grant: `qbo_sync_context` returns the realm and the token in one
`SECURITY DEFINER` call, so no Edge Function needs table privileges at all. Two round trips became one
and a whole permission surface disappeared. `stripe-portal` still reads `subscriptions` the same way —
it works, so that table's privileges are fine, but it is the same shape.

**THE DEBUGGING COST MORE THAN THE BUG, and that is the note worth keeping.** Four rounds went to a
409 whose meaning was already on screen in the panel and in the response body, while the browser
console — which can only ever show a status code — was the thing being read. Both 409 branches also
returned without logging anything server-side, so the function was silent about its own refusals. Say
why, at the point of refusal, in the log AND in the body.

## Stage 7 — Operations
**Cost:** a day. The stage that decides whether this is trustworthy.

- Scheduled refresh so a connection cannot die of disuse.
- **Alert on refresh failure.** A silently dead sync is worse than no sync: the numbers look current
  and are not, and this app's entire output is a runway date computed from them.
- Audit every connect, sync and disconnect.
- Disconnect deletes the tokens AND calls Intuit's revoke endpoint. Deleting your copy of a credential
  is not revoking it.

---

## Stage 8 — Production, and only then a price
**Cost:** unknown, and not yours to control.

Intuit production approval is an external review with its own lead time — the same shape as the legal
drafts, and the same rule applies: start it before you need it, and do not plan a launch date around it.

**When it is green, and not before, the Connected tier becomes a buy button.**

---

## Where the natural pauses are

- **After Stage 1** — one day spent, the killing question answered, nothing to maintain.
- **After Stage 3** — the mechanism proven end to end, with no product surface and no customer promises.
- **After Stage 5** — working for you, not yet sold to anyone.

Stages 0–3 are roughly a week and carry all the risk. Stages 4–8 are roughly two weeks and carry all the
cost. That is the shape to hold in mind: **the first week buys the information, the next two buy the
product.**

## The decision to build ahead of demand — 28 Jul 2026

This plan was written hedging: build the spike, defer the phase until a prospect asks. **That hedge is
withdrawn, deliberately, and the reasoning is worth keeping.** A go/no-go that turns on automation is
lost at the moment it is asked, not at the moment it could have been built — and "we didn't build it
because there was no demand" is indistinguishable, from the customer's side, from "it doesn't do
that". The asymmetry favours building: the cost of being early is a few weeks of work sitting idle at
zero running cost, and the cost of being late is the customer.

Note what this does NOT change: the Connected tier stays "Not available yet" until Stage 8 is green.
Building ahead of demand and selling ahead of delivery are different decisions.

## What would change this plan

- A prospect saying "I would buy if it connected to QuickBooks" turns Stage 1b from research into a
  sales call, and justifies the whole phase immediately.
- Stage 1b finding that codes live in Classes rather than accounts changes the endpoint, not the plan.
- Anyone asking for Xero instead means Stage 2's fixture-driven shape was the right investment and
  everything after Stage 3 is a second copy of the same plumbing.
