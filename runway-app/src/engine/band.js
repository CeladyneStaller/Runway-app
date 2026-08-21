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
import { buildProjection, zeroInfo, anchorToActuals, forecastFrom } from "./projection.js";
import { monthTotal } from "./coding.js";

// The coefficient of variation of measured monthly burn. IMPORTANT: this uses the RAW monthly totals,
// not burnStats' flag-filtered set. Flagging exists to stabilize the run-rate by excluding outliers —
// but variance is exactly the spread those outliers represent, so filtering them out would erase the
// very signal we want. We do drop the single most extreme month if there are enough points, so one
// freak month (a big one-time payment) doesn't dominate, but otherwise we keep the real scatter.
// Returns a fraction (0.12 = spend scatters ±12% around its mean). Zero when there isn't enough
// history to say anything — in which case the cost side adds no width, honestly.
//
// ⚠️ ONE PARAMETER, BECAUSE ONE IS ALL IT EVER READ. This took `expectedBurn`, `flagOverrides` and
// `method` and used none of them — they are `burnStats`' arguments, carried over when this was split
// out of it. Three dead parameters on an exported function are an INVITATION: the next reader assumes
// they do something, and the obvious "fix" is to wire them up.
//
// **Wiring them up would be the bug this function was already fixed for once.** `flagOverrides` and
// `method` exist to EXCLUDE outliers and stabilise a run-rate; the scatter they remove is exactly what
// is being measured here (see NOTES.md, "DESIGN BUG the tests caught"). Passing them in is not an
// improvement, it is the original defect returning through the signature.
export function burnVariance(hist) {
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

const zeroOf = (rows, startY, startM, from) => {
  // ⚠️ ROWS, NOT (model, toggles). This used to call `buildProjection` a SECOND time — so a band cost
  // six projections and threw three away, and the three it discarded were the only ones its zero dates
  // ever saw. `App.jsx` anchored the three it KEPT and drew those, leaving the dates measured against
  // curves nobody rendered. On the canary the tile read 3.8 months above a "1.9 – 2.7" range; on a
  // model started five months back it read 3.0 months above "0.0 – 0.0". Same document, two
  // derivations. One set of rows in, one set of dates out, and the seam cannot reopen.
  //
  // ⚠️ THE START DATE, WITHOUT WHICH `fromNow` CANNOT EXIST. `zeroInfo` derives it by turning the month
  // index into a real date and measuring from today — with no start it has no date to measure, so
  // `fromNow` came back undefined and fell back to `months`. **The tile showed 4.8 months and a
  // "5.4 – 5.4" range underneath: the same event, counted from two different days.**
  const z = zeroInfo(rows, startY, startM, from);
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
export function confidenceBand(doc, horizon = HORIZON, revenue = null, opts = {}) {
  // ⚠️ ANCHOR HERE, NOT IN THE CALLER. Every surface that draws this band was re-anchoring the rows on
  // its way to the screen while the zero dates stayed measured against the un-anchored originals. The
  // fix is not to anchor more carefully in more places — it is to leave exactly one place that can.
  //
  // `from` DEFAULTS TO THE CURRENT MONTH, because a crossing in a month already elapsed is not runway.
  // Zero was only ever defensible as test compatibility.
  // ⚠️ DEFAULTS COME FROM THE DOCUMENT NOW, NOT FROM `false`. `anchorActuals` defaulted OFF while every
  // caller passed it ON, which is a default that exists only to keep two test assertions still. That is
  // the shape of the bug this whole change set was about: a caller who forgets the options gets a band
  // measured against curves nobody draws. Recorded cash is a fact; agreeing with it is not opt-in.
  //
  // A caller can still force it off explicitly — `anchorActuals: false` — which is what a "pure model,
  // ignore the ledger" view would want.
  const {
    cashActuals = doc?.cashActuals || null,
    anchorActuals = doc?.settings?.anchorActuals !== false,
    from = forecastFrom(doc),
  } = opts;
  const anchor = (rs) => (anchorActuals && cashActuals) ? anchorToActuals(rs, cashActuals, true) : rs;
  const financing = !!doc.settings?.toggles?.financing;   // orthogonal — shifts all curves, not part of the band
  const T = (committed, expected, speculative) => ({ committed, expected, speculative, financing });

  const baseModel = buildModelFromDoc(doc, horizon);

  // cost-variance factor from measured history
  //
  // ⚠️ `expectedBurn` WENT WITH THE PARAMETER IT FED, and deleting it rather than keeping it around was
  // the point: it divided every salary by 12 without checking `e.basis`, so an hourly or monthly-basis
  // employee was twelfthed a second time, and it counted neither fringe nor raises. `empMonthlyOf` and
  // `empCostAt` in payroll.js are the resolution that gets those right, and this never used them.
  //
  // It never mattered because nothing read the result. **That is the argument for deleting it, not for
  // keeping it** — a wrong number nobody consumes is one refactor away from being a wrong number
  // somebody does.
  const cv = burnVariance(doc.history);

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

  const floorRows = anchor(buildProjection(floorModel, floorToggles));
  const expRows = anchor(buildProjection(expModel, expToggles));
  const ceilRowsRaw = anchor(buildProjection(ceilModel, ceilToggles));

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

  const floorZero = zeroOf(floorRows, doc.startY, doc.startM, from);
  const expZero = zeroOf(expRows, doc.startY, doc.startM, from);
  const ceilZero = zeroOf(ceilRows, doc.startY, doc.startM, from);

  // ⚠️ `revenueDriven` WAS HERE AND IS GONE. It reported `|expZero − floorZero|` as "how much of the
  // spread is revenue rather than cost" — but floor differs from expected in BOTH the revenue tier AND
  // the cost multiplier, so it measured the two together and named one of them. On the canary it read
  // 0.350 months, which is exactly 0.215 of revenue plus 0.135 of cost.
  //
  // NOT REPAIRED, BECAUSE MONTHS CANNOT CARRY IT. An exact decomposition exists and is PATH DEPENDENT.
  // On the canary with all three tiers on (spread 5.42): peel revenue first and it is 0.19 revenue +
  // 5.23 cost; peel cost first and it is 0.29 cost + 5.13 revenue. Revenue is 3% or 95% of the SAME
  // range depending only on the order you peel it in, because runway is a FIRST CROSSING and a shallow
  // trough moves the date discontinuously. A Shapley average (2.66 / 2.76) describes neither world —
  // the false precision this module's header refuses.
  //
  // **THE HONEST ATTRIBUTION IS IN DOLLARS**, where the balance is linear in both inputs, so it is
  // exact and path-independent — and derivable from the rows above with no extra projection:
  //
  //     width(m) = Σ(ceil.rev − floor.rev)  +  Σ(floor.cost − ceil.cost)
  //
  // ⚠️ AND THE SUM STARTS AT THE LAST RECORDED ACTUAL, NOT AT MONTH 0. `anchorToActuals` gives each
  // curve its OWN offset — the floor sits lower at the last actual, so it takes the larger shift — and
  // it rewrites only `start`/`end`/`net`, leaving `rev` and `cost` holding raw flows. Summed from month
  // 0 the identity therefore reconstructs the RAW width, not the drawn one, and misses by a constant
  // (the raw width at the last actual: $158,168 on the canary) at every month. From the last actual
  // forward it is exact to the cent, which is also the only range where it MEANS anything: the band has
  // zero width across recorded months because all three curves are pinned to the same recorded cash.
  //
  // So the helper needs the anchor month, not just the band: `bandParts(band, fromMonth)`. That is a
  // dependency on `cashActuals` this function does not take — the same one the zero-date fix needs —
  // so build it with that change, not before it, and only once a surface actually reads it. A field
  // with no reader is what let this one stay wrong.

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
  };
}
