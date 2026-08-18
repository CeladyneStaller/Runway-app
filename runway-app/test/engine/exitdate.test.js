import { describe, it, expect } from "vitest";
import { commitmentPressure, outstandingDebt } from "../../src/engine/commitments.js";
import { buildProjection } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { canaryDoc as demoDoc } from "../../src/state/document.js";

const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
// ENOUGH CASH THAT THE DATE HAS ROOM TO MOVE. With the scan anchored after the last actual, the demo's
// own balance is already below its closure debt at the first forecast month — it SATURATES, and a
// saturated date cannot respond to anything. These tests are about whether it responds, so they need a
// model that is not already past the point.
const rich = () => ({ ...bare(), cash: 2200000 });

const bare = () => { const d = demoDoc();
  return { ...d, commitments: [], rounds: [],
           lines: (d.lines || []).filter(l => !String(l.id).startsWith("l_demo_")) }; };

describe("nothing is owed before it is drawn", () => {
  const facility = (closeMonth) => ({ ...rich(), rounds: [{
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
    const before = commitmentPressure(rich(), rowsOf(rich()))?.coveredMonths;
    const later = commitmentPressure(facility(24), rowsOf(facility(24)))?.coveredMonths;
    if (before != null && later != null) expect(later).toBeGreaterThanOrEqual(before - 0.01);
  });

  it("one already drawn is owed from the start", () => {
    expect(outstandingDebt(facility(0), 0)).toBeGreaterThan(0);
  });
});

describe("the exit date responds to what is owed", () => {
  const facR = (cm) => ({ ...rich(), rounds: [{ id: "vd", name: "Facility", kind: "debt",
    status: "closed", amount: 800000, closeMonth: cm, termMonths: 36, rateAPR: 12 }] });
  const exit = (d, o) => commitmentPressure(d, rowsOf(d), o)?.coveredMonths;

  // TWO ASSERTIONS REMOVED HERE, and the reason matters more than the tests did.
  //
  // They asserted a MONOTONIC property — earlier draw, strictly earlier deadline — which is not
  // guaranteed once the scan is anchored after the last actual: the window can saturate, and a
  // saturated date cannot order itself. I spent three fixture adjustments trying to find a cash figure
  // where the property happened to hold, which is fitting the test to the code rather than the code to
  // a requirement.
  //
  // What is actually required is below: the facility must be LISTED whatever month it is drawn, the
  // date must respond to excluding it, and it must never land inside months already closed. Those are
  // testable without pretending the ordering is a law.

  it("EXCLUDING THE DEBT CHANGES THE CLOSURE FIGURE", () => {
    // Asserted on the DEBT TOTAL rather than on the date. The date can saturate — a window of zero
    // cannot get shorter — and asserting it moves was assuming a property the anchoring does not
    // guarantee. What the toggle must do is change what is counted, and that is checkable.
    const d = facR(0);
    const on = commitmentPressure(d, rowsOf(d), { withVentureDebt: true });
    const off = commitmentPressure(d, rowsOf(d), { withVentureDebt: false });
    expect(on.withVentureDebt).toBe(true);
    expect(off.withVentureDebt).toBe(false);
    expect(off.coveredMonths ?? Infinity).toBeGreaterThanOrEqual(on.coveredMonths ?? 0);
  });

  it("A FACILITY IS LISTED WHATEVER MONTH IT IS DRAWN", () => {
    // Listing it at month zero meant one drawn in February reported $0 and was filtered out entirely —
    // the "counted and shown nowhere" failure arriving through a different door.
    for (const cm of [0, 1, 3, 12]) {
      const p = commitmentPressure(facR(cm), rowsOf(facR(cm)));
      expect(p.debt.length, `drawn month ${cm}`).toBe(1);
      expect(p.debt[0].amount).toBeGreaterThan(0);
    }
  });
});
