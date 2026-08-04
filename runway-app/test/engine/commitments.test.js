import { describe, it, expect } from "vitest";
import { commitmentPressure, promote, addManual, promotable, removeCommitment, markPaid,
         costShareCommitments, accruedCostShare }
  from "../../src/engine/commitments.js";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { demoDoc } from "../../src/state/document.js";
import { computeGrant } from "../../src/engine/grant.js";

const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
const runway = (d) => zeroInfo(rowsOf(d), d.startY, d.startM)?.months ?? null;

describe("commitments", () => {
  const base = demoDoc();

  it("PROMOTING A PLANNED LINE MOVES NO CASH", () => {
    // THE INVARIANT: every commitment owns exactly one outflow. A promoted line already exists and
    // already moves the money; creating a second outflow would double the burn, silently.
    const withLine = {
      ...base,
      lines: [...(base.lines || []),
              { id: "l_x", label: "Tooling", cadence: "onetime", kind: "cost", amount: 110000, start: 3 }],
    };
    const before = JSON.stringify(rowsOf(withLine));
    const after = JSON.stringify(rowsOf(promote(withLine, "l_x")));
    expect(after).toBe(before);
  });

  it("a manual commitment DOES move cash, because nothing else was going to", () => {
    const d = addManual(base, { label: "Deposit", signedMonth: 0, payMonth: 2, amount: 40000 });
    expect(runway(d)).toBeLessThan(runway(base));
  });

  it("COVERED RUNWAY IS NEVER LONGER THAN RUNWAY", () => {
    // The first version counted whole months while `zeroInfo` interpolates, and reported 6.0 against a
    // runway of 5.6 — longer, which is nonsense, and exactly the kind of number somebody repeats in a
    // board meeting. Both now come from `zeroInfo` over the same rows.
    for (const [payMonth, amount] of [[1, 188000], [2, 40000], [7, 188000]]) {
      const d = addManual(base, { label: "x", signedMonth: 0, payMonth, amount });
      const rows = rowsOf(d);
      const p = commitmentPressure(d, rows);
      const r = zeroInfo(rows, d.startY, d.startM)?.months;
      if (p?.coveredMonths != null && r != null) {
        expect(p.coveredMonths, `pay m${payMonth}`).toBeLessThanOrEqual(r + 0.001);
      }
    }
  });

  it("flags an obligation falling after the cash runs out", () => {
    // It does not shorten the runway — the money was already gone — but it is money owed with nothing
    // behind it, which is the whole reason the feature exists.
    // The demo model carries a DERIVED cost-share obligation, so uncovered is not this commitment
    // alone. Asserting a bare total made the test about the fixture rather than the behaviour.
    const before = commitmentPressure(base, rowsOf(base))?.uncovered || 0;
    const d = addManual(base, { label: "Late", signedMonth: 0, payMonth: 7, amount: 188000 });
    const p = commitmentPressure(d, rowsOf(d));
    expect(p.uncovered - before).toBe(188000);
    expect(p.rows.find(r => r.label === "Late").covered).toBe(false);
  });

  it("COVER IS CUMULATIVE, not per-commitment", () => {
    // Two obligations individually affordable and jointly impossible — the same failure fixed on the
    // milestones chart, where two dates were each fine and together were not.
    let d = base;
    d = addManual(d, { label: "A", signedMonth: 0, payMonth: 1, amount: 150000 });
    d = addManual(d, { label: "B", signedMonth: 0, payMonth: 1, amount: 150000 });
    const p = commitmentPressure(d, rowsOf(d));
    expect(p.rows[1].runningTotal).toBe(300000);
    expect(p.rows[1].spare).toBeLessThan(p.rows[0].spare);
  });

  it("returns null when nothing is committed", () => {
    // The common case, and the one where this must cost nothing and change nothing. Uses a model with
    // no awards, because the demo carries a derived cost share — which is itself the point of that
    // feature, and would make this assertion about the fixture.
    const bare = { ...base, projects: [], commitments: [] };
    expect(commitmentPressure(bare, rowsOf(bare))).toBeNull();
  });

  it("removing a MANUAL commitment removes its line; a PROMOTED one leaves the plan alone", () => {
    const manual = addManual(base, { label: "M", signedMonth: 0, payMonth: 2, amount: 1000 });
    const back = removeCommitment(manual, manual.commitments[0].id);
    expect(back.lines).toHaveLength((base.lines || []).length);

    const withLine = { ...base, lines: [...(base.lines || []),
      { id: "l_y", label: "Rig", cadence: "onetime", kind: "cost", amount: 5000, start: 2 }] };
    const promoted = promote(withLine, "l_y");
    const undone = removeCommitment(promoted, promoted.commitments[0].id);
    expect(undone.lines.find(l => l.id === "l_y")).toBeTruthy();
  });

  it("marking paid stops the obligation counting but leaves the money spent", () => {
    const d = addManual(base, { label: "P", signedMonth: 0, payMonth: 2, amount: 40000 });
    const paid = markPaid(d, d.commitments[0].id, { month: 2, ref: "QBO-1" });
    const after = commitmentPressure(paid, rowsOf(paid));
    expect((after?.rows || []).some(r => r.label === "P")).toBe(false);
    expect(runway(paid)).toBe(runway(d));            // the cash still left
  });

  it("offers only ONE-TIME costs for promotion", () => {
    // A recurring line is a lease or a salary. Its whole remaining term being "uncovered" is true and
    // useless — six figures of unavoidable rent permanently at the top of a list meant for decisions.
    const d = { ...base, lines: [...(base.lines || []),
      { id: "l_r", label: "Rent", cadence: "recurring", kind: "cost", amount: 6500, start: 0 },
      { id: "l_o", label: "Rig", cadence: "onetime", kind: "cost", amount: 5000, start: 2 }] };
    const ids = promotable(d).map(p => p.lineId);
    expect(ids).toContain("l_o");
    expect(ids).not.toContain("l_r");
  });

  it("does not offer a line already promoted", () => {
    const d = { ...base, lines: [...(base.lines || []),
      { id: "l_z", label: "Rig", cadence: "onetime", kind: "cost", amount: 5000, start: 2 }] };
    expect(promotable(promote(d, "l_z")).map(p => p.lineId)).not.toContain("l_z");
  });

  it("survives empty and malformed input", () => {
    expect(commitmentPressure(null, [])).toBeNull();
    expect(commitmentPressure({}, [])).toBeNull();
    expect(promotable(null)).toEqual([]);
    expect(() => promote({}, "nope")).not.toThrow();
  });
});

