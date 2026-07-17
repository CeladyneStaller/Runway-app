# Runway — extracted

`npm install && npm run dev` → http://localhost:5173 · `npm test` → 89 tests · `npm run lint` → oxlint

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
- **The CSS reset at `.rw button{…background:none;color:inherit}` has specificity (0,1,1)** and beats
  any single-class button style (0,1,0). Solid buttons render as flat text unless scoped deeper
  (`.review .rvbtn`) or given `ghost`. This has bitten three times. **Decide it; don't inherit it.**
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

## Known gap

**`exportBudget` and `importWorkbook` are not inverses.** You cannot export a budget, edit it in Excel
and read it back — export writes a submission-ready SF-424A for a program officer, import reads the DOE
template. `test/engine/sf424a.test.js` encodes this as an `it.fails`, so it documents the gap today and
flips loudly the day someone closes it. Related: an import yields only `{periods, categories,
costSharePct}` — billing terms, funder and payment lag aren't in an SF-424A, so they stay at defaults.

**There is no way to enter spend history.** `HIST` was a module constant, so the History view has only
ever displayed the demo's six months — it was never editable. That was invisible while the seed was the
default; the empty state makes it load-bearing, because the measured-burn baseline is one of the app's
better ideas and a new user cannot feed it. `setHist` is wired through to `History.jsx` and unused,
which is where that work starts.

## Next

- `useReducer` migration → then scenarios (a scenario is a replayable action list; same refactor)
- Project actuals + accounting import → unlocks cost-share reconciliation and a real profit number
- Labor prioritisation by leave-one-out: Δzero-date per 100 hours (the zero date is the discount rate)
- Routing for the ~29 addressable places

`split.py.reference` is the script that produced this from the artifact. Kept for archaeology only.
