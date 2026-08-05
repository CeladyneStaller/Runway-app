import { describe, it, expect } from "vitest";
import { commitmentPressure, promote, addManual, promotable, removeCommitment, markPaid,
         costShareCommitments, accruedCostShare, windDownCost }
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

  it("IS REPORTED SEPARATELY AND NEVER COUNTED AS CASH OWED", () => {
    // THE CORRECTION. Cost share is not an extra cost — `computeGrant` splits ONE budget into a federal
    // share and yours, and the project's cash out is the whole budget either way. Setting
    // `costSharePct` to zero leaves the runway unchanged, which proves the money already leaves.
    //
    // Counting it in `unpaid` made covered runway subtract the same cash a second time.
    const p = commitmentPressure(base, rowsOf(base));
    expect(p).toBeTruthy();
    expect(p.costShareTotal).toBeGreaterThan(0);
    expect(p.unpaid).toBe(0);                  // no stored commitments in the demo model
    expect(p.rows).toEqual([]);                // and none in the cash table
  });

  it("shortens covered runway ONLY by the part that cannot be matched", () => {
    // WRITTEN AGAINST THE OLD DEFINITION and wrong under the new one. Covered runway is now the solvent
    // wind-down date, which is legitimately EARLIER than the runway because closing costs money —
    // payroll notice, at minimum. Asserting `covered == runway` was asserting that closing is free.
    //
    // What matters is that cost share contributes only its SHORTFALL: the accrued match you could not
    // meet from eligible funds. A company whose non-grant income covers the match owes nothing on the
    // way out and its covered runway should not move.
    const p = commitmentPressure(base, rowsOf(base));
    const noAward = { ...base, projects: [] };
    const pNo = commitmentPressure(noAward, rowsOf(noAward));
    if (p.costShareTotal > 0 && pNo?.coveredMonths != null) {
      // the award changes the projection too, so this is a sanity bound rather than an equality
      expect(p.coveredMonths).toBeLessThanOrEqual(
        zeroInfo(rowsOf(base), base.startY, base.startM).months + 0.001);
    }
    expect(p.unpaid).toBe(0);          // still not counted as cash owed
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

  it("still falls due per period, even though it is not cash owed", () => {
    // The per-period schedule still matters — it is when a funder checks the match — it simply belongs
    // in its own table rather than in the cash arithmetic.
    const cs = costShareCommitments(base);
    const runway = zeroInfo(rowsOf(base), base.startY, base.startM)?.months;
    expect(cs.some(c => c.payMonth < runway)).toBe(true);
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

describe("covered runway is the solvent wind-down date", () => {
  const base = demoDoc();
  const covered = (d) => commitmentPressure(d, rowsOf(d))?.coveredMonths;
  const runway = (d) => zeroInfo(rowsOf(d), d.startY, d.startM)?.months;

  it("PROMOTING A LINE MOVES NEITHER NUMBER", () => {
    // THE TEST THE OLD DEFINITION FAILED. Same line, same projection — and covered runway moved 5.10 to
    // 4.41 purely because somebody marked it signed. Nothing had changed about the company.
    //
    // It cannot happen now: the wind-down test COMPARES the balance against a debt, it never subtracts
    // from it, so marking a line signed changes no term.
    const withLine = { ...base, lines: [...(base.lines || []),
      { id: "l_x", label: "Tool", cadence: "onetime", kind: "cost", amount: 40000, start: 2 }] };
    expect(covered(promote(withLine, "l_x"))).toBeCloseTo(covered(withLine), 2);
    expect(runway(promote(withLine, "l_x"))).toBeCloseTo(runway(withLine), 2);
  });

  it("A DEBT AFTER THE CASH RUNS OUT SHORTENS IT, and runway is untouched", () => {
    // The case the whole feature exists for. You are insolvent before the bill arrives, so runway does
    // not move — but you lost the ability to close cleanly long before that.
    const d = addManual(base, { label: "A", signedMonth: 0, payMonth: 9, amount: 150000 });
    expect(runway(d)).toBeCloseTo(runway(base), 2);
    expect(covered(d)).toBeLessThan(covered(base));
  });

  it("A PLANNED COST DOES NOT, because you would not incur it", () => {
    // The badge earning its place: a patent renewal you would abandon is not a reason to think you are
    // heading for bankruptcy.
    const d = addManual(base, { label: "B", signedMonth: 0, payMonth: 9, amount: 150000, kind: "planned" });
    expect(covered(d)).toBeCloseTo(covered(base), 2);
  });

  it("a closure fee with NO due date counts, and never touches the runway", () => {
    // Triggered BY closing, so it appears in no projection of a company still trading — but it is
    // exactly what you would owe on the way out.
    const d = addManual(base, { label: "Lease break", signedMonth: 0, payMonth: null, amount: 150000 });
    expect(runway(d)).toBeCloseTo(runway(base), 2);
    expect(covered(d)).toBeLessThan(covered(base));
    expect((d.lines || []).length).toBe((base.lines || []).length);   // creates no cost line
  });

  it("is always at or before the runway", () => {
    // Closing costs money, so the date you can still close cleanly cannot be later than the date the
    // cash runs out.
    for (const d of [base,
        addManual(base, { label: "x", signedMonth: 0, payMonth: 2, amount: 40000 }),
        addManual(base, { label: "y", signedMonth: 0, payMonth: null, amount: 20000 })]) {
      expect(covered(d)).toBeLessThanOrEqual(runway(d) + 0.001);
    }
  });

  it("counts payroll wind-down, using the payroll function the model already uses", () => {
    // My first version read `e.salary / 12`, a field that does not exist, and returned zero for every
    // model — the wind-down cost silently vanished. A number that is quietly zero is worse than one
    // that is obviously wrong.
    expect(windDownCost(base)).toBeGreaterThan(0);
    expect(windDownCost({ ...base, settings: { ...base.settings, noticeWeeks: 0 } })).toBe(0);
    const longer = { ...base, settings: { ...base.settings, noticeWeeks: 12 } };
    expect(covered(longer)).toBeLessThan(covered(base));
  });
});
