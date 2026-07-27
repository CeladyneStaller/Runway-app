// Piece 1: ledger lines gained kind/category/period. The load-bearing guarantees: a line with no kind
// is cost (so nothing pre-v3 changes), and a revenue line is money IN — it must never subtract from
// spend or the measured-burn baseline. These pin the schema change against silent corruption.
import { describe, it, expect } from "vitest";
import { monthTotal, monthRevenue, codedActuals, codedRevenue, overheadByMonth,
         lineKind, isCost, isRevenue, lineCategory, linePeriod, OVERHEAD } from "../../src/engine";

describe("a line's kind defaults to cost", () => {
  it("no kind => cost, so pre-v3 lines are unchanged", () => {
    expect(lineKind({ code: "x", amount: 100 })).toBe("cost");
    expect(isCost({ amount: 100 })).toBe(true);
    expect(isRevenue({ amount: 100 })).toBe(false);
  });
  it("explicit revenue is revenue", () => {
    expect(lineKind({ amount: 100, kind: "revenue" })).toBe("revenue");
    expect(isRevenue({ amount: 100, kind: "revenue" })).toBe(true);
  });
  it("reads category and period when present, null otherwise", () => {
    expect(lineCategory({ category: "personnel" })).toBe("personnel");
    expect(lineCategory({})).toBeNull();
    expect(linePeriod({ period: 1 })).toBe(1);
    expect(linePeriod({})).toBeNull();
  });
});

describe("revenue must not pollute spend", () => {
  const mixed = { month: 0, lines: [
    { code: "5000", amount: 20000 },                      // cost (default)
    { code: "5000", amount: 50000, kind: "revenue" },     // a payment received on the same project
    { code: "", amount: 8000 },                           // uncoded cost -> overhead
  ] };
  const map = { "5000": "proj-a" };

  it("monthTotal counts cost only", () => {
    expect(monthTotal(mixed)).toBe(28000);               // 20k + 8k, NOT the 50k revenue
  });
  it("monthRevenue counts revenue only", () => {
    expect(monthRevenue(mixed)).toBe(50000);
  });
  it("codedActuals (project spend) excludes the revenue line", () => {
    expect(codedActuals("proj-a", [mixed], map)).toEqual({ 0: 20000 });
  });
  it("codedRevenue captures it separately", () => {
    expect(codedRevenue("proj-a", [mixed], map)).toEqual({ 0: 50000 });
  });
  it("overhead baseline is cost-only too", () => {
    expect(overheadByMonth([mixed], map)).toEqual({ 0: 8000 });
  });
});

describe("a legacy all-cost ledger is byte-identical under the new engine", () => {
  it("totals match what they were before kind existed", () => {
    const legacy = [{ month: 0, lines: [{ code: "a", amount: 100 }, { code: "b", amount: 200 }] }];
    expect(monthTotal(legacy[0])).toBe(300);
    expect(monthRevenue(legacy[0])).toBe(0);
  });
});
