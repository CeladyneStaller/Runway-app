// The canary. If this moves, the port changed behaviour — find out what before doing anything else.
// These numbers were verified against the artifact across many sessions; they are the contract.
import { describe, it, expect } from "vitest";
import { buildProjection, zeroInfo, dateShort, tagRevenue, HORIZON } from "../../src/engine";
import { seedModel, seedZero } from "../helpers";

const T = (spec, fin = false) => ({ committed: true, expected: true, speculative: spec, financing: fin });

describe("the seed company", () => {
  it("runs dry on Dec 20 2026 — committed + expected, no speculation, no financing", () => {
    const { zero: z } = seedZero(T(false));
    expect(z.months).toBeCloseTo(5.6, 1);
    expect(dateShort(z.date)).toBe("Dec 20, 26");
  });

  it("stretches to May 26 2027 on operating upside alone", () => {
    const { zero: z } = seedZero(T(true));
    expect(z.months).toBeCloseTo(10.9, 1);
    expect(dateShort(z.date)).toBe("May 26, 27");
  });

  it("never runs dry once financing is included", () => {
    expect(seedZero(T(true, true)).zero).toBeNull();
  });

  it("financing is orthogonal: it alone changes nothing, because every instrument is speculative", () => {
    expect(seedZero(T(false, true)).zero.t).toBe(seedZero(T(false, false)).zero.t);
  });
});

describe("projection invariants", () => {
  it("each month starts where the last one ended", () => {
    const rows = buildProjection(seedModel(), T(true, true));
    for (let m = 0; m < HORIZON; m++) expect(rows[m + 1].start).toBeCloseTo(rows[m].end, 6);
  });

  it("net is revenue less cost, every month", () => {
    for (const r of buildProjection(seedModel(), T(true, true))) expect(r.net).toBeCloseTo(r.rev - r.cost, 6);
  });

  it("untagged revenue cannot vanish (F1)", () => {
    const raw = [{ kind: "revenue", cadence: "onetime", amount: 9999, start: 0 }];
    const bare = buildProjection({ cashOnHand: 0, horizon: 1, lineItems: raw }, T(true));
    const tagged = buildProjection({ cashOnHand: 0, horizon: 1, lineItems: tagRevenue(raw) }, T(true));
    expect(bare[0].rev).toBe(0);        // this is the trap
    expect(tagged[0].rev).toBe(9999);   // this is why tagRevenue exists
  });
});
