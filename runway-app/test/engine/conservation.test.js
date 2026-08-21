import { describe, it, expect } from "vitest";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { confidenceBand } from "../../src/engine/band.js";
import { buildChart, monthsShown } from "../../src/engine/charts.js";

/** ⚠️ CONSERVATION: what must stay true no matter how the inputs are arranged.
 *
 *  The other families check that a change produces the right NUMBER. This one checks that the engine has
 *  no memory, no order sensitivity and no hidden coupling — properties that are invisible until they
 *  break, and that break silently when systems get wired together.
 *
 *  ⚠️ AND ONE OF THEM IS FALSE ON PURPOSE. Superposition holds on BALANCES and emphatically does NOT
 *  hold on RUNWAY, because runway is a FIRST CROSSING. That is not a defect to be fixed — it is the
 *  central fact about how a reimbursement gap behaves, and this file pins it so nobody "corrects" the
 *  runway into linearity. The band's own header refuses false precision for the same reason.
 */

const T = { committed: true, expected: true, speculative: false, financing: false };

const doc = (over = {}) => ({
  startY: 2026, startM: 0, cash: 300000,
  lines: [{ id: "burn", label: "Opex", kind: "cost", cadence: "recurring", amount: 50000, start: 0, end: null }],
  employees: [], projects: [], pos: [], rounds: [], saas: [], history: [],
  cashActuals: {}, commitments: [], milestones: [],
  settings: { toggles: T, anchorActuals: false },
  ...over,
});

const withLines = (...extra) => doc({ lines: [...doc().lines, ...extra] });
const balances = (d, n = 12) => buildProjection(buildModelFromDoc(d), T).slice(0, n).map(r => Math.round(r.start));
const runway = (d) => zeroInfo(buildProjection(buildModelFromDoc(d), T), d.startY, d.startM)?.months;

const SALE = { id: "A", label: "Sale", kind: "revenue", cadence: "onetime", amount: 100000, start: 2, confidence: "committed" };
const SPEND = { id: "B", label: "Spend", kind: "cost", cadence: "onetime", amount: 40000, start: 3 };

describe("order cannot matter", () => {
  it("two lines produce the same curve in either order", () => {
    expect(balances(withLines(SALE, SPEND))).toEqual(balances(withLines(SPEND, SALE)));
  });

  it("⚠️ AND NEITHER CAN ORDER ACROSS DIFFERENT SYSTEMS", () => {
    // A line, a purchase order and an employee are compiled by three separate functions whose outputs
    // are concatenated. Nothing guarantees that concatenation is order-insensitive except that none of
    // them reads the list they are being added to — this is the assertion that keeps it that way.
    const po = { id: "po1", name: "Acme", amount: 10000, depositPct: 0,
      bookedMonth: 1, deliveryMonth: 1, termsDays: 0, confidence: "committed" };
    const emp = { id: "e1", name: "Dana", amount: 120000, basis: "annual", start: 0 };
    const forward = doc({ lines: [...doc().lines, SALE], pos: [po], employees: [emp] });
    const reversed = doc({ lines: [SALE, ...doc().lines], pos: [po], employees: [emp] });
    expect(balances(forward)).toEqual(balances(reversed));
  });
});

describe("superposition holds on balances", () => {
  it("⚠️ THE CURVE IS LINEAR IN ITS INPUTS, even though the runway is not", () => {
    // Each month's balance is a plain sum of the flows admitted that month, so the effect of A and B
    // together is the effect of A plus the effect of B, exactly. If this ever fails, two line items have
    // started influencing each other — a derived baseline, a clamp, a cost-share match — and the place
    // that happens is worth knowing about immediately.
    const base = balances(doc());
    const a = balances(withLines(SALE));
    const b = balances(withLines(SPEND));
    const both = balances(withLines(SALE, SPEND));
    expect(both).toEqual(base.map((v, i) => v + (a[i] - v) + (b[i] - v)));
  });
});