describe("cost share, derived from the award", () => {
  const base = demoDoc();

  it("finds the obligation the model already knows the size of", () => {
    // A cost-share award commits you to spending your own money to unlock theirs, and it appeared
    // nowhere before. `computeGrant().grand.costShare` is the figure the Projects tab already totals,
    // so the two cannot disagree.
    const cs = costShareCommitments(base);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs[0].amount).toBeGreaterThan(0);
    expect(cs[0].source).toBe("grant");
  });

  it("DATES IT TO THE END OF THE AWARD, not month zero", () => {
    // THE BUG THIS CAUGHT. A grant's dates live in `periods[]`, not on the grant — `g.endM` does not
    // exist, so the first version defaulted every obligation to month 0 and reported it due
    // immediately. Wrong in the alarming direction is still wrong, and this was wrong by the entire
    // length of the award.
    const cs = costShareCommitments(base);
    expect(cs[0].payMonth).toBeGreaterThan(0);
    expect(cs[0].payMonth).toBeGreaterThanOrEqual(cs[0].signedMonth);
  });

  it("creates no cost line, because the spend is already in the project", () => {
    // Same invariant as a promoted line, reached differently: the money is already in the plan.
    const cs = costShareCommitments(base);
    expect(cs.every(c => c.lineId === null)).toBe(true);
    expect(cs.every(c => c.derived === true)).toBe(true);
  });

  it("counts toward pressure alongside stored commitments", () => {
    const p = commitmentPressure(base, rowsOf(base));
    expect(p).toBeTruthy();
    expect(p.unpaid).toBeGreaterThan(0);
  });

  it("moves when the award moves, because it is derived rather than stored", () => {
    const bigger = {
      ...base,
      projects: (base.projects || []).map(pr => (pr.grant
        ? { ...pr, grant: { ...pr.grant, costSharePct: (pr.grant.costSharePct || 0) * 2 } } : pr)),
    };
    const a = costShareCommitments(base).reduce((x, c) => x + c.amount, 0);
    const b = costShareCommitments(bigger).reduce((x, c) => x + c.amount, 0);
    expect(b).toBeGreaterThan(a);
  });

  it("ignores prospective awards", () => {
    // Not yet won is not yet owed.
    const prosp = { ...base, projects: (base.projects || []).map(p => ({ ...p, stage: "prospective" })) };
    expect(costShareCommitments(prosp)).toEqual([]);
  });
});

