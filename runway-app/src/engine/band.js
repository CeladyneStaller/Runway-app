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

const zeroOf = (model, toggles, startY, startM) => {
  // ⚠️ THE START DATE, WITHOUT WHICH `fromNow` CANNOT EXIST. `zeroInfo` derives it by turning the month
  // index into a real date and measuring from today — with no start it has no date to measure, so
  // `fromNow` came back undefined and fell back to `months`. **The tile showed 4.8 months and a
  // "5.4 – 5.4" range underneath: the same event, counted from two different days.**
  const z = zeroInfo(buildProjection(model, toggles), startY, startM);
  // ⚠️ BOTH, BECAUSE THEY MEASURE FROM DIFFERENT ORIGINS. `months` counts from the projection start;
  // `fromNow` counts from today. The runway tile shows `fromNow` in its headline and was showing
  // `months` in its range, so **the range did not contain the number above it** — which reads as an
  // error and, for a model whose start is months in the past, is one.
  //
  // `zeroInfo`'s own comment says "`fromNow` is what a person should be shown". This function dropped
  // it, so no consumer could show it even if it wanted to.
  return z ? { months: z.months, fromNow: z.fromNow ?? z.months } : null;
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
  // ⚠️ `revenue` NARROWS THE BAND, IT DOES NOT REPLACE IT. This used the caller's toggles for ALL
  // THREE tiers, so floor, expected and ceiling became the same curve and **the band had zero width by
  // construction — for every company, regardless of how uncertain its income was.**
  //
  // The argument exists so a chart showing only committed revenue does not draw a ceiling from money
  // the reader has switched off. That means INTERSECTING each tier with what the caller allows, not
  // overwriting the tier with it.
  const allow = (c, e, sp) => T(c && (revenue ? !!revenue.committed : true),
                                e && (revenue ? !!revenue.expected : true),
                                sp && (revenue ? !!revenue.speculative : true));
  const floorToggles = allow(true, false, false);
  // expected: the base case — committed+expected revenue, costs as-is
  const expModel = baseModel;
  const expToggles = allow(true, true, false);
  // ceiling: optimistic revenue (+speculative) AND on-plan-or-better spend (costs * 1-cv)
  const ceilModel = scaleCosts(baseModel, -cv);
  const ceilToggles = allow(true, true, true);

  const floorRows = buildProjection(floorModel, floorToggles);
  const expRows = buildProjection(expModel, expToggles);
  const ceilRowsRaw = buildProjection(ceilModel, ceilToggles);

  // ⚠️ THE ORDERING IS AN INVARIANT, NOT AN OUTCOME. Each tier adds revenue, so the ceiling is normally
  // above the floor — **but a NEGATIVE speculative line (a planned repayment, refund or clawback) makes
  // the extra tier subtract**, and the ceiling drops below the floor. The polygon then inverts and the
  // band renders inside out, which reads as a rendering fault rather than a data one.
  //
  // Clamping here rather than rejecting the line: a planned repayment is legitimate to model, and the
  // right presentation is a band of zero width at that month — **"this money is uncertain and it does
  // not help you" is true and drawable.** The alternative is a chart that lies about which curve is
  // which.
  const ceilRows = ceilRowsRaw.map((r, i) => (r.start < floorRows[i].start
    ? { ...r, start: floorRows[i].start, end: Math.max(r.end, floorRows[i].end) }
    : r));

  const floorZero = zeroOf(floorModel, floorToggles, doc.startY, doc.startM);
  const expZero = zeroOf(expModel, expToggles, doc.startY, doc.startM);
  const ceilZero = zeroOf(ceilModel, ceilToggles, doc.startY, doc.startM);

  // how much of the spread is revenue vs cost — for the caption
  // ⚠️ A FOURTH READER, found only by grepping for the variable rather than by reading the diff.
  // `Math.abs(object - object)` is NaN, silently — the caption that explains how much of the spread is
  // revenue rather than cost has been meaningless since the change.
  const revenueDriven = expZero != null && floorZero != null
    ? Math.abs(expZero.months - floorZero.months) : null;

  // band width classification (for the "you depend on uncertain revenue" callout)
  // ⚠️ `.months`, BECAUSE `zeroOf` RETURNS AN OBJECT NOW. I changed it to `{ months, fromNow }` and
  // updated the three tier consumers below — **and missed these three, which do arithmetic on it.**
  // `Math.max` over objects gives NaN, so `spread` was NaN and the "wide band" callout silently never
  // fired.
  //
  // The same "a reader I did not update" shape NOTES.md records five times already; the difference is
  // that a test caught this one, because it asserts a numeric property rather than a rendered string.
  const finiteZeros = [floorZero, expZero, ceilZero].filter(z => z != null).map(z => z.months);
  const spread = finiteZeros.length >= 2 ? Math.max(...finiteZeros) - Math.min(...finiteZeros) : null;
  const wide = spread != null && expZero != null && spread > Math.max(2, expZero.months * 0.4);

  return {
    // ⚠️ WHETHER THERE IS A RANGE AT ALL, computed once here rather than inferred by each surface.
    // **A zero-width band and a switched-off band look identical — both are nothing** — and that
    // ambiguity cost a long debugging session with the code in front of us.
    //
    // Zero width means every input is committed: no prospective project, no line below full
    // confidence, no burn history to vary. That is a finding about the model, not an absence.
    hasRange: floorRows.some((r, i) => Math.abs(ceilRows[i].start - r.start) > 1),
    floor: { rows: floorRows, zero: floorZero?.months ?? null, zeroFromNow: floorZero?.fromNow ?? null, zeroNull: floorZero == null },
    expected: { rows: expRows, zero: expZero?.months ?? null, zeroFromNow: expZero?.fromNow ?? null, zeroNull: expZero == null },
    ceiling: { rows: ceilRows, zero: ceilZero?.months ?? null, zeroFromNow: ceilZero?.fromNow ?? null, zeroNull: ceilZero == null },
    burnCV: cv,
    spread,
    wide,
    revenueDriven,
  };
}
