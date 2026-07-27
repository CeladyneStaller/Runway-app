// Aggregate statistics: "N companies use Waterline", "$X billion in runway modelled".
//
// This is the ONE use of customer data beyond running the service, so the shape of it is a commitment
// the privacy policy makes on our behalf. Three rules, and each is enforced here in code rather than
// left to whoever writes the next query:
//
//   1. THE OUTPUT IS SCALARS ONLY. `companyStats()` returns an object of numbers. Not a name, not an
//      id, not a string. A test asserts the type of every value, so adding `topEarner: "Alex Rivera"`
//      fails the build rather than shipping.
//   2. A MINIMUM COHORT. Financial figures computed across a handful of companies can be reversed
//      into individual values, which makes them personal data wearing a disguise. Below the floor the
//      figures are suppressed — not rounded, not fuzzed, absent.
//   3. OPT-OUT IS HONOURED BEFORE ANYTHING IS READ, not filtered out afterwards.
//
// AN HONEST NOTE ABOUT RULE 1, because the first draft of the privacy policy got this wrong.
// You cannot compute a runway without reading salaries — payroll is most of the burn, so the number
// this whole feature exists to publish is DERIVED from employee records by construction. The guarantee
// that can actually be kept is about what LEAVES this module, not about what it reads:
//
//   - it reads a full document, in memory, for as long as one projection takes;
//   - it emits a handful of anonymous numbers;
//   - nothing per-person is emitted, retained, or written anywhere.
//
// That is a real and checkable promise. "Salaries are excluded from every calculation" was not.

import { buildModelFromDoc } from "./buildmodel.js";
import { buildProjection, zeroInfo } from "./projection.js";
import { HORIZON } from "./time.js";

/** Below this many contributing companies, no financial figure is published.
 *  A COUNT is different and is never suppressed: "14 companies use Waterline" says nothing about any
 *  of them. It is the sums and averages that leak when the cohort is small. */
export const MIN_COHORT = 10;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const len = (v) => (Array.isArray(v) ? v.length : 0);

/** Has this company actually put anything in?
 *
 *  A COMPANY THAT SIGNED UP AND NEVER TYPED ANYTHING MUST NOT BE COUNTED. The setup wizard creates
 *  an empty document by design, and empty documents project perfectly happily — they just project to
 *  zero. Including them would inflate "N companies use Waterline" with people who never used it, and
 *  drag every average toward zero with companies that have no numbers rather than small ones. Both
 *  make the published figures wrong in the flattering direction, which is the worst kind of wrong. */
export const contributes = (doc) =>
  !!doc && typeof doc === "object" &&
  (num(doc.cash) > 0 || len(doc.employees) > 0 || len(doc.lines) > 0 ||
   len(doc.projects) > 0 || len(doc.rounds) > 0 || len(doc.pos) > 0 || len(doc.saas) > 0);

/** Reduce ONE document to the scalars that may be aggregated.
 *
 *  This is the choke point. Everything downstream sees only what this returns, so the privacy promise
 *  is enforced by the return shape rather than by reviewer vigilance. Every value is a number.
 *
 *  Returns null for a document that cannot be projected — a broken document must not take the whole
 *  job down, and a company contributing zeros would silently drag every average toward zero. */
export function companyStats(doc) {
  if (!contributes(doc)) return null;
  let rows;
  try {
    rows = buildProjection(buildModelFromDoc(doc), doc.settings?.toggles);
  } catch { return null; }
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const z = zeroInfo(rows);
  const months = z && z.months != null ? z.months : null;
  const window = rows.length;

  return {
    cash: num(doc.cash),
    // null means "no zero date inside the horizon", which is NOT the same as a long runway and must
    // not be averaged in as `HORIZON`. Carried through as null and counted separately.
    runwayMonths: months,
    beyondHorizon: months == null ? 1 : 0,
    annualRevenue: rows.reduce((a, r) => a + num(r.rev), 0) / window * 12,
    annualCost: rows.reduce((a, r) => a + num(r.cost), 0) / window * 12,
    // A HEADCOUNT, not a person: how big the company is, the same kind of fact as how much cash it
    // has. No name, title or salary is emitted, here or anywhere.
    headcount: Array.isArray(doc.employees) ? doc.employees.length : 0,
    fundingRaised: (Array.isArray(doc.rounds) ? doc.rounds : [])
      .filter(r => r?.status === "closed" || r?.status === "committed")
      .reduce((a, r) => a + num(r.amount), 0),
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const round = (v, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** Aggregate the per-company scalars into the figures that get published.
 *
 *  `companies` is always reported. Everything else is suppressed below MIN_COHORT. */
export function aggregate(list, { minCohort = MIN_COHORT } = {}) {
  const stats = (list || []).filter(Boolean);
  const n = stats.length;

  const base = {
    companies: n,
    sampleSize: n,
    minCohort,
    suppressed: n < minCohort,
    horizonMonths: HORIZON,
    computedAt: new Date().toISOString(),
  };

  // Suppressed means ABSENT, not rounded or fuzzed. A blurred figure still carries information.
  if (n < minCohort) {
    return { ...base, totalCash: null, totalFundingRaised: null, totalAnnualRevenue: null,
             medianRunwayMonths: null, meanRunwayMonths: null, totalHeadcount: null,
             companiesBeyondHorizon: null };
  }

  const finite = stats.map(s => s.runwayMonths).filter(v => v != null);

  return {
    ...base,
    totalCash: round(stats.reduce((a, s) => a + s.cash, 0)),
    totalFundingRaised: round(stats.reduce((a, s) => a + s.fundingRaised, 0)),
    totalAnnualRevenue: round(stats.reduce((a, s) => a + s.annualRevenue, 0)),
    totalHeadcount: stats.reduce((a, s) => a + s.headcount, 0),
    // Computed across companies that HAVE a zero date. Treating "no zero date" as HORIZON would
    // silently cap the average and understate exactly the healthiest customers.
    medianRunwayMonths: round(median(finite), 1),
    meanRunwayMonths: round(finite.length ? finite.reduce((a, v) => a + v, 0) / finite.length : null, 1),
    runwaySampleSize: finite.length,
    companiesBeyondHorizon: stats.reduce((a, s) => a + s.beyondHorizon, 0),
  };
}

/** Everything, from documents to a publishable row. `docs` is an array of raw document bodies for
 *  companies that have NOT opted out — the caller does that filtering, because it belongs in the
 *  query rather than here. */
export const computeStats = (docs, opts) =>
  aggregate((docs || []).map(companyStats), opts);
