// SaaS subscription revenue.
//
// A recurring revenue LINE can't express a subscription business, and the difference matters. A line
// grows geometrically from one amount; a subscription book is a population — customers arrive, some
// leave every month, and the ones who stay may pay more over time. Those three forces produce a curve
// that no single growth percentage reproduces: early on, adds dominate and it looks linear; later,
// churn scales with the base and it flattens toward a ceiling of adds/churn. That ceiling is the whole
// reason to model this separately. A founder who plugs "8% monthly growth" into a recurring line gets
// a hockey stick that never arrives.
//
// EXPANDS INTO ORDINARY LINE ITEMS, exactly like capital.js does for instruments and projects.js for
// projects. Nothing downstream learns a new cadence: buildProjection, the scenario engine, the
// confidence bands, SF-424A and the revenue-actuals replacement all keep working unchanged because
// what they receive is the same one-time revenue line they have always received. The alternative —
// a `cadence: "saas"` interpreted inside the projection loop — would mean touching every switch on
// cadence in the codebase and hoping none were missed.

import { HORIZON } from "./time.js";

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pct = (v) => n(v) / 100;

/** The month-by-month subscription book: customers on the books and the revenue they bill.
 *
 *  customers[m] = customers[m-1] × (1 − churn) + adds[m]
 *  adds[m]      = newPerMonth × (1 + newGrowth)^(m − start)
 *  arpu[m]      = arpu × (1 + arpuGrowth)^(m − start)
 *  mrr[m]       = customers[m] × arpu[m]
 *
 *  Churn is applied BEFORE the month's adds, so a customer who signs up in month m bills in month m.
 *  Signing someone up and immediately churning a fraction of them the same month would double-count
 *  the loss against a cohort that hasn't had a renewal date yet.
 *
 *  Returned as a series rather than just lines because the editor draws it — being able to see the
 *  ceiling your churn implies is most of the value of modelling this at all. */
export function saasSeries(s, horizon = HORIZON) {
  const start = Math.max(0, Math.round(n(s?.start)));
  const churn = Math.min(1, Math.max(0, pct(s?.churnPct)));
  const newGrowth = pct(s?.newGrowthPct);
  const arpuGrowth = pct(s?.arpuGrowthPct);
  const adds0 = Math.max(0, n(s?.newPerMonth));
  const arpu0 = n(s?.arpu);

  const out = [];
  let customers = Math.max(0, n(s?.startCustomers));
  for (let m = start; m <= horizon; m++) {
    const k = m - start;
    if (k > 0) customers = customers * (1 - churn) + adds0 * Math.pow(1 + newGrowth, k);
    const arpu = arpu0 * Math.pow(1 + arpuGrowth, k);
    out.push({ month: m, customers, arpu, mrr: customers * arpu });
  }
  return out;
}

/** Steady state: where the book settles if nothing changes. adds / churn, because in equilibrium the
 *  number lost each month equals the number gained. Null when churn is zero (it grows without bound)
 *  or when adds are zero (it decays to nothing) — both real answers, neither a ceiling. */
export function saasCeiling(s) {
  const churn = Math.min(1, Math.max(0, pct(s?.churnPct)));
  const adds = Math.max(0, n(s?.newPerMonth));
  if (churn <= 0 || adds <= 0) return null;
  const customers = adds / churn;
  return { customers, mrr: customers * n(s?.arpu) };
}

// ---- RECONCILIATION -------------------------------------------------------------------------
//
// Recorded MRR replaces projected MRR, following the SAME four rules `revenue.js` pins for project
// revenue, deliberately — a second, subtly different reconciliation doctrine in the same app would be
// worse than either one on its own:
//   SCOPE      past-only, bounded by this book's LAST recorded month. Beyond it the model runs.
//   SUPPRESS   total. In a recorded month the modelled MRR is gone and the recorded number stands,
//              including a recorded $0 — a month you billed nothing is a fact, not a gap.
//   ALWAYS ON  no toggle. If you recorded it, it's used.
//   FLAG       surface the disagreement, but still use the actual.
//
// WHERE THE NUMBERS COME FROM IS DIFFERENT, though, and that difference is the whole reason this
// doesn't ride on `applyRevenueActuals`. Project revenue is reconciled from CODED HISTORY, because a
// grant payment arrives as a bank deposit that has to be attributed to something. MRR arrives from a
// billing system and the founder simply knows it — so it is entered directly against the book, and no
// coding exercise stands between knowing the number and recording it.

/** Recorded MRR by month, coerced. Keys arrive from JSON as strings. */
export function saasActuals(s) {
  const out = {};
  for (const [k, v] of Object.entries(s?.actuals || {})) {
    const m = Number(k);
    if (Number.isFinite(m) && m >= 0) out[m] = n(v);
  }
  return out;
}