describe("cost share accrues per period", () => {
  const base = demoDoc();

  it("is ONE OBLIGATION PER BUDGET PERIOD, not one per award", () => {
    // A funder does not let you under-match in year one and make it up in year three. Modelling it as a
    // lump at award end was wrong twice: it understated the near-term obligation and put the whole of
    // it after a runway it should have been pressing against all along.
    // `period` was dropped when rows gained a billing rhythm — a monthly-billed award has twelve rows
    // inside ONE period, so a unique-period assertion was really asserting the arrears schedule.
    // Distinct DUE DATES is the property that actually matters.
    const cs = costShareCommitments(base);
    expect(cs.length).toBeGreaterThan(1);
    expect(new Set(cs.map(c => c.payMonth)).size).toBe(cs.length);
  });

  it("each falls at the END OF ITS OWN PERIOD", () => {
    const cs = costShareCommitments(base);
    for (const c of cs) expect(c.payMonth).toBeGreaterThanOrEqual(c.signedMonth);
    for (let i = 1; i < cs.length; i++) expect(cs[i].payMonth).toBeGreaterThan(cs[i - 1].payMonth);
  });

  it("PRESSES ON THE RUNWAY, because an early period falls inside it", () => {
    // The whole point of the correction: the first period's obligation lands before the cash runs out,
    // which the lump-sum version hid completely.
    const rows = rowsOf(base);
    const p = commitmentPressure(base, rows);
    const runway = zeroInfo(rows, base.startY, base.startM)?.months;
    expect(p.rows.some(r => r.payMonth < runway)).toBe(true);
  });

  it("accrues with the period rather than appearing whole on the due date", () => {
    // The obligation is already partly real; a reader should not see a cliff they think they can plan
    // around.
    const a = accruedCostShare(base, 0);
    const b = accruedCostShare(base, 3);
    const c = accruedCostShare(base, 11);
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("no-cost extension", () => {
  const base = demoDoc();
  const withNce = (months) => ({
    ...base,
    projects: (base.projects || []).map(p => (p.grant
      ? { ...p, grant: { ...p.grant, periods: p.grant.periods.map((x, i) =>
          (i === p.grant.periods.length - 1 ? { ...x, nceMonths: months } : x)) } }
      : p)),
  });

  it("ADDS TIME AND NO MONEY", () => {
    // The defining property. If the total moves, it is not a no-cost extension.
    const a = computeGrant((base.projects || []).find(p => p.grant).grant).grand.total;
    const b = computeGrant((withNce(6).projects || []).find(p => p.grant).grant).grand.total;
    expect(Math.round(b)).toBe(Math.round(a));
  });

  it("moves the cost-share deadline with the period end", () => {
    const before = costShareCommitments(base);
    const after = costShareCommitments(withNce(6));
    expect(after[after.length - 1].payMonth).toBe(before[before.length - 1].payMonth + 6);
  });

  it("spreads the same spend thinner, so the runway does not shorten", () => {
    const r = (d) => zeroInfo(rowsOf(d), d.startY, d.startM)?.months ?? 0;
    expect(r(withNce(6))).toBeGreaterThanOrEqual(r(base));
  });

  it("changes nothing when there is no extension", () => {
    expect(JSON.stringify(costShareCommitments(withNce(0))))
      .toBe(JSON.stringify(costShareCommitments(base)));
  });
});

describe("cost share follows the BILLING RHYTHM", () => {
  const base = demoDoc();
  const retime = (t) => ({
    ...base,
    projects: (base.projects || []).map(p => (p.grant
      ? { ...p, grant: { ...p.grant, reimburseTiming: t } } : p)),
  });
  const exact = Math.round(
    computeGrant((base.projects || []).find(p => p.grant).grant).grand.costShare);

  it("MONTHLY billing means monthly match", () => {
    // Cost share is verified against what you BILLED, so it falls due on the rhythm you bill on. A
    // monthly-billed award is twelve small proofs of match, not one large one — and treating them all
    // as period-end understated how soon the money was needed.
    const cs = costShareCommitments(retime("monthly"));
    expect(cs.length).toBeGreaterThan(6);
    expect(cs[0].payMonth).toBeLessThan(cs[1].payMonth);
  });

  it("ARREARS and ADVANCE both reconcile at the period end", () => {
    // Being paid up front does not move when the match is PROVEN — the funder still checks what the
    // advance was spent on at the period's close.
    const a = costShareCommitments(retime("arrears")).map(c => c.payMonth);
    const b = costShareCommitments(retime("advance")).map(c => c.payMonth);
    expect(b).toEqual(a);
  });

  it("MILESTONE billing spreads the match across milestones", () => {
    const withMs = {
      ...base,
      projects: (base.projects || []).map(p => (p.grant
        ? { ...p, grant: { ...p.grant, reimburseTiming: "milestone",
            milestones: [{ label: "M1", month: 4, payment: 100000 },
                         { label: "M2", month: 9, payment: 100000 }] } }
        : p)),
    };
    const cs = costShareCommitments(withMs);
    expect(cs.map(c => c.payMonth)).toEqual([4, 9]);
  });

  it("DOES NOT DROP the obligation when a milestone-billed award has no milestones yet", () => {
    // A real liability must not vanish because a schedule has not been filled in — the same silent
    // disappearance this whole feature exists to prevent. Falls back to period ends.
    const cs = costShareCommitments(retime("milestone"));
    expect(cs.length).toBeGreaterThan(0);
  });

  it("does NOT apply the reimbursement lag", () => {
    // `reimburseLagMonths` is how long the FUNDER takes to pay you. Your match is due when you bill,
    // not when they settle — applying it would push every obligation later by the funder's slowness.
    const lagged = {
      ...base,
      projects: (base.projects || []).map(p => (p.grant
        ? { ...p, grant: { ...p.grant, reimburseLagMonths: 3 } } : p)),
    };
    expect(costShareCommitments(lagged).map(c => c.payMonth))
      .toEqual(costShareCommitments(base).map(c => c.payMonth));
  });

  it("SUMS EXACTLY to the award's own figure, whatever the rhythm", () => {
    // Rounding each row independently left the total a dollar under — the kind of discrepancy that
    // becomes "your match is $1 short" in a reconciliation with a funder.
    for (const t of ["arrears", "monthly", "advance", "milestone"]) {
      const total = costShareCommitments(retime(t)).reduce((a, c) => a + c.amount, 0);
      expect(total, t).toBe(exact);
    }
  });
});

describe("cost share against ACTUAL billings", () => {
  const base = demoDoc();
  const billed = (actuals) => ({
    ...base,
    projects: (base.projects || []).map(p => (p.grant
      ? { ...p, actuals, grant: { ...p.grant, reimburseTiming: "monthly" } } : p)),
  });
  const first = (d) => costShareCommitments(d).filter(c => c.payMonth <= 5);

  it("A MONTH THAT BILLED NOTHING OWES NOTHING", () => {
    // The obligation follows the draw. Dividing evenly assumes billing runs to plan, and a grant that
    // under-bills for two months then catches up owes a different amount at each point.
    const rows = first(billed({ 0: 0, 1: 0, 2: 60000 }));
    expect(rows[0].amount).toBe(0);
    expect(rows[1].amount).toBe(0);
    expect(rows[2].amount).toBeGreaterThan(0);
  });

  it("falls back to an even split when nothing has been billed yet", () => {
    const rows = first(billed({}));
    const amounts = new Set(rows.map(r => r.amount));
    expect(amounts.size).toBe(1);
  });

  it("treats flat billing the same as an even split, because it IS one", () => {
    const flat = first(billed({ 0: 10000, 1: 10000, 2: 10000 })).map(r => r.amount);
    const none = first(billed({})).map(r => r.amount);
    expect(flat).toEqual(none);
  });

  it("still sums exactly, whatever the billing pattern", () => {
    for (const a of [{}, { 0: 10000, 1: 10000 }, { 0: 0, 1: 0, 2: 60000 }, { 0: 999 }]) {
      const total = costShareCommitments(billed(a)).reduce((x, c) => x + c.amount, 0);
      expect(total, JSON.stringify(a)).toBe(
        Math.round(computeGrant((base.projects || []).find(p => p.grant).grant).grand.costShare));
    }
  });

  it("accrual follows the weighted rows, not a straight line", () => {
    // Interpolating across a period would undo the weighting and hand back the even split this change
    // exists to replace.
    const lumpy = billed({ 0: 0, 1: 0, 2: 60000 });
    expect(accruedCostShare(lumpy, 1)).toBe(0);
    expect(accruedCostShare(lumpy, 2)).toBeGreaterThan(0);
  });

  it("ignores actuals beyond the last recorded month", () => {
    // Past from actuals, future from plan — the same hybrid the projection uses. There is nothing to
    // use beyond the ledger but the plan, and pretending otherwise would be inventing a figure.
    const d = billed({ 0: 10000 });
    expect(costShareCommitments(d).length).toBeGreaterThan(1);
  });
});
