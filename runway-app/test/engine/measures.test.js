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
    // ⚠️ NAME THE DEAD ONES RATHER THAN COUNT THEM. A bare count says "four are flat" and leaves you
    // to find which — and the count needs bumping every time a measure is added, which is how a guard
    // becomes friction and then gets loosened.
    const dead = MEASURES.filter(m => m.get(rows, parts, d).every(x => x === 0)).map(m => m.id);
    // ⚠️ EXACTLY THE DEAD SET, WITH A REASON EACH — nothing more.
    //
    // The first version listed `capital` and `costShareAccrued`, and the run showed both are ALIVE on
    // the demo. **An allow-list entry for something that works is the "stops catching the fifth"
    // problem in miniature**: it silently forgives a future regression in the one measure it names.
    //
    //   saasRev          the demo seeds no subscription product
    //   baseline         measured burn does not exceed what the demo itemises, so there is no
    //                    unexplained spend — the baseline is genuinely nothing, not missing
    //   shortfall        the demo's non-grant inflow covers its cost share, so nothing is unmatchable
    //   debtOutstanding  no drawn facility and no maturing note
    //
    // `windDown` and `costShareAccrued` are deliberately NOT here: both read data the demo has, so a
    // zero in either would be a real fault.
    const allowed = ["saasRev", "baseline", "shortfall", "debtOutstanding"];
    expect(dead.filter(id => !allowed.includes(id)),
           `flat zero on the demo: ${dead.join(", ")}`).toEqual([]);
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
    // ⚠️ "line" SINGULAR — the invented name, still sitting in the test that exists to catch it.
    // Fixing a name in the source does not fix the assertions that were written alongside it.
    expect(t).toContain("lines");
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

describe("⚠️ every type name is one the renderer actually has", () => {
  const src = require("node:fs").readFileSync("src/views/chrome/Chart.jsx", "utf8");
  // The renderer dispatches `SHAPES[spec.kind]`. A name that is not a key returns undefined and the
  // chart draws NOTHING — no error, no crash, an empty frame.
  // `SHAPES` is declared across two lines, not as an indented block — a regex expecting one key per
  // line matched nothing and the guard passed vacuously. **A guard that silently matches nothing is
  // the thing it was written to prevent**, so it now asserts the table was found before using it.
  const table = /const SHAPES = \{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
  const known = [...table.matchAll(/(\w+)\s*:/g)].map(m => m[1]);

  it("FINDS THE TABLE AT ALL — a vacuous guard is worse than none", () => {
    expect(known.length).toBeGreaterThan(4);
  });

  it("KNOWS WHAT THE RENDERER KNOWS", () => {
    expect(known).toContain("lines");
    expect(known).toContain("bars");
    expect(known).toContain("stack");
  });

  it("⚠️ NAMES NO SHAPE THE RENDERER LACKS", () => {
    // I wrote "line" (singular — the renderer's is "lines") and "area", which does not exist at all.
    // Money out offered a Line button that produced an empty chart, and lint could not see it because
    // a missing key is not a syntax error.
    for (const m of MEASURES) {
      for (const t of m.allows) {
        expect(known, `${m.id} allows '${t}', which the renderer cannot draw`).toContain(t);
      }
    }
  });

  it("and allowedTypes never returns one either", () => {
    for (const ids of [["cost"], ["cost", "payroll"], ["end"], ["rev", "headcount"]]) {
      for (const t of allowedTypes(ids)) expect(known).toContain(t);
    }
  });
});

describe("⚠️ every tab with charts actually mounts the panel", () => {
  const fs = require("node:fs");

  it("MOUNTS `TabInsights` WHEREVER THE REGISTRY HAS CHARTS", () => {
    // Two commitments charts were registered, `chartsForTab("cmt")` returned both, and nothing rendered
    // — `Commitments.jsx` never mounted the panel. **A chart in the registry and nowhere on screen is
    // indistinguishable from one that was never written**, and only half of that is visible in
    // `charts.js`, which is why it looked finished.
    const VIEW = { dash: null, hist: "History", flow: null, sales: "Sales", pay: null,
                   proj: "Projects", ms: null, inv: null, cmt: "Commitments", scn: null };
    const src = fs.readFileSync("src/engine/charts.js", "utf8");
    const tabs = [...new Set([...src.matchAll(/tab: "(\w+)"/g)].map(m => m[1]))];
    for (const t of tabs) {
      const file = VIEW[t];
      if (!file) continue;                       // rendered from App or a shared shell
      const view = fs.readFileSync(`src/views/${file}.jsx`, "utf8");
      expect(view, `${file}.jsx has charts registered for "${t}" and never mounts TabInsights`)
        .toMatch(new RegExp(`<TabInsights tab="${t}"`));
    }
  });
});
