# Runway — extracted

`npm install && npm run dev` → http://localhost:5173 · `npm test` → 400 · `npm run lint` → oxlint

**Daily use is the built app, not the dev server:** `npm run build && npm run preview` → **:4173**.
Note the port. **IndexedDB is origin-scoped**, so a model built on `:5173` is invisible on `:4173` and
vice versa. Pick one and stay there, or move between them with Export/Import.

## What this is

A cash-runway model for a company with grants, purchase orders, payroll and a capital stack.
Single-user, local-first: your model lives in this browser's IndexedDB and in whatever JSON you
export. No account, no server, no network call.

## Layout

```
src/engine/     810 lines, ZERO React. The whole model. Import it anywhere, test it in isolation.
src/views/      the 19 components
src/state/      document.js (the shape + migrations) · storage.js (THE SEAM) · StartCtx.jsx
src/seed.js     the demo company — explicitly loaded, never a default
test/           86 tests: the golden runway, every accounting identity, F1-F8 regressions, renders
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
