import { describe, it, expect } from "vitest";
import { MEASURES, measuresFor, measureById, overlaps, unitsOf, allowedTypes } from "../../src/engine/measures.js";
import { DIMENSIONS, dimensionsFor, splitBy, tooManySeries, SERIES_LIMIT } from "../../src/engine/dimensions.js";
import { demoDoc } from "../../src/state/document.js";
import { buildModelParts, buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { buildProjection } from "../../src/engine/projection.js";

const doc = () => demoDoc();
const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});

describe("⚠️ every measure reads something real", () => {
  it("RETURNS A NUMBER PER MONTH, never undefined or NaN", () => {
    // The scenario registry taught this: five field keys were written from what the UI SHOWS rather
    // than what the model HOLDS. Here the failure is quieter — a measure that reads nothing returns a
    // flat zero line, which looks like a true answer about a company with no spend.
    const d = doc(), parts = buildModelParts(d), rows = rowsOf(d);
    for (const m of MEASURES) {
      const v = m.get(rows, parts, d);
      expect(Array.isArray(v), `${m.id} did not return an array`).toBe(true);
      expect(v.length, `${m.id} returned the wrong length`).toBe(rows.length);
      for (const x of v) expect(Number.isFinite(x), `${m.id} produced ${x}`).toBe(true);
    }
  });

  it("⚠️ IS NOT FLAT ZERO where the demo has data", () => {
    // The specific shape of an invented key: no error, no crash, a line along the axis.
    const d = doc(), parts = buildModelParts(d), rows = rowsOf(d);
    const alive = MEASURES.filter(m => m.get(rows, parts, d).some(x => x !== 0));
    expect(alive.length).toBeGreaterThanOrEqual(MEASURES.length - 2);   // saas/capital may be empty
  });

  it("declares a unit and at least one allowed type", () => {
    for (const m of MEASURES) {
      expect(["money", "people"], `${m.id}`).toContain(m.unit);
      expect(m.allows.length, `${m.id}`).toBeGreaterThan(0);
    }
  });

  it("⚠️ NAMES ONLY REAL MEASURES IN `contains` — this caught one on its first run", () => {
    // `cost` listed `costshare`, which is not a measure. A containment pointing at nothing silently
    // stops warning about a real overlap AND reads as coverage, which is worse than having neither.
    for (const m of MEASURES) {
      for (const c of m.contains || []) {
        expect(measureById(c), `${m.id} contains unknown '${c}'`).toBeTruthy();
      }
    }
  });
});

describe("overlaps", () => {
  it("⚠️ CATCHES net AGAINST ITS OWN PARTS", () => {
    // net is rev minus cost — all three on one chart double-counts every dollar.
    const o = overlaps(["net", "rev", "cost"]);
    expect(o.length).toBe(2);
  });

  it("catches a subset of inflow", () => {
    expect(overlaps(["rev", "inNonGrant"])).toHaveLength(1);
  });

  it("catches payroll inside money out", () => {
    expect(overlaps(["cost", "payroll"])).toHaveLength(1);
  });

  it("says nothing about measures that do not overlap", () => {
    expect(overlaps(["rev", "headcount"])).toEqual([]);
  });
});

describe("what can be drawn", () => {
  it("⚠️ REFUSES STACKING WHEN MEASURES OVERLAP — and only stacking", () => {
    // A stack ASSERTS that the parts sum to the whole. "Money out, and how much of it is payroll" is a
    // legitimate chart; stacking those two is a false statement.
    const t = allowedTypes(["cost", "payroll"]);
    expect(t).not.toContain("stack");
    expect(t).toContain("line");
    expect(t).toContain("bars");
  });

  it("allows stacking when nothing overlaps", () => {
    expect(allowedTypes(["payroll", "opex"])).toContain("stack");
  });

  it("A BALANCE CANNOT BE STACKED OR FILLED", () => {
    // Balances are a position, not a flow — they do not sum, and area under one implies an
    // accumulation that has already accumulated.
    expect(measureById("end").allows).not.toContain("stack");
    expect(measureById("end").allows).not.toContain("area");
  });

  it("reports the units in a selection, so two axes or a refusal can follow", () => {
    expect(unitsOf(["rev", "cost"])).toEqual(["money"]);
    expect(unitsOf(["rev", "headcount"]).sort()).toEqual(["money", "people"]);
  });
});

describe("dimensions", () => {
  it("offers only what the tab can group by", () => {
    expect(dimensionsFor("pay").map(d => d.id)).toContain("employee");
    expect(dimensionsFor("pay").map(d => d.id)).not.toContain("customer");
  });

  it("⚠️ EMITS 'Unassigned' AND NEVER HIDES IT", () => {
    // Spend belonging to no project is usually the most interesting series; dropping it would make the
    // others sum to less than the total.
    const lines = [{ amount: 100, start: 0, projectId: "p1" }, { amount: 40, start: 0 }];
    const out = splitBy(DIMENSIONS.find(d => d.id === "project"), lines, 3, doc());
    expect(out.some(s => s.unassigned)).toBe(true);
    expect(out[out.length - 1].unassigned).toBe(true);      // sorted last
  });

  it("sorts the rest biggest first, to match how a stack reads", () => {
    const lines = [{ amount: 10, start: 0, projectId: "a" }, { amount: 90, start: 0, projectId: "b" }];
    const out = splitBy(DIMENSIONS.find(d => d.id === "project"), lines, 2, doc());
    expect(out[0].total).toBeGreaterThan(out[1].total);
  });

  it("⚠️ LIMITS ON THE RESULT, not on the number of dropdowns", () => {
    // Three measures by eight codes is twenty-four series — a chart nobody can read, produced by two
    // reasonable choices. Two measures against a small dimension is fine.
    expect(tooManySeries(3, 8)).toBe(true);
    expect(tooManySeries(2, 4)).toBe(false);
    expect(SERIES_LIMIT).toBe(12);
  });

  it("a onetime line lands in one month, not spread across the window", () => {
    const out = splitBy(DIMENSIONS.find(d => d.id === "project"),
                        [{ amount: 500, start: 2, cadence: "onetime", projectId: "p" }], 5, doc());
    expect(out[0].values).toEqual([0, 0, 500, 0, 0]);
  });
});
