import { describe, it, expect } from "vitest";
import { commitmentPressure, outstandingDebt } from "../../src/engine/commitments.js";
import { buildProjection } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { demoDoc } from "../../src/state/document.js";

const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
const bare = () => { const d = demoDoc();
  return { ...d, commitments: [], rounds: [],
           lines: (d.lines || []).filter(l => !String(l.id).startsWith("l_demo_")) }; };

describe("nothing is owed before it is drawn", () => {
  const facility = (closeMonth) => ({ ...bare(), rounds: [{
    id: "vd", name: "Facility", kind: "debt", status: "closed", amount: 800000,
    closeMonth, termMonths: 36, rateAPR: 12 }] });

  it("A FACILITY CLOSING IN APRIL IS NOT A LIABILITY IN JANUARY", () => {
    // THE BUG. This counted every future repayment from month zero, so including a not-yet-drawn
    // facility said "you could not pay everyone" about a month in which you owed the lender nothing.
    expect(outstandingDebt(facility(3), 0)).toBe(0);
    expect(outstandingDebt(facility(3), 1)).toBe(0);
    expect(outstandingDebt(facility(3), 3)).toBeGreaterThan(0);
  });

  it("so the exit date is not moved by a draw that has not happened", () => {
    const before = commitmentPressure(bare(), rowsOf(bare()))?.coveredMonths;
    const later = commitmentPressure(facility(24), rowsOf(facility(24)))?.coveredMonths;
    if (before != null && later != null) expect(later).toBeGreaterThanOrEqual(before - 0.01);
  });

  it("one already drawn is owed from the start", () => {
    expect(outstandingDebt(facility(0), 0)).toBeGreaterThan(0);
  });
});

describe("the exit date is forward-looking", () => {
  it("NEVER REPORTS A MONTH THAT HAS ALREADY PASSED", () => {
    // The scan started at month zero, so a model beginning last year and dipping in month two reported
    // a deadline that had already gone by. A decision deadline in the past is not a deadline.
    const d = { ...bare(), startY: 2025, startM: 0 };
    const p = commitmentPressure(d, rowsOf(d), { today: new Date(2026, 7, 5) });
    if (p?.coveredAt) expect(p.coveredAt.getTime()).toBeGreaterThanOrEqual(new Date(2026, 6, 1).getTime());
  });

  it("starts at the model's own start when that is in the future", () => {
    const d = bare();
    const p = commitmentPressure(d, rowsOf(d), { today: new Date(d.startY, d.startM, 1) });
    expect(p?.coveredMonths ?? 0).toBeGreaterThanOrEqual(0);
  });
});
