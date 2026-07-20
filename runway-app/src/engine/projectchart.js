// Per-project "plot against reality": the six monthly series a project card charts — projected and
// actual, for cost, revenue, and net. Pure: a project + its ledger actuals in, arrays out. The view
// draws them; it never computes them.
//
// PROJECTED comes from the project's compiled line items (what the model expects each month).
// ACTUAL comes from the coded ledger (codedActuals / codedRevenue), and only extends as far as the
// books do — beyond the last recorded month, the actual series stops (you can't have an actual for a
// month that hasn't happened). That asymmetry is the whole point: projection runs the full horizon,
// reality trails behind it, and you see the gap.

import { HORIZON } from "./time.js";
import { compileProject } from "./projects.js";
import { codedActuals, codedRevenue, lineAmount } from "./coding.js";

// How much of one compiled line lands in a single month m (not cumulative). Mirrors the projection
// engine's activeness test so the projected series matches what buildProjection would show.
function lineInMonth(l, m) {
  const active = l.cadence === "recurring"
    ? (m >= (l.start ?? 0) && (l.end == null || m <= l.end))
    : (m === (l.start ?? 0));
  if (!active) return 0;
  let amt = lineAmount(l);
  if (l.cadence === "recurring" && l.growthPct) amt *= Math.pow(1 + l.growthPct / 100, m - (l.start ?? 0));
  return amt;
}

// Projected cost and revenue per month for a project, from its compiled lines.
function projectedSeries(project, horizon) {
  const lines = compileProject(project);
  const cost = Array(horizon + 1).fill(0);
  const rev = Array(horizon + 1).fill(0);
  for (const l of lines) {
    const target = l.kind === "revenue" ? rev : cost;
    for (let m = 0; m <= horizon; m++) target[m] += lineInMonth(l, m);
  }
  return { cost, rev };
}

// A {month: amount} actuals map -> a dense array over [0..horizon], plus the last month that actually
// has data (so the view knows where the actual line should stop).
function densify(map, horizon) {
  const arr = Array(horizon + 1).fill(0);
  let last = -1;
  for (const [k, v] of Object.entries(map || {})) {
    const m = Number(k);
    if (Number.isFinite(m) && m >= 0 && m <= horizon) { arr[m] = Number(v) || 0; last = Math.max(last, m); }
  }
  return { arr, last };
}

const runningSum = (arr) => arr.reduce((acc, v, i) => { acc.push((acc[i - 1] || 0) + v); return acc; }, []);

// The full series bundle a project card needs. `maps` is { codeMap, customerMap } (Piece 2).
// Returns monthly and cumulative variants; the toggle in the UI just picks one.
export function projectSeries(project, hist, maps, horizon = HORIZON) {
  const proj = projectedSeries(project, horizon);
  const { arr: actCost, last: lastCost } = densify(codedActuals(project.id, hist, maps), horizon);
  const { arr: actRev, last: lastRev } = densify(codedRevenue(project.id, hist, maps), horizon);
  const actualThrough = Math.max(lastCost, lastRev);   // reality stops here

  const projNet = proj.rev.map((r, i) => r - proj.cost[i]);
  const actNet = actRev.map((r, i) => r - actCost[i]);

  const months = Array.from({ length: horizon + 1 }, (_, i) => i);

  return {
    months,
    actualThrough,                       // -1 if no actuals at all
    hasActuals: actualThrough >= 0,
    monthly: {
      cost: { projected: proj.cost, actual: actCost },
      revenue: { projected: proj.rev, actual: actRev },
      net: { projected: projNet, actual: actNet },
    },
    cumulative: {
      cost: { projected: runningSum(proj.cost), actual: runningSum(actCost) },
      revenue: { projected: runningSum(proj.rev), actual: runningSum(actRev) },
      net: { projected: runningSum(projNet), actual: runningSum(actNet) },
    },
  };
}
