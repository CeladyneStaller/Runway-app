// ── What a chart can plot, per tab ───────────────────────────────────────────────────────────────
//
// ⚠️ EVERY MEASURE MUST READ A FIELD THAT EXISTS. The scenario factor registry taught this the hard
// way: `pay.salary`, `saas.customers`, `saas.churn` and two others were written from what the UI SHOWS
// rather than from what the model HOLDS, and a patch on an invented key saves, applies, and moves no
// number. Here the failure is quieter still — a measure whose `get` reads nothing returns a flat zero
// line, which looks like a true answer about a company with no spend.
//
// `test/engine/measures.test.js` walks every measure against a real projection and fails on any that
// returns nothing but zeroes where the tab has data.

import { accruedCostShare, shortfallAt, outstandingDebt, windDownCost } from "./commitments.js";

/** The projection row is `{ m, start, rev, cost, net, end, inNonGrant }` — seven fields, and three of
 *  them contain each other. `contains` is what stops a chart double-counting. */
export const MEASURES = [
  // ── flows, on every tab that shows money moving ──
  { id: "rev", tab: ["flow", "dash"], label: "Money in", unit: "money",
    get: (rows) => rows.map(r => r.rev),
    allows: ["lines", "bars", "stack"] },

  { id: "cost", tab: ["flow", "dash", "hist"], label: "Money out", unit: "money",
    get: (rows) => rows.map(r => r.cost),
    // ⚠️ EVERYTHING ELSE THAT SPENDS IS INSIDE THIS. Plotting cost beside payroll or cost share is a
    // legitimate "how much of it is X" chart; STACKING them is a false statement, because a stack
    // asserts the parts sum to the whole.
    // ⚠️ `costshare` WAS LISTED HERE AND IS NOT A MEASURE. The self-consistency test caught it on its
    // first run — which is the whole reason that test exists: a containment naming something that does
    // not exist silently stops warning about a real overlap, and reads as coverage.
    //
    // Cost share IS inside money out, and it is not plottable yet: `costshare.js` reconciles PER
    // PROJECT, not per month, so there is no honest `get` to write. **Re-add it here the same day it
    // becomes a measure** — the containment is true, the measure is simply missing.
    contains: ["payroll", "opex", "baseline", "projectSpend"],
    allows: ["lines", "bars", "stack"] },

  { id: "net", tab: ["flow", "dash"], label: "Net", unit: "money",
    get: (rows) => rows.map(r => r.net),
    // ⚠️ NET IS rev MINUS cost. All three on one chart double-counts every dollar.
    contains: ["rev", "cost"],
    allows: ["lines", "bars"] },

  { id: "end", tab: ["flow", "dash"], label: "Cash balance", unit: "money",
    get: (rows) => rows.map(r => r.end),
    // ⚠️ A POSITION, NOT A FLOW. Balances do not sum, so stacking one is meaningless in EITHER shape —
    // declared here rather than left to the absence of a type, so the control can say why.
    position: true,
    allows: ["lines", "bars"] },

  { id: "inNonGrant", tab: ["flow"], label: "Non-grant inflow", unit: "money",
    get: (rows) => rows.map(r => r.inNonGrant ?? 0),
    // ⚠️ A SUBSET OF `rev`. It exists to answer what cost share can be matched with.
    contains: ["rev"],
    allows: ["lines", "bars"] },

  // ── costs, from the compiled line items ──
  { id: "payroll", tab: ["pay", "flow", "hist"], label: "Payroll", unit: "money",
    get: (rows, parts) => sumLines(parts?.employeeLines, rows.length),
    allows: ["lines", "bars", "stack"] },

  { id: "opex", tab: ["flow", "hist"], label: "Operating costs", unit: "money",
    get: (rows, parts, doc) => sumLines((doc?.lines || []).filter(l => l.kind === "cost"), rows.length),
    allows: ["lines", "bars", "stack"] },

  { id: "baseline", tab: ["hist", "flow"], label: "Baseline burn", unit: "money",
    get: (rows, parts) => sumLines(parts?.baselineLines, rows.length),
    // MEASURED SPEND MINUS WHAT IS ITEMISED — so it moves when itemisation does, not on its own.
    allows: ["lines", "bars", "stack"] },

  { id: "projectSpend", tab: ["proj", "flow"], label: "Project spend", unit: "money",
    get: (rows, parts) => sumLines(parts?.projectLines?.filter(l => l.kind === "cost"), rows.length),
    allows: ["lines", "bars", "stack"] },

  { id: "drawdowns", tab: ["proj"], label: "Grant drawdowns", unit: "money",
    get: (rows, parts) => sumLines(parts?.projectLines?.filter(l => l.kind === "revenue"), rows.length),
    allows: ["lines", "bars", "stack"] },

  { id: "salesRev", tab: ["sales"], label: "Order revenue", unit: "money",
    get: (rows, parts) => sumLines(parts?.salesLines, rows.length),
    allows: ["lines", "bars", "stack"] },

  { id: "capital", tab: ["inv"], label: "Capital in", unit: "money",
    get: (rows, parts) => sumLines(parts?.roundLines, rows.length),
    allows: ["lines", "bars", "stack"] },

  { id: "saasRev", tab: ["flow"], label: "Recurring revenue", unit: "money",
    get: (rows, parts) => sumLines(parts?.saasLines, rows.length),
    allows: ["lines", "bars", "stack"] },

  // ── commitments ──────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ EVERY ONE OF THESE ALREADY HAS AN ENGINE FUNCTION and none of it is drawn anywhere. Cash and
  // runway are numbers a founder checks daily; **cost share accrues silently, debt matures on a date
  // nobody has in mind, and the wind-down cost only exists in a hypothetical.** These are the figures
  // people are surprised by, which is the case for drawing them.
  { id: "costShareAccrued", tab: ["cmt"], label: "Cost share accrued", unit: "money",
    get: (rows, parts, doc) => rows.map((_, m) => accruedCostShare(doc, m)),
    allows: ["lines", "bars"] },

  { id: "shortfall", tab: ["cmt"], label: "Unmatchable shortfall", unit: "money",
    get: (rows, parts, doc) => rows.map((_, m) => shortfallAt(doc, rows, m)),
    // ⚠️ INSIDE THE COST SHARE, not beside it — the part of it that cannot be matched with non-grant
    // funds. Plotting both is a legitimate "how much of it is a problem" chart; stacking them doubles.
    contains: ["costShareAccrued"],
    allows: ["lines", "bars"] },

  { id: "debtOutstanding", tab: ["cmt"], label: "Debt outstanding", unit: "money",
    get: (rows, parts, doc) => rows.map((_, m) => outstandingDebt(doc, m)),
    allows: ["lines", "bars"] },

  { id: "windDown", tab: ["cmt"], label: "Wind-down cost", unit: "money",
    // FLAT ACROSS THE WINDOW — it is what stopping would cost, not something that accrues.
    get: (rows, parts, doc) => { const w = windDownCost(doc); return rows.map(() => w); },
    allows: ["lines", "bars"] },

  { id: "closureTotal", tab: ["cmt"], label: "Total if you stopped", unit: "money",
    get: (rows, parts, doc) => rows.map((_, m) =>
      accruedCostShare(doc, m) + outstandingDebt(doc, m) + windDownCost(doc)),
    // ⚠️ IT IS THE SUM OF THE OTHERS. Beside them it answers "how much of it is cost share"; stacked
    // with them it would double the total.
    contains: ["costShareAccrued", "debtOutstanding", "windDown"],
    allows: ["lines", "bars"] },

  { id: "cmtCash", tab: ["cmt"], label: "Cash on hand", unit: "money",
    get: (rows) => rows.map(r => r.end),
    // A POSITION. On this tab it is the line that rides OVER the stacked obligations — which is only
    // possible because stacking is per measure.
    position: true,
    allows: ["lines", "bars"] },

  // ⚠️ A DIFFERENT UNIT, AND THAT IS THE POINT. Dollars and people on one scale is not a chart, it is
  // a coincidence of magnitudes — $412,000 and 6 people drawn together makes headcount a flat line on
  // the axis. The builder gives a second axis or refuses.
  { id: "headcount", tab: ["pay"], label: "Headcount", unit: "people",
    get: (rows, parts, doc) => rows.map((_, m) =>
      (doc?.employees || []).filter(e => (e.start || 0) <= m && (e.end == null || e.end >= m)).length),
    allows: ["lines", "bars"] },
];

