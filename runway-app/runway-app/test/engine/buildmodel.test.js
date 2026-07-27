// buildModelFromDoc must reproduce App's base projection exactly — otherwise scenarios compare against
// a wrong base. The golden number is the proof: build the demo model from the doc, run the projection,
// and it must hit 5.6mo, the same as App's inline assembly.
import { describe, it, expect } from "vitest";
import { buildModelFromDoc, buildProjection, zeroInfo } from "../../src/engine";
import { demoDoc } from "../../src/state/document";

describe("buildModelFromDoc reproduces the base pipeline", () => {
  it("the demo doc yields the golden runway (5.6mo)", () => {
    const doc = demoDoc();
    // match the golden toggle set
    doc.settings.toggles = { committed: true, expected: true, speculative: false, financing: false };
    const model = buildModelFromDoc(doc);
    const rows = buildProjection(model, doc.settings.toggles);
    const z = zeroInfo(rows);
    expect(z.months).toBeCloseTo(5.6, 1);
  });

  it("responds to a cash change the way a scenario would", () => {
    const doc = demoDoc();
    doc.settings.toggles = { committed: true, expected: true, speculative: false, financing: false };
    const base = zeroInfo(buildProjection(buildModelFromDoc(doc), doc.settings.toggles));
    expect(base.months).toBeCloseTo(5.6, 1);   // finite base runway
    // LESS cash -> shorter runway (raising can go cash-positive/null, so lower to keep it finite)
    const leaner = { ...doc, cash: doc.cash - 200000 };
    const z2 = zeroInfo(buildProjection(buildModelFromDoc(leaner), leaner.settings.toggles));
    expect(z2.months).toBeLessThan(base.months);
  });
});
