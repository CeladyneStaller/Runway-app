import { describe, it, expect } from "vitest";
import { buildProjection } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { debtLines, compileInstrument } from "../../src/engine/capital.js";
import { computeGrant } from "../../src/engine/grant.js";
import { canaryDoc } from "../../src/state/document.js";

/** ⚠️ SECOND-ORDER EFFECTS, NAMED — never absorbed into a tolerance.
 *
 *  A $500,000 round does not move the balance by $500,000. A $120,000 salary does not cost $10,000 a
 *  month. A $600,000 award does not pay $600,000 if you matched 20% of it. Each shortfall has a name and
 *  a rate, and the assertion form throughout this file is:
 *
 *      the delta equals X minus <a named derived amount>
 *
 *  rather than `toBeCloseTo(X, -3)`. A tolerance wide enough to swallow a royalty is wide enough to
 *  swallow a bug, and it teaches the next reader that the number is approximate when it is exact.
 *
 *  ⚠️ THIS FILE EXISTS BECAUSE I GOT ONE OF THEM WRONG. Building family A, I saw a closed $500,000 SAFE
 *  move the line by $490,000 and wrote "cost-share matching" in a test comment. It is the 2% licence
 *  ROYALTY — 500,000 x 0.02 = 10,000, exactly the gap — and two of the canary's three grants carry
 *  `costSharePct: 0`, so cost share never entered. A plausible name for an unexplained shortfall is
 *  worse than none: it stops anyone looking. Every figure below was measured, not reasoned.
 */

const T = { committed: true, expected: true, speculative: false, financing: true };

const bare = (over = {}) => ({
  startY: 2026, startM: 0, cash: 300000,
  lines: [], employees: [], projects: [], pos: [], rounds: [], saas: [], history: [],
  cashActuals: {}, commitments: [], milestones: [],
  settings: { toggles: T, anchorActuals: false },
  ...over,
});

const monthlyBurn = (d) => {
  const rows = buildProjection(buildModelFromDoc(d), T);
  return Math.round(rows[0].start - rows[1].start);
};

describe("fringe is a rate on salary, not a rounding error", () => {
  const withSalary = (fringePct) => bare({
    employees: [{ id: "e1", name: "Dana", amount: 120000, basis: "annual", start: 0 }],
    settings: { toggles: T, anchorActuals: false, fringePct },
  });

  it("⚠️ A $120,000 SALARY COSTS $13,000 A MONTH AT 30% FRINGE, not $10,000", () => {
    // salary/12 x (1 + fringe). The naive figure is the one a founder budgets with and the one that
    // makes payroll a surprise. Asserted at both ends so the rate itself is pinned, not just the total.
    expect(monthlyBurn(withSalary(0))).toBe(10000);          // 120000 / 12
    expect(monthlyBurn(withSalary(0.3))).toBe(13000);        // x 1.30
    expect(monthlyBurn(withSalary(0.3)) - monthlyBurn(withSalary(0)))
      .toBe(Math.round(120000 / 12 * 0.3));                  // the fringe, named
  });
});