/** Monthly totals from a set of compiled lines. Lines carry `{ amount, cadence, start, end, kind }`. */
function sumLines(lines, n) {
  const out = Array.from({ length: n }, () => 0);
  for (const l of lines || []) {
    const a = Number(l?.amount) || 0;
    const s = Math.max(0, Number(l?.start) || 0);
    const e = l?.end == null ? n - 1 : Number(l.end);
    if (l?.cadence === "onetime") { if (s < n) out[s] += a; continue; }
    for (let m = s; m <= Math.min(e, n - 1); m++) out[m] += a;
  }
  return out;
}

export const measuresFor = (tab) => MEASURES.filter(m => m.tab.includes(tab));
export const measureById = (id) => MEASURES.find(m => m.id === id) || null;

/** Which selected measures overlap, so the builder can say so.
 *
 *  ⚠️ REPORTED, NOT REFUSED — except for stacking. "Money out, and how much of it is payroll" is a
 *  legitimate chart of exactly this shape. A STACK is different: it asserts the parts sum to the whole,
 *  which is a false statement when one contains another.
 */
export function overlaps(ids = []) {
  const out = [];
  for (const a of ids) {
    const m = measureById(a);
    for (const b of ids) {
      if (a !== b && m?.contains?.includes(b)) out.push({ outer: a, inner: b });
    }
  }
  return out;
}

/** Units present in a selection. More than two cannot be drawn honestly. */
export const unitsOf = (ids = []) =>
  [...new Set(ids.map(i => measureById(i)?.unit).filter(Boolean))];

/** Types every selected measure allows, minus stacking when anything overlaps. */
export function allowedTypes(ids = []) {
  //  is reached through ORIENTATION rather than a measure declaring it, so it is not required to
  // appear in every measure's `allows`.
  const sets = ids.map(i => [...(measureById(i)?.allows || []), "hbars"]);
  let ok = ["lines", "bars", "stack", "hbars"].filter(t => sets.every(s => s.includes(t)));
  if (overlaps(ids).length) ok = ok.filter(t => t !== "stack");
  return ok;
}
