import { describe, it, expect } from "vitest";
import { confidenceBand, burnVariance } from "../../src/engine/band.js";
import { demoDoc } from "../../src/state/document.js";
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

  it("burn variance is bounded and refuses to guess from too few points", () => {
    const H = (a) => a.map(v => ({ v }));
    expect(burnVariance(H([100, 110]), 100)).toBe(0);          // two months is not a distribution
    expect(burnVariance(H([100, 100, 100]), 100)).toBe(0);     // no variance
    expect(burnVariance(H([0, 0, 0]), 100)).toBe(0);           // mean zero, no division by it
    expect(burnVariance(H([-100, -110, -90]), 100)).toBe(0);   // credits only
    expect(burnVariance(H([20, 300, 40, 280, 30, 290]), 100)).toBeLessThanOrEqual(0.4);  // capped
  });
});