describe("a drawn loan is worth less than its face, and costs more", () => {
  const loan = (over = {}) => ({ id: "d", name: "Loan", kind: "debt", status: "closed",
    amount: 500000, closeMonth: 3, rateAPR: 0, ioMonths: 0, termMonths: 12, ...over });

  it("⚠️ FEES COME OFF THE DRAW: $500,000 at 2% arrives as $490,000", () => {
    // The same $10,000 shape as the royalty, from an entirely different mechanism — which is exactly
    // why an unexplained $490,000 must never be shrugged at.
    const draw = compileInstrument(loan({ feesPct: 0.02 }), []).find(l => l.kind === "revenue");
    expect(draw.amount).toBe(500000 * (1 - 0.02));
    expect(draw.start).toBe(3);
    expect(draw.confidence).toBe("committed");               // status `closed`
  });

  it("interest-only, then principal and interest, then the payment nobody has on their calendar", () => {
    // $500k at 12% APR, six months interest-only, 36-month term, 10% final.
    //   monthly rate      0.12 / 12                     = 0.01
    //   interest only     500000 x 0.01                 = $5,000, months 4-9 (close 3 + 1 .. + 6)
    //   amortising over   36 − 6 = 30 payments          = $19,374, months 10-39
    //   final             500000 x 0.10                 = $50,000, month 39
    const lines = debtLines(loan({ rateAPR: 12, ioMonths: 6, termMonths: 36, finalPct: 0.10 }), "committed");
    const io = lines.find(l => /interest only/.test(l.label));
    const pi = lines.find(l => /principal & interest/.test(l.label));
    const fin = lines.find(l => /final payment/.test(l.label));

    expect(io).toMatchObject({ amount: 5000, start: 4, end: 9 });
    expect(Math.round(pi.amount)).toBe(19374);
    expect(pi).toMatchObject({ start: 10, end: 39 });
    expect(fin).toMatchObject({ amount: 50000, start: 39 });

    // ⚠️ THE FINAL PAYMENT LANDS IN THE SAME MONTH THE SCHEDULE ENDS, on top of that month's P&I.
    // Two obligations in one month is the shape that catches people out, and it is the reason this
    // line exists separately rather than being folded into the amortisation.
    expect(fin.start).toBe(pi.end);
  });

  it("a fixed-multiple loan divides the total obligation, it does not amortise", () => {
    // "Pay back 1.5x over 48 months" is a total agreed up front — 500000 x 1.5 / 48 = $15,625 a month.
    // There is no rate to solve for, and treating it as one would invent an interest figure.
    const lines = debtLines(loan({ repayMode: "multiple", repayMultiple: 1.5, termMonths: 48, ioMonths: 0 }), "committed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amount: 500000 * 1.5 / 48, start: 4, end: 51 });
    expect(lines[0].amount).toBe(15625);
  });
});

describe("cost share is spend you are not reimbursed for", () => {
  const grant = (costSharePct) => ({
    assumeFunded: false, reimburseTiming: "arrears", reimburseLagMonths: 2,
    costSharePct, costShareType: "cash",
    periods: [{ id: "p1", start: 0, end: 5 }],
    categories: { other: [{ byPeriod: { 0: 600000 } }] },
  });

  it("⚠️ A 20% MATCH DOES NOT MEAN SPENDING 20% MORE", () => {
    // It means 20% of the same budget comes out of your own pocket. The spend line does not move at
    // all; the reimbursement drops by exactly the match. Asserting both halves is what makes that
    // unambiguous — asserting only the reimbursement would leave "and the spend went up too" open.
    const at = (pct) => {
      const { lines, per } = computeGrant(grant(pct), undefined, "awarded");
      return {
        cost: lines.find(l => l.kind === "cost").amount,
        rev: lines.find(l => l.kind === "revenue").amount,
        share: per[0].costShare,
      };
    };
    expect(at(0)).toEqual({ cost: 100000, rev: 600000, share: 0 });
    expect(at(0.2)).toEqual({ cost: 100000, rev: 480000, share: 120000 });

    // the shortfall, named: federal = total x (1 − costSharePct)
    expect(at(0).rev - at(0.2).rev).toBe(600000 * 0.2);
  });
});

describe("⚠️ the royalty, on the document that actually carries one", () => {
  it("$500,000 of committed revenue moves the canary by $490,000, and the $10,000 has a name", () => {
    // THE MIS-ATTRIBUTION THIS FILE OPENS WITH, PINNED SO IT CANNOT RECUR. Read the rate off the
    // document rather than writing 10000: if someone retunes the royalty, this test follows it instead
    // of failing with a stale constant and inviting a tolerance.
    const doc = canaryDoc();
    const roy = (doc.commitments || []).find(c => c.flavor === "indexed" && c.index?.of === "revenue");
    expect(roy, "the canary should carry a revenue-indexed royalty").toBeTruthy();

    const at = (d, m) => buildProjection(buildModelFromDoc(d), doc.settings.toggles)[m].start;
    const probe = { id: "p", kind: "revenue", cadence: "onetime", amount: 500000, start: 6, confidence: "committed" };
    const moved = Math.round(at({ ...doc, lines: [...(doc.lines || []), probe] }, 8) - at(doc, 8));

    expect(moved).toBe(500000 * (1 - roy.index.pct));
    expect(500000 - moved).toBe(500000 * roy.index.pct);     // the royalty, stated
  });

  it("and cost share is NOT what causes it — two of three canary grants match nothing", () => {
    // The specific check that would have stopped the wrong comment being written. If cost share were
    // responsible, changing it would change the gap; it does not, because these grants do not match.
    const doc = canaryDoc();
    const shares = (doc.projects || []).filter(p => p.type === "grant").map(p => p.grant?.costSharePct ?? 0);
    expect(shares.filter(s => s === 0).length).toBeGreaterThanOrEqual(2);
  });
});
