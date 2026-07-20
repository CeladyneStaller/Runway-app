// Company spend, coded. A month is a ledger of { code, amount, note }; a code map sends each code to
// a project (or to "overhead", which stays in the company baseline). Coded spend flows to projects
// automatically; a per-project manual override can redistribute WITHIN a project, and is flagged when
// it disagrees with the coded total — because an override that changes the project's total isn't
// redistribution, it's an unexplained edit.
//
// This is the shape a QuickBooks class export arrives in, on purpose: the manual entry path and the
// eventual import path are the same code path.

export const OVERHEAD = "overhead";

// A ledger row's total. `v` is kept as the derived monthly total (sum of lines) so burnStats and the
// chart — which read h.v — never learn that months became ledgers.
export const monthTotal = (m) =>
  Array.isArray(m?.lines) ? m.lines.reduce((a, l) => a + (Number(l.amount) || 0), 0) : (Number(m?.v) || 0);

// Distinct codes seen across all months, in first-seen order — the list the mapping UI walks.
export function codesInLedger(hist) {
  const seen = [];
  for (const m of hist || []) for (const l of (m.lines || [])) {
    const c = (l.code || "").trim();
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen;
}

// Codes present in the ledger that the map doesn't resolve yet — what the UI must prompt for.
export const unmappedCodes = (hist, codeMap) =>
  codesInLedger(hist).filter(c => !(codeMap && codeMap[c]));

// Coded spend for one project across months: { [month]: amount }. Only lines whose code maps to this
// project count; uncoded and overhead-coded lines are excluded (they stay in the company baseline).
export function codedActuals(projectId, hist, codeMap) {
  const out = {};
  (hist || []).forEach((m, i) => {
    const month = Number.isFinite(m.month) ? m.month : i;
    let sum = 0;
    for (const l of (m.lines || [])) {
      const c = (l.code || "").trim();
      if (c && codeMap?.[c] === projectId) sum += Number(l.amount) || 0;
    }
    if (sum !== 0) out[month] = sum;
  });
  return out;
}

// The portion of each month NOT attributed to any project — uncoded lines plus anything mapped to
// overhead. This is what remains in the measured-burn baseline, so the "$78k bank vs $67k line items"
// gap survives coding.
export function overheadByMonth(hist, codeMap) {
  const out = {};
  (hist || []).forEach((m, i) => {
    const month = Number.isFinite(m.month) ? m.month : i;
    let sum = 0;
    for (const l of (m.lines || [])) {
      const c = (l.code || "").trim();
      if (!c || !codeMap?.[c] || codeMap[c] === OVERHEAD) sum += Number(l.amount) || 0;
    }
    out[month] = sum;
  });
  return out;
}

// The effective actuals for a project: manual override if present, else coded. Plus a flag when a
// manual override's total differs from what the codes say — the override was meant to move money
// between periods, not change how much there is.
//   overrides shape: { [month]: amount }  (per project, mirrors cashActuals)
export function effectiveActuals(project, hist, codeMap) {
  const coded = codedActuals(project.id, hist, codeMap);
  const override = project.actualsOverride || null;
  if (!override) return { actuals: coded, coded, overridden: false, flagged: false };
  // override wins month-by-month; months it doesn't mention fall back to coded
  const actuals = { ...coded, ...override };
  const codedTotal = Object.values(coded).reduce((a, v) => a + v, 0);
  const effTotal = Object.values(actuals).reduce((a, v) => a + v, 0);
  return {
    actuals, coded, overridden: true,
    flagged: Math.abs(effTotal - codedTotal) > 1,
    codedTotal, effTotal, delta: effTotal - codedTotal,
  };
}
