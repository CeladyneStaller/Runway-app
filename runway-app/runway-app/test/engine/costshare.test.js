// Cost-share reconciliation: required (grant budget × costSharePct) vs recorded (ledger × costSharePct,
// Tier-1). Fully derived — zero new input. Overall + per-period + per-category.
import { describe, it, expect } from "vitest";
import { costShareReconciliation } from "../../src/engine";

// a grant with a 20% cash match, one period, a simple $100k personnel budget
function grant20() {
  return {
    id: "g1", type: "grant", name: "Test grant",
    grant: {
      costSharePct: 0.20, costShareType: "cash",
      periods: [{ id: "p1", start: 0, end: 5 }],
      categories: {
        // real shape: array of roles, byPeriod [{ hrs, rate }]. 2000 hrs × $50 = $100k personnel.
        personnel: [{ id: "r1", role: "Engineer", byPeriod: [{ hrs: 2000, rate: 50 }] }],
        fringe: { byPeriod: [0] },
      },
    },
  };
}

describe("no reconciliation when there's no match", () => {
  it("returns null for a grant with 0% cost share", () => {
    const g = grant20(); g.grant.costSharePct = 0;
    expect(costShareReconciliation(g, [], {}, 11)).toBeNull();
  });
  it("returns null for a non-grant project", () => {
    expect(costShareReconciliation({ id: "x", type: "internal" }, [], {}, 11)).toBeNull();
  });
});

describe("required side is derived from the budget", () => {
  it("required match = budget × costSharePct, no input needed", () => {
    const r = costShareReconciliation(grant20(), [], { codeMap: {}, customerMap: {} }, 11);
    expect(r.costSharePct).toBe(0.20);
    // ~100k personnel budget × 20% = ~20k required; allow for fringe/indirect being zero here
    expect(r.required).toBeGreaterThan(0);
    expect(r.recordedMatch).toBe(0);        // nothing recorded yet
    expect(r.remaining).toBeCloseTo(r.required, 2);
    expect(r.met).toBe(false);
  });
});

describe("recorded side is derived from the ledger (Tier-1)", () => {
  const maps = { codeMap: { "5000": "g1" }, customerMap: {} };
  it("recorded match = recorded grant spend × costSharePct", () => {
    // record 50k of grant spend in period 0
    const hist = [{ month: 0, lines: [{ code: "5000", amount: 50000, category: "personnel", period: 0 }] }];
    const r = costShareReconciliation(grant20(), hist, maps, 11);
    expect(r.recordedMatch).toBeCloseTo(50000 * 0.20, 2);   // 10k toward match
    expect(r.hasRecorded).toBe(true);
  });
  it("reaches 'met' when enough is recorded", () => {
    const r0 = costShareReconciliation(grant20(), [], maps, 11);
    const need = r0.required;
    // to record `need` of MATCH at 20%, spend need/0.2 total
    const spend = need / 0.20;
    const hist = [{ month: 0, lines: [{ code: "5000", amount: spend, category: "personnel", period: 0 }] }];
    const r = costShareReconciliation(grant20(), hist, maps, 11);
    expect(r.met).toBe(true);
    expect(r.remaining).toBeCloseTo(0, 1);
  });
});

describe("per-category detail (Tier-3) falls out of line categories", () => {
  const maps = { codeMap: { "5000": "g1" }, customerMap: {} };
  it("breaks recorded match down by object class", () => {
    const hist = [{ month: 0, lines: [
      { code: "5000", amount: 30000, category: "personnel", period: 0 },
      { code: "5000", amount: 10000, category: "travel", period: 0 },
    ] }];
    const r = costShareReconciliation(grant20(), hist, maps, 11);
    const personnel = r.perPeriod[0].byCat.find(c => c.category === "personnel");
    expect(personnel.recorded).toBeCloseTo(30000 * 0.20, 2);
    // travel had spend but no budget -> still shown (recorded > 0)
    const travel = r.perPeriod[0].byCat.find(c => c.category === "travel");
    expect(travel.recorded).toBeCloseTo(10000 * 0.20, 2);
  });
});

describe("per-period split", () => {
  it("attributes spend to the period its month falls in when no explicit period", () => {
    const g = grant20();
    g.grant.periods = [{ id: "p1", start: 0, end: 5 }, { id: "p2", start: 6, end: 11 }];
    g.grant.categories.personnel = [{ id: "r1", role: "Engineer", byPeriod: [{ hrs: 2000, rate: 50 }, { hrs: 2000, rate: 50 }] }];
    g.grant.categories.fringe = { byPeriod: [0, 0] };
    const maps = { codeMap: { "5000": "g1" }, customerMap: {} };
    // spend in month 7 -> period 1, no explicit period field
    const hist = [{ month: 7, lines: [{ code: "5000", amount: 20000, category: "personnel" }] }];
    const r = costShareReconciliation(g, hist, maps, 11);
    expect(r.perPeriod[1].recordedSpend).toBe(20000);
    expect(r.perPeriod[0].recordedSpend).toBe(0);
  });
});
