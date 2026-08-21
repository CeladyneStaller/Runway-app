import { describe, it, expect } from "vitest";
import { confidenceBand, burnVariance } from "../../src/engine/band.js";
import { demoDoc, canaryDoc } from "../../src/state/document.js";
import { buildProjection, zeroInfo, anchorToActuals, forecastFrom } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { ARCHETYPES } from "../../src/state/archetypes.js";

const ALL = { committed: true, expected: true, speculative: true };

describe("⚠️ confidence band invariants", () => {
  it("NEVER INVERTS, even with negative speculative revenue", () => {
    // A planned repayment, refund or clawback makes the extra tier SUBTRACT, which put the ceiling
    // below the floor and rendered the polygon inside out. **The ordering is an invariant, not an
    // outcome of the arithmetic**, and it has to hold for input nobody anticipated.
    const base = demoDoc("grant-startup");
    const doc = { ...base, lines: [...(base.lines || []),
      { id: "x", kind: "revenue", confidence: "speculative", amount: -500000, start: 3, cadence: "once" }] };
    const b = confidenceBand(doc, undefined, ALL);
    for (let i = 0; i < b.floor.rows.length; i++) {
      expect(b.ceiling.rows[i].start, `month ${i}`).toBeGreaterThanOrEqual(b.floor.rows[i].start - 0.5);
    }
  });

  it("keeps the expected curve inside the band, for every archetype", () => {
    // The middle case must be bracketed by the two it sits between, or the band is not a bracket.
    for (const a of ARCHETYPES) {
      const b = confidenceBand(demoDoc(a.id), undefined, ALL);
      for (let i = 0; i < b.expected.rows.length; i++) {
        expect(b.expected.rows[i].start, `${a.id} month ${i}`)
          .toBeGreaterThanOrEqual(b.floor.rows[i].start - 0.5);
        expect(b.expected.rows[i].start, `${a.id} month ${i}`)
          .toBeLessThanOrEqual(b.ceiling.rows[i].start + 0.5);
      }
    }
  });

  it("⚠️ THE CALLER'S TOGGLES NARROW THE BAND, THEY DO NOT REPLACE IT", () => {
    // Passing a `revenue` argument once overwrote all three tiers with it, making floor, expected and
    // ceiling identical — **the band was flat by construction for every company.**
    const doc = demoDoc("grant-startup");
    const wide = confidenceBand(doc, undefined, ALL);
    const spread = (b) => Math.max(...b.floor.rows.map((r, i) => Math.abs(b.ceiling.rows[i].start - r.start)));
    expect(spread(wide)).toBeGreaterThan(0);

    // With speculative off the ceiling must not include speculative money.
    const narrow = confidenceBand(doc, undefined, { ...ALL, speculative: false });
    expect(spread(narrow)).toBeLessThan(spread(wide));
  });

  it("⚠️ ZEROS COME FROM THE ROWS IT RETURNS, not a second projection", () => {
    // This is the whole of flag 1. `zeroOf` used to call `buildProjection` AGAIN, so a band cost six
    // projections and discarded three — and the three it discarded were the only ones its dates saw.
    // The caller anchored the three it KEPT and drew those. Same document, two derivations: the tile
    // read 3.8 months above a "1.9 - 2.7" range, and on a past-start model "3.0" above "0.0 - 0.0".
    const doc = canaryDoc();
    const b = confidenceBand(doc, undefined, ALL,
      { cashActuals: doc.cashActuals, anchorActuals: true, from: forecastFrom(doc) });
    for (const curve of ["floor", "expected", "ceiling"]) {
      const direct = zeroInfo(b[curve].rows, doc.startY, doc.startM, forecastFrom(doc));
      // A curve that never crosses inside the horizon is a real answer, not a missing one — the
      // ceiling with every tier on usually stays solvent. Assert the two agree on THAT too.
      expect(b[curve].zeroNull, `${curve} zeroNull`).toBe(direct == null);
      if (direct) expect(b[curve].zeroFromNow, curve).toBeCloseTo(direct.fromNow, 9);
    }
  });

  it("⚠️ THE RANGE CONTAINS THE HEADLINE, on a model that started in the past", () => {
    // The shape that made this visible. A model started five months back with recorded actuals showed
    // "3.0 mo" above a range of "0.0 - 0.0", because the un-anchored crossing lay in the past and
    // `monthsFromNow` clamped to zero. Test it where it broke, not on a doc starting today.
    const now = new Date();
    const base = canaryDoc();
    const doc = { ...base, startY: now.getFullYear(), startM: now.getMonth() - 5,
      cashActuals: { 0: { cash: 560000 }, 1: { cash: 505000 }, 2: { cash: 441000 },
                     3: { cash: 372000 }, 4: { cash: 300000 }, 5: { cash: 245000 } } };
    const from = forecastFrom(doc);
    const opts = { cashActuals: doc.cashActuals, anchorActuals: true, from };
    const rows = anchorToActuals(buildProjection(buildModelFromDoc(doc), doc.settings.toggles),
      doc.cashActuals, true);
    const headline = zeroInfo(rows, doc.startY, doc.startM, from);
    const b = confidenceBand(doc, undefined, doc.settings.toggles, opts);
    expect(b.floor.zeroFromNow).toBeLessThanOrEqual(headline.fromNow + 1e-9);
    expect(b.ceiling.zeroFromNow).toBeGreaterThanOrEqual(headline.fromNow - 1e-9);
  });

  it("⚠️ THE UPSIDE BAND'S CLAMP SURVIVES ANCHORING", () => {
    // `RunwayChart` clamps the orange band's FLOOR up to the green band's CEILING, so two translucent
    // fills never overlap into a third colour that means nothing. That clamp is the ONE place two
    // independent `confidenceBand` calls get compared numerically — if one is anchored and the other
    // is not, it compares curves measured from different baselines and the polygon can invert.
    //
    // ⚠️ THE CANARY CANNOT CATCH A REGRESSION HERE. Its speculative revenue puts the orange ceiling
    // ~$2.1M above the green one, which swamps any anchoring offset. This asserts the invariant; it
    // does not prove the fixture is adversarial enough. A doc where the two bands run close together
    // is still wanted.
    const doc = canaryDoc();
    const opts = { cashActuals: doc.cashActuals, anchorActuals: true, from: forecastFrom(doc) };
    const green = confidenceBand(doc, undefined, { committed: true, expected: true, speculative: false }, opts);
    const orange = confidenceBand(doc, undefined, ALL, opts);
    green.floor.rows.forEach((_, m) => {
      const bottom = Math.max(green.ceiling.rows[m].start, orange.floor.rows[m].start);
      expect(orange.ceiling.rows[m].start, `month ${m}`).toBeGreaterThanOrEqual(bottom - 0.5);
    });
  });

  it("⚠️ RETURNS EXACTLY THESE FIELDS, so a new one cannot arrive without a reader", () => {
    // `revenueDriven` sat here computed on every call, read by nothing, and wrong — it named the
    // floor-to-expected gap "revenue" when that gap moves the cost multiplier too. Nothing failed,
    // because nothing looked.
    //
    // Pinning the shape makes adding a public field a DECISION rather than a drive-by: if this fails,
    // either wire the new field to a surface or do not return it. That is the whole guard.
    const b = confidenceBand(demoDoc("grant-startup"), undefined, ALL);
    expect(Object.keys(b).sort()).toEqual(
      ["burnCV", "ceiling", "expected", "floor", "hasRange", "spread", "wide"]);
    for (const c of ["floor", "expected", "ceiling"]) {
      expect(Object.keys(b[c]).sort(), c).toEqual(["rows", "zero", "zeroFromNow", "zeroNull"]);
    }
  });

  it("burn variance is bounded and refuses to guess from too few points", () => {
    const H = (a) => a.map(v => ({ v }));
    expect(burnVariance(H([100, 110]))).toBe(0);          // two months is not a distribution
    expect(burnVariance(H([100, 100, 100]))).toBe(0);     // no variance
    expect(burnVariance(H([0, 0, 0]))).toBe(0);           // mean zero, no division by it
    expect(burnVariance(H([-100, -110, -90]))).toBe(0);   // credits only
    expect(burnVariance(H([20, 300, 40, 280, 30, 290]))).toBeLessThanOrEqual(0.4);  // capped
  });
});
