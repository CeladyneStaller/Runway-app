// Cost-share reconciliation. "Did the grant's required match actually get spent?" — answered entirely
// from data already present: the REQUIRED side is the grant budget × costSharePct (computeGrant already
// derives it per period and per category), the RECORDED side is the ledger lines coded to the grant
// (Piece 1 tags each with category + period). Zero new user input; this is a pure derivation.
//
// The one thing the ledger can't know automatically is which recorded spend is the non-federal MATCH
// vs the federal share. Tier-1 inference: of what you recorded against the grant, the same costSharePct
// is assumed to be match (a 20% grant -> ~20% of recorded spend counts toward the match). It's an
// estimate, labelled as one, and needs nothing from the user. Category detail (Tier 3) falls out of the
// `category` already on each line.

import { computeGrant } from "./grant.js";
import { codedActuals, lineCategory, linePeriod, lineCode, lineCustomer, isCost, lineAmount, resolveLine } from "./coding.js";

// The SF-424A object classes we reconcile against. Ledger `category` values are lower-cased on import,
// so we match case-insensitively.
export const COST_SHARE_CATEGORIES = ["personnel", "fringe", "travel", "equipment", "supplies", "contractual", "construction", "other"];

// Sum recorded grant COST lines for a project, split by budget period and by category. A line with no
// period is attributed to the period its month falls in (via the grant's period ranges); a line with no
// category lands in "uncategorized" so nothing is silently dropped.
function recordedByPeriodCategory(projectId, hist, maps, periods) {
  // month -> period index, from the grant's period ranges
  const periodOfMonth = (m) => {
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      if (m >= (p.start ?? 0) && m <= (p.end ?? Infinity)) return i;
    }
    return periods.length ? periods.length - 1 : 0;   // clamp stragglers into the last period
  };

  const byPeriod = periods.map(() => ({ total: 0, byCat: {} }));
  (hist || []).forEach((mo, idx) => {
    const month = Number.isFinite(mo.month) ? mo.month : idx;
    for (const l of (mo.lines || [])) {
      if (!isCost(l)) continue;
      if (resolveLine(l, maps) !== projectId) continue;
      const pi = linePeriod(l) != null ? linePeriod(l) : periodOfMonth(month);
      const bucket = byPeriod[pi] || (byPeriod[pi] = { total: 0, byCat: {} });
      const cat = (lineCategory(l) || "uncategorized").toLowerCase();
      const amt = lineAmount(l);
      bucket.total += amt;
      bucket.byCat[cat] = (bucket.byCat[cat] || 0) + amt;
    }
  });
  return byPeriod;
}

// The full reconciliation for one grant project. Returns null for a project with no grant or no match
// requirement (so the UI shows nothing for those). `maps` is { codeMap, customerMap }.
export function costShareReconciliation(project, hist, maps, horizon) {
  const g = project?.grant;
  const cs = g?.costSharePct || 0;
  if (!g || cs <= 0) return null;

  const compiled = computeGrant(g, horizon);
  const periods = g.periods || [];
  const recorded = recordedByPeriodCategory(project.id, hist, maps, periods);

  // Per-period: required match = budget total × cs; recorded match = recorded spend × cs (Tier-1).
  const perPeriod = periods.map((p, i) => {
    const budget = compiled.per[i] || {};
    const required = budget.costShare || 0;                 // budget total × cs, already computed
    const recordedSpend = recorded[i]?.total || 0;
    const recordedMatch = recordedSpend * cs;               // Tier-1 inference
    // per category: required = category budget × cs; recorded = recorded-in-category × cs
    const byCat = COST_SHARE_CATEGORIES.map(cat => {
      const catBudget = budget[cat] || 0;
      const catRequired = catBudget * cs;
      const catRecorded = (recorded[i]?.byCat?.[cat] || 0) * cs;
      return { category: cat, required: catRequired, recorded: catRecorded,
        met: catRequired <= 0 ? true : catRecorded >= catRequired - 0.5,
        pct: catRequired > 0 ? catRecorded / catRequired : (catRecorded > 0 ? 1 : null) };
    }).filter(c => c.required > 0 || c.recorded > 0);       // hide categories with neither budget nor spend
    return {
      period: i, start: p.start, end: p.end,
      required, recordedMatch, recordedSpend,
      remaining: Math.max(0, required - recordedMatch),
      met: required <= 0 ? true : recordedMatch >= required - 0.5,
      pct: required > 0 ? recordedMatch / required : null,
      byCat,
    };
  });

  const required = perPeriod.reduce((a, p) => a + p.required, 0);
  const recordedMatch = perPeriod.reduce((a, p) => a + p.recordedMatch, 0);

  return {
    costSharePct: cs,
    costShareType: g.costShareType || "cash",
    required,
    recordedMatch,
    remaining: Math.max(0, required - recordedMatch),
    pct: required > 0 ? recordedMatch / required : null,
    met: required <= 0 ? true : recordedMatch >= required - 0.5,
    hasRecorded: perPeriod.some(p => p.recordedSpend > 0),
    perPeriod,
  };
}
