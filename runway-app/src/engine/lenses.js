// What a sub-tab means for the chart above it.
//
// APPLIED AFTER THE CHART IS BUILT, never passed into it. Putting the sub-tab into every build function
// would mean eighteen charts each learning about twenty-four sub-tabs; filtering a finished spec means
// a chart never knows a sub-tab exists, and a new sub-tab costs one line of declaration instead of
// eighteen edits.
//
// MOST ARE NULL, and that is the design working rather than gaps to fill. A lens should exist only
// where a sub-tab genuinely means something different for the picture — otherwise the temptation is to
// invent a difference so the entry looks worthwhile.
//
// TWO MECHANISMS, because "filter" means two things:
//   `keep`  — which series survive. Costs on Cash flow is the same chart with the revenue line gone.
//   `chart` — a different chart entirely, when filtering cannot express it. Pace against an award
//             period is meaningless before there is an award, so Proposals names another chart.

import { chartById } from "./charts.js";

const kindOf = (row, doc) =>
  (doc?.projects || []).find(p => p.id === row.id)?.type || "internal";

export const LENSES = Object.freeze({
  flow: {
    revenue: { label: "Money in", keep: ["in", "revenue", "mrr", "cover"] },
    costs: { label: "Money out", keep: ["out", "payroll", "other"] },
  },
  pay: {
    alloc: { chart: "pay.allocation" },
  },
  proj: {
    grants: { label: "Grants", rows: (r, doc) => kindOf(r, doc) === "grant" },
    internal: { label: "Internal work", rows: (r, doc) => kindOf(r, doc) !== "grant" },
    // Nothing has been awarded, so there is no period to be ahead of.
    proposals: { chart: "proj.budget" },
    fulfil: { chart: "proj.load" },
  },
  sales: {
    subs: { chart: "sales.mrr" },
    orders: { chart: "sales.forecast" },
    targets: { chart: "sales.forecast" },
  },
  inv: {
    stack: { chart: "inv.ownership" },
    goals: { chart: "inv.goals" },
  },
  hist: {
    burn: { chart: "hist.rolling" },
    forecasts: { chart: "hist.planvsactual" },
  },
});

export const lensFor = (tab, subtab) => LENSES[tab]?.[subtab] || null;

/** Which chart to build for a tab and sub-tab.
 *
 *  AN EXPLICIT CHOICE WINS. Picking a chart from the picker is a decision; clicking a sub-tab is
 *  navigation, and letting navigation silently override a decision would make the picker appear
 *  broken the moment somebody browsed.
 */
export function chartIdFor(tab, subtab, chosen, fallback) {
  if (chosen && chartById(chosen)) return chosen;
  const lens = lensFor(tab, subtab);
  if (lens?.chart && chartById(lens.chart)) return lens.chart;
  return fallback;
}

/** Narrow a built spec to what the sub-tab is about. */
export function applyLens(spec, lens, doc) {
  if (!lens || !spec || spec.empty) return spec;
  if (!lens.keep && !lens.rows && !spec.dimOthers) return spec;

  // ⚠️ DIM RATHER THAN FILTER — the "all sub-tabs" mode. The series the sub-tab names is drawn at full
  // strength and the rest stay, marked. THEY MUST STAY ON THE AXIS SCALE: if a dimmed series dropped
  // out of the domain, the emphasised one would jump every time somebody changed sub-tab, and the chart
  // would lie about magnitude while appearing to be helpful.
  //
  // Dimming is opacity, never a colour change. A dimmed series that turned grey has changed identity;
  // one at low opacity is the same series, quieter.
  if (spec.dimOthers && lens.keep) {
    return { ...spec, series: (spec.series || []).map(s => ({ ...s, dim: !lens.keep.includes(s.id) })) };
  }

  // ⚠️ A SPEC WITH NO `series` IS NOT AN EMPTY CHART. `hbars` carries `rows` and no series at all, so
  // `lens.keep` filtered an empty list, concluded the lens had emptied the chart, and replaced the whole
  // spec with "Nothing under X yet." — **the chart never reached its renderer.**
  //
  // That is why every fix to `HBars` appeared to do nothing: the values, the magnitude flag and the
  // sign colours were all correct and none of them were ever drawn. A lens narrows what a chart shows;
  // it cannot narrow a shape it has no handle on, so it leaves it alone.
  if (!spec.series && spec.rows) return spec;

  const series = lens.keep ? (spec.series || []).filter(s => lens.keep.includes(s.id)) : spec.series;
  const rows = lens.rows ? (spec.rows || []).filter(r => lens.rows(r, doc)) : spec.rows;

  // A LENS THAT LEAVES NOTHING SAYS WHICH LENS DID IT. An axis with no content in it reads as broken;
  // "Nothing under Grants" reads as an answer.
  const emptied = (lens.keep && !series.length) || (lens.rows && !rows.length);
  if (emptied) return { empty: `Nothing under ${lens.label || "this view"} yet.` };

  return {
    ...spec,
    series,
    rows,
    // THE BAND IS NOT FILTERABLE. It is computed for the whole projection, so keeping it beside a
    // single filtered series would be drawing a confidence interval around something nobody computed
    // one for.
    band: lens.keep ? undefined : spec.band,
    note: lens.label && spec.note ? spec.note : spec.note,
  };
}
