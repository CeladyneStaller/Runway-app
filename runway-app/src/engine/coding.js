// Company spend, coded. A month is a ledger of { code, amount, note }; a code map sends each code to
// a project (or to "overhead", which stays in the company baseline). Coded spend flows to projects
// automatically; a per-project manual override can redistribute WITHIN a project, and is flagged when
// it disagrees with the coded total — because an override that changes the project's total isn't
// redistribution, it's an unexplained edit.
//
// This is the shape a QuickBooks class export arrives in, on purpose: the manual entry path and the
// eventual import path are the same code path.

export const OVERHEAD = "overhead";

// A ledger line grew from { code, amount, note } to carry dimensions. EVERY new field is optional and
// defaults to today's behaviour, so existing lines, the demo, and the v2→v3 migration all keep working
// and the golden number cannot move:
//   code      -> object-class / GL code string, resolves to a project via codeMap
//   customer  -> customer/client name, resolves to a project via customerMap. When both are present,
//                customer wins (it's the more specific "which project" answer; code answers "what
//                kind"). This is the field QuickBooks imports key on.
//   amount    -> magnitude (unchanged; always positive — direction lives in `kind`, not the sign)
//   note      -> free text (unchanged)
//   kind      -> "cost" | "revenue"; ABSENT means cost. This is the load-bearing default: burn/spend
//                sums count cost only, so a revenue line must never silently subtract from spend.
//   category  -> object class ("personnel" | "fringe" | ... ) | undefined. For grant reconciliation.
//   period    -> budget-period index | undefined. For grant reconciliation.
export const lineKind = (l) => (l?.kind === "revenue" ? "revenue" : "cost");
export const isCost = (l) => lineKind(l) === "cost";
export const isRevenue = (l) => lineKind(l) === "revenue";
export const lineAmount = (l) => Number(l?.amount) || 0;
export const lineCategory = (l) => l?.category || null;
export const lineCustomer = (l) => (l?.customer || "").trim();
export const lineCode = (l) => (l?.code || "").trim();
export const linePeriod = (l) => (Number.isFinite(l?.period) ? l.period : null);

// A month's total SPEND. `v` is kept as the derived total so burnStats and the chart — which read
// h.v — never learn months became ledgers. Counts cost lines only: a revenue line is money in, not
// burn, so it must not net against spend. A line with no `kind` is cost (the default), so this is
// identical to the old behaviour for every pre-v3 line.
export const monthTotal = (m) =>
  Array.isArray(m?.lines)
    ? m.lines.reduce((a, l) => a + (isCost(l) ? lineAmount(l) : 0), 0)
    : (Number(m?.v) || 0);

// A month's total recorded REVENUE (coded revenue lines). Zero until revenue lines exist, so nothing
// changes for existing data. Piece 3 (revenue replaces projection) will consume this.
export const monthRevenue = (m) =>
  Array.isArray(m?.lines) ? m.lines.reduce((a, l) => a + (isRevenue(l) ? lineAmount(l) : 0), 0) : 0;

// Distinct codes seen across all months, in first-seen order — the list the mapping UI walks.
export function codesInLedger(hist) {
  const seen = [];
  for (const m of hist || []) for (const l of (m.lines || [])) {
    const c = (l.code || "").trim();
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen;
}

// Resolve one line to its project. Consults customerMap by the line's customer, then codeMap by its
// code. Returns a projectId, OVERHEAD, or null (nothing maps it -> stays in the baseline).
// `maps` is { codeMap, customerMap }; either may be absent. Passing only { codeMap } reproduces the
// old code-only behaviour exactly, which is what keeps Piece 1's tests green.
export function resolveLine(l, maps) {
  const codeMap = maps?.codeMap || (maps && !("codeMap" in maps) ? maps : null);  // tolerate a bare codeMap
  const customerMap = maps?.customerMap || null;
  const cust = lineCustomer(l);
  if (cust && customerMap?.[cust]) return customerMap[cust];
  const code = lineCode(l);
  if (code && codeMap?.[code]) return codeMap[code];
  return null;
}

// Codes present in the ledger that the code map doesn't resolve yet — what the UI must prompt for.
export const unmappedCodes = (hist, codeMap) =>
  codesInLedger(hist).filter(c => !(codeMap && codeMap[c]));

// Distinct customers seen across the ledger, first-seen order — the list the customer-mapping UI walks.
export function customersInLedger(hist) {
  const seen = [];
  for (const m of hist || []) for (const l of (m.lines || [])) {
    const c = lineCustomer(l);
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen;
}

// Customers present but not yet mapped to a project.
export const unmappedCustomers = (hist, customerMap) =>
  customersInLedger(hist).filter(c => !(customerMap && customerMap[c]));

// Rows that no map resolves at all (neither customer nor code) — the true "sits in overhead" set the
// import preview should surface, since a user may not realise unmapped spend never reaches a project.
export function unresolvedLines(hist, maps) {
  const out = [];
  for (const m of hist || []) for (const l of (m.lines || [])) {
    const cust = lineCustomer(l), code = lineCode(l);
    if ((cust || code) && resolveLine(l, maps) == null) out.push({ customer: cust, code, amount: lineAmount(l) });
  }
  return out;
}

// Coded spend for one project across months: { [month]: amount }. Only lines whose code maps to this
// project count; uncoded and overhead-coded lines are excluded (they stay in the company baseline).
export function codedActuals(projectId, hist, maps) {
  const out = {};
  (hist || []).forEach((m, i) => {
    const month = Number.isFinite(m.month) ? m.month : i;
    let sum = 0;
    for (const l of (m.lines || [])) {
      if (isCost(l) && resolveLine(l, maps) === projectId) sum += lineAmount(l);
    }
    if (sum !== 0) out[month] = sum;
  });
  return out;
}

// Coded REVENUE for one project, by month. Symmetric to codedActuals but for money in. Empty until
// revenue lines are imported; Piece 3 uses it to replace projected revenue where actuals exist.
export function codedRevenue(projectId, hist, maps) {
  const out = {};
  (hist || []).forEach((m, i) => {
    const month = Number.isFinite(m.month) ? m.month : i;
    let sum = 0;
    for (const l of (m.lines || [])) {
      if (isRevenue(l) && resolveLine(l, maps) === projectId) sum += lineAmount(l);
    }
    if (sum !== 0) out[month] = sum;
  });
  return out;
}

// The portion of each month NOT attributed to any project — uncoded lines plus anything mapped to
// overhead. This is what remains in the measured-burn baseline, so the "$78k bank vs $67k line items"
// gap survives coding.
export function overheadByMonth(hist, maps) {
  const out = {};
  (hist || []).forEach((m, i) => {
    const month = Number.isFinite(m.month) ? m.month : i;
    let sum = 0;
    for (const l of (m.lines || [])) {
      if (!isCost(l)) continue;
      const dest = resolveLine(l, maps);
      if (dest == null || dest === OVERHEAD) sum += lineAmount(l);
    }
    out[month] = sum;
  });
  return out;
}

// The effective actuals for a project: manual override if present, else coded. Plus a flag when a
// manual override's total differs from what the codes say — the override was meant to move money
// between periods, not change how much there is.
//   overrides shape: { [month]: amount }  (per project, mirrors cashActuals)
export function effectiveActuals(project, hist, maps) {
  const coded = codedActuals(project.id, hist, maps);
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
