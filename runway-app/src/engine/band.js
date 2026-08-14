// Confidence bands for the runway. Two independent, HONEST sources of width:
//
//   REVENUE range — from the confidence tiers the model already carries. floor = committed only,
//     expected = committed+expected, ceiling = +speculative. No invented probabilities; the tiers ARE
//     the confidence structure. The band answers "how much does my runway depend on uncertain revenue".
//
//   COST range — from MEASURED historical burn variance (not guessed). If actual monthly spend has
//     historically scattered around its mean by some %, that demonstrated volatility widens the band:
//     the floor burns faster (downside), the ceiling slower (upside). This is the "calibrate from real
//     forecast error" idea, applied to the one variable the app can actually measure — cost — because
//     there's no stored history of past REVENUE forecasts to measure revenue error against.
//
// Deliberately NOT Monte Carlo: that needs per-line probabilities the model doesn't have, and a
// distribution off a handful of months is false precision. This is a bracket of defensible cases, and
// the width itself is the insight — narrow = robust runway, wide = betting on uncertain revenue.

import { HORIZON } from "./time.js";
import { buildModelFromDoc } from "./buildmodel.js";
import { buildProjection, zeroInfo } from "./projection.js";
import { monthTotal } from "./coding.js";

// The coefficient of variation of measured monthly burn. IMPORTANT: this uses the RAW monthly totals,
// not burnStats' flag-filtered set. Flagging exists to stabilize the run-rate by excluding outliers —
// but variance is exactly the spread those outliers represent, so filtering them out would erase the
// very signal we want. We do drop the single most extreme month if there are enough points, so one
// freak month (a big one-time payment) doesn't dominate, but otherwise we keep the real scatter.
// Returns a fraction (0.12 = spend scatters ±12% around its mean). Zero when there isn't enough
// history to say anything — in which case the cost side adds no width, honestly.
export function burnVariance(hist, expectedBurn, flagOverrides = {}, method = "trailing") {
  let totals = (hist || []).map(h => monthTotal(h)).filter(v => v > 0);
  if (totals.length < 3) return 0;                      // too few points to claim a variance
  // trim the single most extreme month when we have room, so one freak doesn't dominate the CV
  if (totals.length >= 5) {
    const mean0 = totals.reduce((a, b) => a + b, 0) / totals.length;
    const far = totals.reduce((best, v, i) => Math.abs(v - mean0) > Math.abs(totals[best] - mean0) ? i : best, 0);
    totals = totals.filter((_, i) => i !== far);
  }
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  if (mean <= 0) return 0;
  const varc = totals.reduce((a, v) => a + (v - mean) ** 2, 0) / totals.length;
  const cv = Math.sqrt(varc) / mean;
  // clamp so a wild demo can't produce an absurd band; real burn CV is typically 0.05–0.25
  return Math.min(0.4, cv);
}

// Scale every cost line in a model by (1 + factor). factor > 0 burns faster (floor), < 0 slower
// (ceiling). Revenue lines are untouched — cost and revenue uncertainty are handled separately.
function scaleCosts(model, factor) {
  if (!factor) return model;
  return { ...model, lineItems: model.lineItems.map(l =>
    l.kind === "revenue" ? l : { ...l, amount: (Number(l.amount) || 0) * (1 + factor) }) };
}

const zeroOf = (model, toggles) => {
  const z = zeroInfo(buildProjection(model, toggles));
  return z ? z.months : null;                            // null = doesn't run out within horizon
};

// The full band. Returns three curves (floor/expected/ceiling) as row arrays for shading, their three
// zero-dates, and the burn-variance factor used, plus a flag for how wide the band is.
/**
 * @param revenue  optional `{committed, expected, speculative}` — the revenue set ALL THREE curves use,
 *                 so the band's width comes from COST variance alone.
 *
 * ⚠️ WITHOUT IT, THE THREE CURVES USE THREE DIFFERENT REVENUE SETS: floor is committed-only, ceiling
 * adds speculative. That is one band expressing TWO uncertainties at once — how wrong the spend model
 * is, AND whether speculative revenue lands — and its width means neither on its own.
 *
 * That is also why the first attempt at a second band produced nothing: **speculative revenue is
 * already the green band's ceiling**, so a "speculative band" built from the same function came back
 * byte-identical and the clamp collapsed it to zero height.
 *
 * The default is unchanged so every existing caller and test behaves exactly as before.
 */
export function confidenceBand(doc, horizon = HORIZON, revenue = null) {
  const financing = !!doc.settings?.toggles?.financing;   // orthogonal — shifts all curves, not part of the band
  const T = (committed, expected, speculative) => ({ committed, expected, speculative, financing });

  const baseModel = buildModelFromDoc(doc, horizon);

  // cost-variance factor from measured history
  const employees = doc.employees || [];
  const expectedBurn = employees.length
    ? employees.reduce((a, e) => a + (Number(e.amount) || 0) / 12, 0) : 0;   // rough expected monthly
  const cv = burnVariance(doc.history, expectedBurn, doc.flagOverrides || {}, doc.settings?.method || "trailing");

  // floor: conservative revenue (committed only) AND historical overspend (costs * 1+cv)
  const floorModel = scaleCosts(baseModel, cv);
  // WITH an explicit revenue set, all three curves share it and only the COSTS move.
  const floorToggles = revenue ? T(revenue.committed, revenue.expected, revenue.speculative)
                               : T(true, false, false);
  // expected: the base case — committed+expected revenue, costs as-is
  const expModel = baseModel;
  const expToggles = revenue ? T(revenue.committed, revenue.expected, revenue.speculative)
                             : T(true, true, false);
  // ceiling: optimistic revenue (+speculative) AND on-plan-or-better spend (costs * 1-cv)
  const ceilModel = scaleCosts(baseModel, -cv);
  const ceilToggles = revenue ? T(revenue.committed, revenue.expected, revenue.speculative)
                              : T(true, true, true);

  const floorRows = buildProjection(floorModel, floorToggles);
  const expRows = buildProjection(expModel, expToggles);
  const ceilRows = buildProjection(ceilModel, ceilToggles);

  const floorZero = zeroOf(floorModel, floorToggles);
  const expZero = zeroOf(expModel, expToggles);
  const ceilZero = zeroOf(ceilModel, ceilToggles);

  // how much of the spread is revenue vs cost — for the caption
  const revenueDriven = expZero != null && floorZero != null ? Math.abs(expZero - floorZero) : null;

  // band width classification (for the "you depend on uncertain revenue" callout)
  const finiteZeros = [floorZero, expZero, ceilZero].filter(z => z != null);
  const spread = finiteZeros.length >= 2 ? Math.max(...finiteZeros) - Math.min(...finiteZeros) : null;
  const wide = spread != null && expZero != null && spread > Math.max(2, expZero * 0.4);

  return {
    floor: { rows: floorRows, zero: floorZero, zeroNull: floorZero == null },
    expected: { rows: expRows, zero: expZero, zeroNull: expZero == null },
    ceiling: { rows: ceilRows, zero: ceilZero, zeroNull: ceilZero == null },
    burnCV: cv,
    spread,
    wide,
    revenueDriven,
  };
}
