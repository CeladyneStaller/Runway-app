// Per-project projected-vs-actual series. Pure data layer for the "plot against reality" card charts.
// The key behaviours: projected runs the full horizon, actual stops where the books stop, and
// cumulative is a correct running sum of monthly.
import { describe, it, expect } from "vitest";
import { projectSeries } from "../../src/engine";

// an internal project: $10k/mo cost months 0-3, no projected revenue
const project = {
  id: "p1", type: "internal", budget: 40000,
  lines: [{ id: "l1", label: "Cost", cadence: "recurring", kind: "cost", amount: 10000, start: 0, end: 3 }],
};

describe("projected series", () => {
  it("expands recurring cost lines to monthly, across the full horizon", () => {
    const s = projectSeries(project, [], { codeMap: {}, customerMap: {} }, 5);
    expect(s.monthly.cost.projected.slice(0, 6)).toEqual([10000, 10000, 10000, 10000, 0, 0]);
    expect(s.months).toHaveLength(6);
  });
  it("has no revenue when the project projects none", () => {
    const s = projectSeries(project, [], {}, 5);
    expect(s.monthly.revenue.projected.every(v => v === 0)).toBe(true);
  });
});

describe("actual series stop where the books stop", () => {
  const hist = [
    { month: 0, lines: [{ code: "C", amount: 9000 }] },
    { month: 1, lines: [{ code: "C", amount: 11000 }] },
  ];
  const maps = { codeMap: { C: "p1" }, customerMap: {} };
  it("actualThrough is the last recorded month", () => {
    const s = projectSeries(project, hist, maps, 5);
    expect(s.actualThrough).toBe(1);
    expect(s.hasActuals).toBe(true);
  });
  it("actual cost matches the ledger for recorded months, zero after", () => {
    const s = projectSeries(project, hist, maps, 5);
    expect(s.monthly.cost.actual.slice(0, 4)).toEqual([9000, 11000, 0, 0]);
  });
  it("no actuals -> actualThrough -1, hasActuals false", () => {
    const s = projectSeries(project, [], maps, 5);
    expect(s.actualThrough).toBe(-1);
    expect(s.hasActuals).toBe(false);
  });
});

describe("net and cumulative", () => {
  const hist = [
    { month: 0, lines: [{ code: "C", amount: 8000 }, { code: "R", amount: 20000, kind: "revenue" }] },
    { month: 1, lines: [{ code: "C", amount: 8000 }] },
  ];
  const maps = { codeMap: { C: "p1", R: "p1" }, customerMap: {} };
  it("net = revenue - cost, monthly", () => {
    const s = projectSeries(project, hist, maps, 5);
    expect(s.monthly.net.actual[0]).toBe(12000);   // 20k rev - 8k cost
    expect(s.monthly.net.actual[1]).toBe(-8000);   // 0 rev - 8k cost
  });
  it("cumulative is the running sum of monthly", () => {
    const s = projectSeries(project, hist, maps, 5);
    expect(s.cumulative.cost.actual.slice(0, 3)).toEqual([8000, 16000, 16000]);
    expect(s.cumulative.net.actual.slice(0, 3)).toEqual([12000, 4000, 4000]);
  });
  it("cumulative projected cost tracks toward budget", () => {
    const s = projectSeries(project, [], maps, 5);
    // 10k/mo for 4 months = 40k cumulative by month 3, flat after
    expect(s.cumulative.cost.projected[3]).toBe(40000);
    expect(s.cumulative.cost.projected[5]).toBe(40000);
  });
});
