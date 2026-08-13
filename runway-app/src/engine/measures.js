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

/** The projection row is `{ m, start, rev, cost, net, end, inNonGrant }` — seven fields, and three of
 *  them contain each other. `contains` is what stops a chart double-counting. */
export const MEASURES = [
  // ── flows, on every tab that shows money moving ──
  { id: "rev", tab: ["flow", "dash"], label: "Money in", unit: "money",
    get: (rows) => rows.map(r => r.rev),
    allows: ["line", "bars", "stack", "area"] },

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
    allows: ["line", "bars", "stack", "area"] },

  { id: "net", tab: ["flow", "dash"], label: "Net", unit: "money",
    get: (rows) => rows.map(r => r.net),
    // ⚠️ NET IS rev MINUS cost. All three on one chart double-counts every dollar.
    contains: ["rev", "cost"],
    allows: ["line", "bars", "area"] },

  { id: "end", tab: ["flow", "dash"], label: "Cash balance", unit: "money",
    get: (rows) => rows.map(r => r.end),
    // A BALANCE IS A POSITION, NOT A FLOW. Balances do not sum, so stacking one is meaningless and
    // area under one implies an accumulation that has already accumulated.
    allows: ["line", "bars"] },

  { id: "inNonGrant", tab: ["flow"], label: "Non-grant inflow", unit: "money",
    get: (rows) => rows.map(r => r.inNonGrant ?? 0),
    // ⚠️ A SUBSET OF `rev`. It exists to answer what cost share can be matched with.
    contains: ["rev"],
    allows: ["line", "bars", "area"] },

  // ── costs, from the compiled line items ──
  { id: "payroll", tab: ["pay", "flow", "hist"], label: "Payroll", unit: "money",
    get: (rows, parts) => sumLines(parts?.employeeLines, rows.length),
    allows: ["line", "bars", "stack", "area"] },

  { id: "opex", tab: ["flow", "hist"], label: "Operating costs", unit: "money",
    get: (rows, parts, doc) => sumLines((doc?.lines || []).filter(l => l.kind === "cost"), rows.length),
    allows: ["line", "bars", "stack", "area"] },

  { id: "baseline", tab: ["hist", "flow"], label: "Baseline burn", unit: "money",
    get: (rows, parts) => sumLines(parts?.baselineLines, rows.length),
    // MEASURED SPEND MINUS WHAT IS ITEMISED — so it moves when itemisation does, not on its own.
    allows: ["line", "bars", "stack", "area"] },

  { id: "projectSpend", tab: ["proj", "flow"], label: "Project spend", unit: "money",
    get: (rows, parts) => sumLines(parts?.projectLines?.filter(l => l.kind === "cost"), rows.length),
    allows: ["line", "bars", "stack", "area"] },

  { id: "drawdowns", tab: ["proj"], label: "Grant drawdowns", unit: "money",
    get: (rows, parts) => sumLines(parts?.projectLines?.filter(l => l.kind === "revenue"), rows.length),
    allows: ["line", "bars", "stack", "area"] },

  { id: "salesRev", tab: ["sales"], label: "Order revenue", unit: "money",
    get: (rows, parts) => sumLines(parts?.salesLines, rows.length),
    allows: ["line", "bars", "stack", "area"] },

  { id: "capital", tab: ["inv"], label: "Capital in", unit: "money",
    get: (rows, parts) => sumLines(parts?.roundLines, rows.length),
    allows: ["line", "bars", "stack", "area"] },

  { id: "saasRev", tab: ["flow"], label: "Recurring revenue", unit: "money",
    get: (rows, parts) => sumLines(parts?.saasLines, rows.length),
    allows: ["line", "bars", "stack", "area"] },

  // ⚠️ A DIFFERENT UNIT, AND THAT IS THE POINT. Dollars and people on one scale is not a chart, it is
  // a coincidence of magnitudes — $412,000 and 6 people drawn together makes headcount a flat line on
  // the axis. The builder gives a second axis or refuses.
  { id: "headcount", tab: ["pay"], label: "Headcount", unit: "people",
    get: (rows, parts, doc) => rows.map((_, m) =>
      (doc?.employees || []).filter(e => (e.start || 0) <= m && (e.end == null || e.end >= m)).length),
    allows: ["line", "bars"] },
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
  const sets = ids.map(i => measureById(i)?.allows || []);
  let ok = ["line", "bars", "stack", "area"].filter(t => sets.every(s => s.includes(t)));
  if (overlaps(ids).length) ok = ok.filter(t => t !== "stack");
  return ok;
}
