// Piece 3: recorded revenue replaces projected revenue, past-only, per project-month.
//
// The rule (all four decisions pinned):
//   SCOPE      past-only. For each project, replacement runs up to that project's LAST recorded
//              revenue month. Beyond it, projection is untouched — the forward forecast is unchanged.
//              The bound is per-project: a grant with actuals through month 3 is replaced through 3;
//              a PO with an actual only in month 1 is replaced only in month 1.
//   SUPPRESS   total, per project-month. In a month within a project's recorded range, ALL of that
//              project's projected revenue lines are removed and the recorded actual stands in. The
//              actual is the whole truth for that project that month (even a recorded $0).
//   ALWAYS ON  no toggle. When revenue actuals exist, they are used.
//   FLAG       where projected and actual disagree, surface it (revenueVariance) — but still use the
//              actual. Seeing "grant paid $40k, you projected $50k" must not silently move the runway.
//
// Design: this is a PURE pre-processing step over line items, NOT surgery inside buildProjection. It
// swaps the affected projected-revenue lines for one-time actual lines, then the untouched, tested
// projection engine runs on the result. Cheaper to reason about and impossible to break the hot loop.

import { HORIZON } from "./time.js";

// Which project does a revenue line belong to? Project lines carry projectId; PO lines carry poId and
// the PO knows its projectId; nothing else is project-scoped. `poProject` maps poId -> projectId.
export const lineProject = (l, poProject) =>
  l.projectId || (l.poId && poProject ? poProject[l.poId] : null) || null;

// The last month each project has a recorded revenue actual. { projectId: lastMonth }. Absent = no
// actuals for that project = no replacement.
export function recordedThrough(revActuals) {
  const out = {};
  for (const [pid, byMonth] of Object.entries(revActuals || {})) {
    const months = Object.keys(byMonth || {}).map(Number).filter(Number.isFinite);
    if (months.length) out[pid] = Math.max(...months);
  }
  return out;
}

// The projected revenue a project would book in a given month, from its revenue line items, under the
// current toggles. Used both to compute the variance and to know how much to remove.
function projectedRevAt(lineItems, projectId, month, toggles, poProject) {
  let sum = 0;
  for (const l of lineItems) {
    if (l.kind !== "revenue") continue;
    if (lineProject(l, poProject) !== projectId) continue;
    if (l.financing && !toggles.financing) continue;
    if (!toggles[l.confidence]) continue;
    const active = l.cadence === "recurring"
      ? (month >= l.start && (l.end == null || month <= l.end))
      : (month === l.start);
    if (!active) continue;
    let amt = Number(l.amount) || 0;
    if (l.cadence === "recurring" && l.growthPct) amt = amt * Math.pow(1 + l.growthPct / 100, month - l.start);
    sum += amt;
  }
  return sum;
}

// Apply the replacement. Returns { lineItems, variances }:
//   lineItems  a new array with affected projected-revenue lines removed and recorded actuals added.
//              Feed this straight into buildProjection.
//   variances  [{ projectId, month, projected, actual, delta }] wherever the two disagree — the flag
//              data for the UI. Still uses the actual; this is transparency, not a veto.
export function applyRevenueActuals(lineItems, revActuals, toggles, { poProject = {}, horizon = HORIZON } = {}) {
  const through = recordedThrough(revActuals);
  const pids = Object.keys(through);
  if (pids.length === 0) return { lineItems, variances: [] };

  // 1. drop every projected-revenue line that falls in a project's recorded range. A recurring line
  //    spanning the boundary is split: the recorded-range months are removed, later months kept.
  const kept = [];
  for (const l of lineItems) {
    const pid = l.kind === "revenue" ? lineProject(l, poProject) : null;
    const lastM = pid != null ? through[pid] : undefined;
    if (lastM === undefined) { kept.push(l); continue; }          // not a replaced project
    if (l.cadence !== "recurring") {
      // one-time: keep only if it lands AFTER the recorded range
      if ((l.start ?? 0) > lastM) kept.push(l);
      continue;
    }
    // recurring: keep the portion strictly after lastM
    const start = l.start ?? 0, end = l.end == null ? horizon : l.end;
    if (end > lastM) kept.push({ ...l, start: Math.max(start, lastM + 1), end: l.end });
    // the <= lastM portion is dropped (replaced by the actual below)
  }

  // 2. add one recorded-actual revenue line per (project, month) in range, and record variances.
  const variances = [];
  for (const pid of pids) {
    const lastM = through[pid];
    const byMonth = revActuals[pid] || {};
    for (let m = 0; m <= lastM; m++) {
      const actual = Number(byMonth[m]) || 0;                     // a month with no entry inside the
      const projected = projectedRevAt(lineItems, pid, m, toggles, poProject); // range means recorded $0
      if (actual !== 0) {
        kept.push({
          kind: "revenue", cadence: "onetime", amount: actual, start: m,
          confidence: "committed",           // recorded money is committed by definition
          projectId: pid, isActual: true,
        });
      }
      if (Math.abs(actual - projected) > 1) {
        variances.push({ projectId: pid, month: m, projected, actual, delta: actual - projected });
      }
    }
  }

  return { lineItems: kept, variances };
}
