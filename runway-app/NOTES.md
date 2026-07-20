# Runway — extracted

`npm install && npm run dev` → http://localhost:5173 · `npm test` → 185 · `npm run lint` → oxlint

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

- **`clampM` vs `floorM` are not interchangeable.** `clampM` is for select values and array indices.
  `floorM` is for placing money in time. Using `clampM` for placement drags out-of-horizon money onto
  month 18 and inflates the ending balance. That was F8, and it lived in two places.
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
- **`sf424a.js` still clamps imported months.** Unreachable from the UI (the picker offers 0–18) but
  real for a workbook with a month-24 milestone. Open F8 residual.
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

**`exportBudget` and `importWorkbook` are not inverses.** You cannot export a budget, edit it in Excel
and read it back — export writes a submission-ready SF-424A for a program officer, import reads the DOE
template. `test/engine/sf424a.test.js` asserts this as a passing test (`does not round-trip its own export`)
that flips the day the two formats converge. Related: an import yields only `{periods, categories,
costSharePct}` — billing terms, funder and payment lag aren't in an SF-424A, so they stay at defaults.

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
`test/engine/summary.test.js`. What's NOT done: an actuals *editor*. Coded ledger spend fills project actuals automatically, and the per-project
override (Projects → expand → Recorded spend) handles redistribution. Direct hand-entry of raw
`p.actuals` was retired in favour of coding. Cost-share reconciliation (does the grant's match actually get spent?) also
still wants doing, and now has the data shape to do it against.

## Next

- `useReducer` migration → then scenarios (a scenario is a replayable action list; same refactor)
## QuickBooks import — a 4-piece build (in progress)

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
- **Piece 4 — THE IMPORTER.** The column-mapping importer: map 8 columns (date/customer/project/period/
  category/amount/kind/note), save an import profile, feed the `mergeImport` seam. The seam itself is
  already built: `src/engine/importer.js`: `src/engine/importer.js` (`mergeImport`,
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
