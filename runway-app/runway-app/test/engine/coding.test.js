import { describe, it, expect } from "vitest";
import { monthTotal, codesInLedger, unmappedCodes, codedActuals, overheadByMonth, effectiveActuals, OVERHEAD } from "../../src/engine";

const hist = [
  { month: 0, lines: [{ code: "5000", amount: 20000 }, { code: "6100", amount: 15000 }, { code: "", amount: 8000 }] },
  { month: 1, lines: [{ code: "5000", amount: 22000 }, { code: "OH", amount: 5000 }] },
];
const map = { "5000": "proj-cat", "6100": "proj-mobile", "OH": OVERHEAD };

describe("ledger totals", () => {
  it("a month's total is the sum of its lines", () => {
    expect(monthTotal(hist[0])).toBe(43000);
    expect(monthTotal(hist[1])).toBe(27000);
  });
  it("still reads a legacy {v} month", () => {
    expect(monthTotal({ v: 78000 })).toBe(78000);
  });
});

describe("code discovery", () => {
  it("lists distinct codes in first-seen order", () => {
    expect(codesInLedger(hist)).toEqual(["5000", "6100", "OH"]);
  });
  it("flags the ones the map doesn't cover", () => {
    expect(unmappedCodes(hist, { "5000": "x" })).toEqual(["6100", "OH"]);
    expect(unmappedCodes(hist, map)).toEqual([]);
  });
});

describe("coded spend flows to the mapped project", () => {
  it("sums only that project's coded lines, by month", () => {
    expect(codedActuals("proj-cat", hist, map)).toEqual({ 0: 20000, 1: 22000 });
    expect(codedActuals("proj-mobile", hist, map)).toEqual({ 0: 15000 });
  });
  it("uncoded and overhead-coded lines never reach a project", () => {
    const all = Object.values(codedActuals("proj-cat", hist, map)).reduce((a, v) => a + v, 0)
      + Object.values(codedActuals("proj-mobile", hist, map)).reduce((a, v) => a + v, 0);
    expect(all).toBe(57000);   // 43k + 27k = 70k total; 13k (8k uncoded + 5k OH) stays out
  });
});

describe("overhead stays in the baseline", () => {
  it("uncoded + overhead-coded = what remains company-wide", () => {
    expect(overheadByMonth(hist, map)).toEqual({ 0: 8000, 1: 5000 });
  });
  it("a fully-uncoded ledger leaves everything in overhead (baseline unchanged)", () => {
    const bare = [{ month: 0, lines: [{ amount: 50000 }] }];
    expect(overheadByMonth(bare, {})).toEqual({ 0: 50000 });
  });
});

describe("manual override", () => {
  const proj = { id: "proj-cat" };
  it("with no override, effective = coded", () => {
    const e = effectiveActuals(proj, hist, map);
    expect(e.overridden).toBe(false);
    expect(e.actuals).toEqual({ 0: 20000, 1: 22000 });
  });
  it("redistribution within a project (same total) is NOT flagged", () => {
    // coded is {0:20k, 1:22k} = 42k; move it to {0:21k, 1:21k} = 42k
    const p = { id: "proj-cat", actualsOverride: { 0: 21000, 1: 21000 } };
    const e = effectiveActuals(p, hist, map);
    expect(e.overridden).toBe(true);
    expect(e.flagged).toBe(false);
    expect(e.actuals).toEqual({ 0: 21000, 1: 21000 });
  });
  it("an override that changes the project total IS flagged", () => {
    const p = { id: "proj-cat", actualsOverride: { 0: 30000 } };   // was 20k coded in month 0
    const e = effectiveActuals(p, hist, map);
    expect(e.flagged).toBe(true);
    expect(e.delta).toBeCloseTo(10000, 0);   // 52k effective vs 42k coded
  });
});
