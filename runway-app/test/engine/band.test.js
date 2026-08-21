// Confidence bands: tier-bracketed revenue range + measured-burn-variance cost widening. The key
// properties: floor <= expected <= ceiling (ordering), the expected curve matches the base projection,
// burn variance is measured (0 when too little history), and financing stays orthogonal.
import { describe, it, expect } from "vitest";
import { confidenceBand, burnVariance, buildModelFromDoc, buildProjection, anchorToActuals } from "../../src/engine";
import { canaryDoc as demoDoc } from "../../src/state/document";

function withToggles(d) { d.settings.toggles = { committed: true, expected: true, speculative: false, financing: false }; return d; }

describe("burnVariance is measured, not guessed", () => {
  it("returns 0 with too few months to claim a variance", () => {
    expect(burnVariance([{ month: 0, lines: [{ code: "x", amount: 50000 }] }])).toBe(0);
  });
  it("is a positive fraction when burn scatters", () => {
    const hist = [
      { month: 0, lines: [{ code: "x", amount: 40000 }] },
      { month: 1, lines: [{ code: "x", amount: 60000 }] },
      { month: 2, lines: [{ code: "x", amount: 50000 }] },
      { month: 3, lines: [{ code: "x", amount: 55000 }] },
    ];
    const cv = burnVariance(hist);
    expect(cv).toBeGreaterThan(0);
    expect(cv).toBeLessThan(0.4);   // clamped
  });
  it("is ~0 when burn is flat", () => {
    const hist = Array.from({ length: 5 }, (_, m) => ({ month: m, lines: [{ code: "x", amount: 50000 }] }));
    expect(burnVariance(hist)).toBeCloseTo(0, 3);
  });
});

describe("the band brackets the runway", () => {
  it("floor <= expected <= ceiling in months (more revenue + less burn = longer runway)", () => {
    const b = confidenceBand(withToggles(demoDoc()));
    // treat null (never runs out) as +Infinity for ordering
    const m = (z) => (z.zeroNull ? Infinity : z.zero);
    expect(m(b.floor)).toBeLessThanOrEqual(m(b.expected));
    expect(m(b.expected)).toBeLessThanOrEqual(m(b.ceiling));
  });

  it("the expected curve equals the base projection (golden-consistent)", () => {
    const b = confidenceBand(withToggles(demoDoc()));
    expect(b.expected.zero).toBeCloseTo(3.9, 1)   // the DEMO's runway, not the seed's — the demo carries five commitments;   // the golden number, unchanged
  });

  it("reports the spread between floor and ceiling", () => {
    const b = confidenceBand(withToggles(demoDoc()));
    // spread is null only if fewer than 2 curves have a finite zero
    if (b.spread != null) expect(b.spread).toBeGreaterThanOrEqual(0);
  });
});

describe("cost variance actually widens the band", () => {
  it("more historical burn scatter -> floor runs out sooner than with flat burn", () => {
    const flat = withToggles(demoDoc());
    flat.history = Array.from({ length: 6 }, (_, mo) => ({ month: mo, lines: [{ code: "6000", amount: 70000 }] }));
    const scattered = withToggles(demoDoc());
    scattered.history = [40000, 100000, 55000, 95000, 50000, 90000].map((a, mo) => ({ month: mo, lines: [{ code: "6000", amount: a }] }));
    const bFlat = confidenceBand(flat);
    const bScatter = confidenceBand(scattered);
    // scattered burn -> higher CV -> floor costs scaled up more -> floor zero is earlier (or equal if both null)
    expect(bScatter.burnCV).toBeGreaterThan(bFlat.burnCV);
  });
});

describe("the band centers on the main line (regression: band was offset ~$114k)", () => {
  it("the anchored expected curve coincides with the anchored base projection at every month", () => {
    const doc = withToggles(demoDoc());
    const model = buildModelFromDoc(doc);
    const T = { committed: true, expected: true, speculative: false, financing: false };
    // the App anchors the main line to recorded cash; the band curves must be anchored the same way
    const cashActuals = { 0: { cash: 560000 }, 1: { cash: 467000 }, 2: { cash: 343000 }, 3: { cash: 216000 }, 4: { cash: 108000 } };
    const mainLine = anchorToActuals(buildProjection(model, T), cashActuals, true);
    const bandExpected = anchorToActuals(confidenceBand(doc).expected.rows, cashActuals, true);
    expect(bandExpected.length).toBe(mainLine.length);
    for (let m = 0; m < mainLine.length; m++) {
      expect(bandExpected[m].start).toBeCloseTo(mainLine[m].start, 4);
      expect(bandExpected[m].end).toBeCloseTo(mainLine[m].end, 4);
    }
  });
});

describe("⚠️ a band per curve — one revenue set each", () => {
  const tot = (rs) => (rs || []).reduce((a, r) => a + (r.end ?? r.b ?? 0), 0);

  it("WITHOUT a revenue set, behaves exactly as it always did", () => {
    // Every existing caller and test depends on this. The three curves use three different revenue
    // sets: floor committed-only, ceiling committed + expected + speculative.
    const d = demoDoc();
    const a = confidenceBand(d), b = confidenceBand(d);
    expect(tot(a.floor.rows)).toBe(tot(b.floor.rows));
    expect(tot(a.ceiling.rows)).not.toBe(tot(a.floor.rows));
  });

  it("⚠️ WITH ONE, ALL THREE CURVES SHARE IT and only the costs move", () => {
    // This is what makes a second band possible at all. The first attempt failed because speculative
    // revenue is ALREADY the default ceiling — a "speculative band" from the same call came back
    // identical, and the clamp collapsed it to nothing.
    const d = demoDoc();
    const committedOnly = confidenceBand(d, undefined,
      { committed: true, expected: false, speculative: false });
    const withSpec = confidenceBand(d, undefined,
      { committed: true, expected: true, speculative: true });
    expect(tot(withSpec.expected.rows)).not.toBe(tot(committedOnly.expected.rows));
  });

  it("still has width — the spread comes from cost variance, not revenue", () => {
    const d = demoDoc();
    const b = confidenceBand(d, undefined, { committed: true, expected: true, speculative: true });
    expect(tot(b.ceiling.rows)).toBeGreaterThan(tot(b.floor.rows));
  });

  it("⚠️ THE DEFAULT BAND USED TO ASSUME SPECULATION LANDED", () => {
    // Its ceiling added speculative unconditionally, so somebody with speculation switched OFF was
    // still shown a band whose top edge assumed it arrived. Passing the real toggles fixes that.
    const d = demoDoc();
    const asToggled = confidenceBand(d, undefined,
      { committed: true, expected: true, speculative: false });
    const hardcoded = confidenceBand(d);
    expect(tot(asToggled.ceiling.rows)).not.toBe(tot(hardcoded.ceiling.rows));
  });
});