/** The last month this book has a recorded figure for, or null. The replacement bound. */
export function recordedThroughSaas(s) {
  const months = Object.keys(saasActuals(s)).map(Number);
  return months.length ? Math.max(...months) : null;
}

/** What each month actually bills, once records are taken into account: `projected` is what the model
 *  said, `billed` is what the runway uses, and `isActual` says which. */
export function saasBilled(s, horizon = HORIZON) {
  const actuals = saasActuals(s);
  const through = recordedThroughSaas(s);
  return saasSeries(s, horizon).map(p => {
    const recorded = through != null && p.month <= through;
    return {
      month: p.month,
      customers: p.customers,
      projected: p.mrr,
      actual: recorded ? (actuals[p.month] ?? 0) : null,   // inside the range, a missing month is $0
      billed: recorded ? (actuals[p.month] ?? 0) : p.mrr,
      isActual: recorded,
    };
  });
}

/** Where record and model disagree. Transparency, not a veto — the actual is used either way. */
export function saasVariances(s, horizon = HORIZON) {
  return saasBilled(s, horizon)
    .filter(p => p.isActual && Math.abs(p.actual - p.projected) > 1)
    .map(p => ({
      saasId: s?.id, label: s?.name || "Subscriptions",
      month: p.month, projected: p.projected, actual: p.actual, delta: p.actual - p.projected,
    }));
}

/** How many customers the last recorded month IMPLIES, at the price the model assumes for it. This is
 *  the number that matters for a subscription book and has no analogue in grant reconciliation: a
 *  grant paying less than expected is one disappointing month, whereas billing less than expected
 *  means the customer count is wrong, and therefore every FORWARD month is wrong too. */
export function impliedCustomers(s) {
  const through = recordedThroughSaas(s);
  if (through == null) return null;
  const point = saasSeries(s, Math.max(through, 0)).find(p => p.month === through);
  if (!point || point.arpu <= 0) return null;
  return { month: through, implied: (saasActuals(s)[through] ?? 0) / point.arpu, modelled: point.customers };
}

/** Restart the forward model from what was actually billed.
 *
 *  NOT AUTOMATIC, and that is the point. Past replacement is always on because a recorded month is
 *  simply a fact; re-basing changes the FORECAST, and this app's standing rule is that a discovered
 *  disagreement must not silently move the runway. So it is an action somebody takes, having seen the
 *  variance and the implied customer count.
 *
 *  The assumptions carry across unchanged — churn, add growth and price growth all continue on the
 *  same curve, with `newPerMonth` and `arpu` advanced to their month-`through` values so the forward
 *  series is exactly continuous. The ONLY thing that moves is the customer base it starts from. */
export function rebaseFromActuals(s) {
  const imp = impliedCustomers(s);
  if (!imp) return s;
  const start = Math.max(0, Math.round(n(s?.start)));
  const k = imp.month - start;
  if (k < 0) return s;
  return {
    ...s,
    start: imp.month,
    startCustomers: imp.implied,
    arpu: n(s?.arpu) * Math.pow(1 + pct(s?.arpuGrowthPct), k),
    newPerMonth: Math.max(0, n(s?.newPerMonth)) * Math.pow(1 + pct(s?.newGrowthPct), k),
  };
}

/** One revenue line per month. One-time rather than recurring because the amount changes every month
 *  and a recurring line has exactly one amount and one growth rate — the shape this exists to model
 *  is precisely the one that cannot be written that way. */
export function compileSaas(s, horizon = HORIZON) {
  if (!s || s.include === false) return [];
  const conf = s.confidence || "expected";
  return saasBilled(s, horizon)
    .filter(p => p.billed > 0.5)       // a month billing nothing is not a line
    .map(p => ({
      label: `${s.name || "Subscriptions"}${p.isActual ? " · recorded" : " · MRR"}`,
      kind: "revenue",
      cadence: "onetime",
      amount: p.billed,
      start: p.month,
      // Recorded money is committed BY DEFINITION — it already happened, so no confidence toggle
      // should be able to switch it off. Same treatment `revenue.js` gives recorded project revenue.
      confidence: p.isActual ? "committed" : conf,
      saasId: s.id,
      isActual: p.isActual || undefined,
    }));
}

/** Current monthly recurring revenue — month 0, or the first billing month if it starts later. Used
 *  for the summary row; `saasSeries` is the source of truth for everything else. */
export const saasMRR = (s, horizon = HORIZON) => {
  const series = saasSeries(s, horizon);
  const now = series.find(p => p.month === 0);
  return now ? now.mrr : (series[0]?.mrr || 0);
};

export const blankSaas = () => ({
  id: crypto.randomUUID(),
  name: "Subscriptions",
  start: 0,
  startCustomers: 0,
  arpu: 0,
  newPerMonth: 0,
  churnPct: 0,
  newGrowthPct: 0,
  arpuGrowthPct: 0,
  confidence: "expected",
  include: true,
  actuals: {},        // { month: recorded MRR }
});