describe("⚠️ superposition does NOT hold on the runway, and must not", () => {
  // A curve that dips, is rescued by a receipt, and dips again. Spend runs months 0-3, $200k lands in
  // month 5, spend resumes from month 6 — the shape of every reimbursement-financed organisation.
  const trough = (cash) => ({
    startY: 2026, startM: 0, cash,
    lines: [
      { id: "b1", kind: "cost", cadence: "recurring", amount: 50000, start: 0, end: 3 },
      { id: "b2", kind: "cost", cadence: "recurring", amount: 50000, start: 6, end: 24 },
      { id: "r", kind: "revenue", cadence: "onetime", amount: 200000, start: 5, confidence: "committed" },
    ],
    employees: [], projects: [], pos: [], rounds: [], saas: [], history: [],
    cashActuals: {}, commitments: [], milestones: [],
    settings: { toggles: T, anchorActuals: false },
  });

  it("two identical deltas are worth far more together than twice one alone", () => {
    // $60k alone buys 1.2 months. $120k buys 10.4 — not 4.4, which is what adding the two deltas would
    // predict. The second $60k is worth three and a half times the first, because it is the one that
    // carries the balance over the trough to the far side where the receipt is waiting.
    //
    // ⚠️ THIS IS THE PRODUCT'S ENTIRE ARGUMENT, AS AN ASSERTION. Runway is not cash over burn, and the
    // marginal value of a dollar depends on whether it closes the gap. A tool that reported 4.4 here
    // would be wrong in the direction that costs someone their company.
    const base = runway(trough(100000));
    const one = runway(trough(160000));
    const two = runway(trough(220000));
    expect(base).toBeCloseTo(2.0, 6);
    expect(one).toBeCloseTo(3.2, 6);
    expect(two).toBeCloseTo(10.4, 6);
    expect(one + one - base).toBeCloseTo(4.4, 6);          // what superposition would predict
    expect(two).not.toBeCloseTo(one + one - base, 1);      // and what actually happens
  });

  it("but the balances underneath it still superpose exactly", () => {
    // The nonlinearity is entirely in reading a CROSSING off the curve. The curve itself is linear, so
    // both facts are true at once and neither is evidence against the other.
    const b0 = buildProjection(buildModelFromDoc(trough(100000)), T).map(r => r.start);
    const b1 = buildProjection(buildModelFromDoc(trough(160000)), T).map(r => r.start);
    const b2 = buildProjection(buildModelFromDoc(trough(220000)), T).map(r => r.start);
    expect(b2.map(Math.round)).toEqual(b0.map((v, i) => Math.round(v + 2 * (b1[i] - v))));
  });
});

describe("the engine keeps nothing between calls", () => {
  it("the same document twice gives the same answer", () => {
    const d = withLines(SALE, SPEND);
    expect(balances(d)).toEqual(balances(d));
    expect(runway(d)).toBe(runway(d));
    expect(monthsShown(d)).toBe(monthsShown(d));   // memoised on the doc — must be a cache, not a state
  });

  it("adding then removing returns the identical curve", () => {
    const before = balances(doc());
    runway(withLines(SALE, SPEND));
    buildChart("flow.runway", withLines(SALE, SPEND));
    expect(balances(doc())).toEqual(before);
  });

  it("⚠️ AND THE WHOLE PIPELINE RUNS ON A DEEP-FROZEN DOCUMENT", () => {
    // The strongest form of "does not mutate its input", and the cheapest. Modules are strict mode, so
    // any write to a frozen object throws rather than failing silently — which is what a mutation
    // would otherwise do, corrupting the caller's document and showing up somewhere unrelated.
    //
    // Worth having now that `monthsShown` caches on the doc: a WeakMap keyed by the object is fine, a
    // property stashed on it would not be, and only this test tells the two apart.
    const deepFreeze = (o) => {
      if (o && typeof o === "object" && !Object.isFrozen(o)) {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
      }
      return o;
    };
    const frozen = deepFreeze(withLines(SALE, SPEND));
    expect(() => {
      buildProjection(buildModelFromDoc(frozen), T);
      confidenceBand(frozen, undefined, T);
      buildChart("flow.runway", frozen);
      monthsShown(frozen);
    }).not.toThrow();
  });
});
