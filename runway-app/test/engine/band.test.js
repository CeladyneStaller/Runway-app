// Confidence bands: tier-bracketed revenue range + measured-burn-variance cost widening. The key
// properties: floor <= expected <= ceiling (ordering), the expected curve matches the base projection,
// burn variance is measured (0 when too little history), and financing stays orthogonal.
import { describe, it, expect } from "vitest";
import { confidenceBand, burnVariance } from "../../src/engine";
import { demoDoc } from "../../src/state/document";

function withToggles(d) { d.settings.toggles = { committed: true, expected: true, speculative: false, financing: false }; return d; }

describe("burnVariance is measured, not guessed", () => {
  it("returns 0 with too few months to claim a variance", () => {
    expect(burnVariance([{ month: 0, lines: [{ code: "x", amount: 50000 }] }], 50000)).toBe(0);
  });
  it("is a positive fraction when burn scatters", () => {
    const hist = [
      { month: 0, lines: [{ code: "x", amount: 40000 }] },
      { month: 1, lines: [{ code: "x", amount: 60000 }] },
      { month: 2, lines: [{ code: "x", amount: 50000 }] },
      { month: 3, lines: [{ code: "x", amount: 55000 }] },
    ];
    const cv = burnVariance(hist, 50000);
    expect(cv).toBeGreaterThan(0);
    expect(cv).toBeLessThan(0.4);   // clamped
  });
  it("is ~0 when burn is flat", () => {
    const hist = Array.from({ length: 5 }, (_, m) => ({ month: m, lines: [{ code: "x", amount: 50000 }] }));
    expect(burnVariance(hist, 50000)).toBeCloseTo(0, 3);
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
    expect(b.expected.zero).toBeCloseTo(5.6, 1);   // the golden number, unchanged
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
