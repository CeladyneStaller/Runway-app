import { describe, it, expect } from "vitest";
import { overheadHeadroom, overheadAdjustment } from "../../src/engine/factors.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { canaryDoc as demoDoc } from "../../src/state/document.js";

const run = (d) => zeroInfo(buildProjection(buildModelFromDoc(d), d.settings?.toggles || {}),
                            d.startY, d.startM)?.months;
const withCut = (d, amount) => ({ ...d, lines: [...(d.lines || []),
  { id: "adj", label: "Overhead reduction", cadence: "recurring", kind: "cost",
    amount, start: 0, adjustment: true }] });

describe("an overhead adjustment is not an itemised cost", () => {
  it("⚠️ IT MUST NOT FEED THE BASELINE IT IS REDUCING", () => {
    // The baseline is measured burn MINUS what you have itemised. Counting a -$5,000 adjustment as
    // itemisation shrinks `itemizedOpex` by $5,000, grows `baselineOpex` by exactly $5,000, and cancels
    // itself — the runway does not move and nothing says why.
    const src = require("node:fs").readFileSync("src/engine/buildmodel.js", "utf8");
    expect(src).toMatch(/l\.kind === "cost" && !l\.adjustment/);
  });

  it("a cut lengthens the runway", () => {
    const d = demoDoc();
    expect(run(withCut(d, -5000))).toBeGreaterThan(run(d));
  });

  it("and an increase shortens it", () => {
    const d = demoDoc();
    expect(run(withCut(d, 5000))).toBeLessThan(run(d));
  });
});

describe("the floor is visible and honest", () => {
  const d = () => demoDoc();

  it("reports what there is to cut", () => {
    expect(overheadHeadroom(d())).toBeGreaterThan(0);
  });

  it("CLAMPS A CUT AT WHAT IS ACTUALLY SPENT, and says it did", () => {
    // Clamping silently would be worse than not clamping: somebody types $80,000, sees a runway built
    // on $52,000, and has no way to know the difference was refused.
    const max = overheadHeadroom(d());
    const r = overheadAdjustment(d(), -(max + 40000));
    expect(r.amount).toBe(-max);
    expect(r.clamped).toBe(true);
    expect(r.max).toBe(max);
  });

  it("leaves a cut within reach alone", () => {
    const r = overheadAdjustment(d(), -1000);
    expect(r).toMatchObject({ amount: -1000, clamped: false });
  });

  it("NEVER CLAMPS AN INCREASE", () => {
    // There is no ceiling on what somebody could choose to spend; the floor exists only because you
    // cannot cut more than you are spending.
    expect(overheadAdjustment(d(), 999999)).toMatchObject({ amount: 999999, clamped: false });
  });

  it("EXISTING ADJUSTMENTS COUNT AGAINST THE HEADROOM", () => {
    // Two cuts of $30k against $50k of overhead would both apply and take it negative between them.
    const base = overheadHeadroom(demoDoc());
    const after = overheadHeadroom(withCut(demoDoc(), -(base / 2)));
    expect(after).toBeCloseTo(base / 2, 0);
  });

  it("cannot be pushed below zero by stacking", () => {
    const one = withCut(demoDoc(), -overheadHeadroom(demoDoc()));
    expect(overheadHeadroom(one)).toBe(0);
    expect(overheadAdjustment(one, -5000).amount).toBe(0);
  });
});
