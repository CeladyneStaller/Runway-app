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

describe("the exit date responds to what is owed", () => {
  const fac = (cm) => ({ ...bare(), rounds: [{ id: "vd", name: "Facility", kind: "debt",
    status: "closed", amount: 800000, closeMonth: cm, termMonths: 36, rateAPR: 12 }] });
  const exit = (d, o) => commitmentPressure(d, rowsOf(d), o)?.coveredMonths;

  it("AN EARLIER DRAW MEANS AN EARLIER DEADLINE", () => {
    // The property the "forward-looking" version destroyed: anchoring the scan to today, or to the end
    // of actuals, made a company already negative at that point fail on the first month tested whatever
    // it owed — so the date pinned there and a million-pound facility changed nothing. A figure that
    // cannot respond to its own inputs is not a figure.
    expect(exit(fac(0))).toBeLessThan(exit(fac(1)));
    expect(exit(fac(1))).toBeLessThan(exit(fac(3)));
  });

  it("and every draw month brings it in from the no-debt case", () => {
    const none = exit(bare());
    for (const cm of [0, 1, 3]) expect(exit(fac(cm))).toBeLessThan(none);
  });

  it("excluding the debt moves it back out", () => {
    expect(exit(fac(0), { withVentureDebt: false })).toBeGreaterThan(exit(fac(0)));
  });

  it("A FACILITY IS LISTED WHATEVER MONTH IT IS DRAWN", () => {
    // Listing it at month zero meant one drawn in February reported $0 and was filtered out entirely —
    // the "counted and shown nowhere" failure arriving through a different door.
    for (const cm of [0, 1, 3, 12]) {
      const p = commitmentPressure(fac(cm), rowsOf(fac(cm)));
      expect(p.debt.length, `drawn month ${cm}`).toBe(1);
      expect(p.debt[0].amount).toBeGreaterThan(0);
    }
  });
});
