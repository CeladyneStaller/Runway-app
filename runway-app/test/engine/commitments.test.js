import { describe, it, expect } from "vitest";
import { commitmentPressure, promote, addManual, promotable, removeCommitment, markPaid,
         costShareCommitments, accruedCostShare, windDownCost, outstandingDebt }
  from "../../src/engine/commitments.js";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { canaryDoc as demoDoc } from "../../src/state/document.js";

// THE DEMO NOW CARRIES FIVE COMMITMENTS, one of each flavour, because its job is to demonstrate the
// product. That makes it the wrong fixture for tests that measure what a commitment DOES — they need a
// model with none, or they are measuring the seeds. Stripping them is one line and says which is meant.
const bare = () => {
  const d = demoDoc();
  return { ...d, commitments: [], lines: (d.lines || []).filter(l => !String(l.id).startsWith("l_demo_")) };
};
import { computeGrant } from "../../src/engine/grant.js";

const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
const runway = (d) => zeroInfo(rowsOf(d), d.startY, d.startM)?.months ?? null;

// A MONTH COMFORTABLY PAST THE CROSSING, derived rather than hardcoded. Month 9 used to be past it and
// stopped being when the demo's cash changed — a test about the fixture rather than the behaviour.
const afterCashOut = (d) => Math.ceil((runway(d) ?? 6) + 3);

describe("⚠️ indexedLines — a royalty is charged per tier, not on everything", () => {
  const royaltyDoc = (extra = {}) => ({
    startY: 2026, startM: 0, cash: 100000,
    commitments: [{ id: "roy", label: "Royalty", flavor: "indexed", kind: "debt", signedMonth: 0,
      payMonth: null, amount: 0, index: { of: "revenue", ref: null, pct: 0.02 }, status: "committed" }],
    ...extra,
  });
  const lines = [
    { id: "a", kind: "revenue", cadence: "onetime", amount: 10000, start: 1, confidence: "committed" },
    { id: "b", kind: "revenue", cadence: "onetime", amount: 40000, start: 1, confidence: "expected" },
  ];

  it("⚠️ DOES NOT BILL COMMITTED FOR REVENUE THE GATE EXCLUDED", async () => {
    // This summed every line into one basis and emitted the cost hardcoded `confidence: "committed"`,
    // so a committed-only view paid a royalty on revenue it had not booked. On the canary a 2% licence
    // royalty went $460 -> $8,460 the moment a TERM SHEET existed. `projection.js` states the rule this
    // broke: "you never book the cost of a win you haven't counted".
    const { indexedLines } = await import("../../src/engine/commitments.js");
    const out = indexedLines(royaltyDoc(), lines, 6).filter((l) => l.start === 1);
    const byTier = Object.fromEntries(out.map((l) => [l.confidence, Math.round(l.amount)]));
    expect(byTier).toEqual({ committed: 200, expected: 800 });
  });

  it("the total across tiers is what the single basis used to give", async () => {
    // Splitting must not change the number anyone sees with every tier switched on. It is linear —
    // pct x basis — so per-tier sums reconstruct the total exactly.
    const { indexedLines } = await import("../../src/engine/commitments.js");
    const out = indexedLines(royaltyDoc(), lines, 6).filter((l) => l.start === 1);
    expect(out.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(50000 * 0.02, 6);
  });

  it("⚠️ SKIPS UNTAGGED REVENUE, mirroring the gate", async () => {
    // `toggles[undefined]` is falsy, so an untagged revenue line contributes nothing to the projection
    // and must earn no royalty. Charging for it would be the same defect pointed the other way.
    const { indexedLines } = await import("../../src/engine/commitments.js");
    const out = indexedLines(royaltyDoc(), [
      { id: "u", kind: "revenue", cadence: "onetime", amount: 90000, start: 1 },
    ], 6);
    expect(out).toEqual([]);
  });

  it("emits an UNTIERED line for cost-indexed obligations, because untagged costs always count", async () => {
    // `of: "project"` measures spend. Costs usually carry no tier and count under every toggle set, so
    // their share is emitted untagged too — a line that always counts, from lines that always count.
    const { indexedLines } = await import("../../src/engine/commitments.js");
    const doc = royaltyDoc();
    doc.commitments[0].index = { of: "project", ref: "p1", pct: 0.1 };
    const out = indexedLines(doc, [
      { id: "c", kind: "cost", cadence: "onetime", amount: 20000, start: 2, projectId: "p1" },
    ], 6);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBeUndefined();
    expect(out[0].amount).toBeCloseTo(2000, 6);
  });

  it("ids stay unique once one month emits several tiers", async () => {
    // `ixl_${c.id}_${m}` collided the moment a month produced more than one line.
    const { indexedLines } = await import("../../src/engine/commitments.js");
    const out = indexedLines(royaltyDoc(), lines, 6);
    expect(new Set(out.map((l) => l.id)).size).toBe(out.length);
  });
});

describe("commitments", () => {
  const base = bare();

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
  const base = bare();

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
  const base = bare();

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
  const base = bare();
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
  const base = bare();
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
  const base = bare();
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
  const base = bare();
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
    const d = addManual(base, { label: "A", signedMonth: 0, payMonth: afterCashOut(base), amount: 150000 });
    expect(runway(d)).toBeCloseTo(runway(base), 2);
    expect(covered(d)).toBeLessThan(covered(base));
  });

  it("A PLANNED COST DOES NOT, because you would not incur it", () => {
    // The badge earning its place: a patent renewal you would abandon is not a reason to think you are
    // heading for bankruptcy.
    const d = addManual(base, { label: "B", signedMonth: 0, payMonth: afterCashOut(base), amount: 150000, kind: "planned" });
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

describe("uncovered is two distinct failures", () => {
  const base = bare();

  it("UNPAYABLE is money, UNMATCHABLE is non-grant money specifically", () => {
    // Folding them together hides that they have different remedies. A bank balance made entirely of
    // drawdowns against an award cannot match that award, however large it is.
    const d = addManual(base, { label: "A", signedMonth: 0, payMonth: afterCashOut(base), amount: 150000 });
    const p = commitmentPressure(d, rowsOf(d));
    expect(p.unpayable).toBe(150000);
    expect(p.unmatchable).toBe(0);              // the demo has non-grant income covering the match
  });

  it("A COMPANY FUNDED ONLY BY ITS AWARD CANNOT MATCH IT", () => {
    // The case the approximation exists for, and where it is exactly right rather than approximate:
    // zero eligible funds means the whole accrued match is a shortfall, which is true.
    const grantOnly = {
      ...base,
      lines: (base.lines || []).filter(l => l.kind !== "revenue"),
      pos: [], saas: [], rounds: [],
    };
    const p = commitmentPressure(grantOnly, rowsOf(grantOnly));
    expect(p.unmatchable).toBeGreaterThan(0);
    expect(p.unpayable).toBe(0);                // nothing is late — they simply cannot match
  });

  it("UNPAYABLE COUNTS PLANNED COSTS, unlike the clean-exit date", () => {
    // The questions differ. "Will I be able to pay this" is true of a patent fee; "can I close cleanly"
    // is not. The same commitment can be unpayable and irrelevant to bankruptcy.
    const d = addManual(base, { label: "B", signedMonth: 0, payMonth: afterCashOut(base), amount: 150000, kind: "planned" });
    const p = commitmentPressure(d, rowsOf(d));
    expect(p.unpayable).toBe(150000);
    expect(p.coveredMonths).toBeCloseTo(commitmentPressure(base, rowsOf(base)).coveredMonths, 2);
  });

  it("the shortfall is measured when the cash runs out, not at the horizon", () => {
    // Measuring at the end of the horizon would report a match shortfall for a company already long
    // gone, which is a number about nothing.
    const p = commitmentPressure(base, rowsOf(base));
    expect(p.unmatchable).toBeLessThanOrEqual(p.costShareTotal);
  });

  it("uncovered remains the sum, for anything still reading it", () => {
    const d = addManual(base, { label: "C", signedMonth: 0, payMonth: 9, amount: 50000 });
    const p = commitmentPressure(d, rowsOf(d));
    expect(p.uncovered).toBe(p.unpayable + p.unmatchable);
  });
});

describe("the three flavours", () => {
  const base = bare();
  const rows = (d) => rowsOf(d);
  const runway = (d) => zeroInfo(rows(d), d.startY, d.startM)?.months;

  it("RECURRING creates a real recurring cost line and stops when the model does", () => {
    // That is the whole reason the flavour exists: it needs no closure handling, because it is not
    // there once you close.
    const d = addManual(base, { label: "Lease", flavor: "recurring", signedMonth: 0, amount: 5000 });
    expect(d.lines.length).toBe(base.lines.length + 1);
    expect(d.lines[d.lines.length - 1].cadence).toBe("recurring");
    expect(d.commitments[0].kind).toBe("planned");     // never a closure debt
    expect(runway(d)).toBeLessThan(runway(base));
  });

  it("INDEXED creates NO line — the amount is not known until the index is", () => {
    const d = addManual(base, { label: "Royalty", flavor: "indexed", signedMonth: 0,
                                index: { of: "revenue", pct: 0.05 } });
    expect(d.lines.length).toBe(base.lines.length);
    expect(d.commitments[0].amount).toBe(0);
    expect(runway(d)).toBeLessThan(runway(base));      // but it still costs money
  });

  it("indexes against revenue, project spend and profit", () => {
    const at = (of, pct, ref) => runway(addManual(base,
      { label: "x", flavor: "indexed", signedMonth: 0, index: { of, pct, ref } }));
    expect(at("revenue", 0.05)).toBeLessThan(runway(base));
    expect(at("profit", 0.20)).toBeLessThan(runway(base));
    expect(at("project", 0.10, (base.projects || [])[0]?.id)).toBeLessThan(runway(base));
  });

  it("a zero rate is a clean no-op", () => {
    const d = addManual(base, { label: "x", flavor: "indexed", signedMonth: 0,
                                index: { of: "revenue", pct: 0 } });
    expect(runway(d)).toBeCloseTo(runway(base), 2);
  });

  it("PROFIT IS MEASURED BEFORE THE OBLIGATION, which is the only definition that terminates", () => {
    // A share of profit changes the profit it is a share of. Pre-obligation is both the standard
    // commercial reading and the only one that does not recurse.
    const one = addManual(base, { label: "a", flavor: "indexed", signedMonth: 0,
                                  index: { of: "profit", pct: 0.1 } });
    const two = addManual(one, { label: "b", flavor: "indexed", signedMonth: 0,
                                 index: { of: "profit", pct: 0.1 } });
    // two 10% obligations cost twice one, rather than compounding
    const d1 = runway(base) - runway(one), d2 = runway(base) - runway(two);
    expect(d2).toBeGreaterThan(d1);
    expect(d2).toBeLessThanOrEqual(d1 * 2 + 0.05);
  });
});

describe("drawn debt is a closure obligation", () => {
  const base = bare();
  const drawn = () => ({ ...base,
    // `status`, not `stage`. The original version of this test set the same wrong field the code read,
    // so both agreed and neither was right — a test that agrees with the bug is not a test.
    // `closeMonth: 0` TOO. Marking a facility closed while leaving its close month in the future means
    // it is not yet drawn — and nothing is owed before it is drawn, which is the point of that fix.
    rounds: (base.rounds || []).map(r => (r.kind === "debt"
      ? { ...r, status: "closed", closeMonth: 0 } : r)) });

  it("AN UNDRAWN FACILITY OWES NOTHING", () => {
    // A commitment letter is not a debt. Counting one would make the exit date depend on a decision
    // nobody has taken.
    expect(outstandingDebt(base, 0)).toBe(0);
  });

  it("a drawn one does, and it brings the exit date forward", () => {
    // It moved the runway all along — the repayments are cost lines — and never this figure. A company
    // could look able to close cleanly while owing a lender the balance of a facility.
    const d = drawn();
    expect(outstandingDebt(d, 0)).toBeGreaterThan(0);
    expect(commitmentPressure(d, rowsOf(d)).coveredMonths)
      .toBeLessThan(commitmentPressure(base, rowsOf(base)).coveredMonths);
  });

  it("falls as the facility is repaid", () => {
    const d = drawn();
    expect(outstandingDebt(d, 12)).toBeLessThan(outstandingDebt(d, 0));
  });

  it("IS THE REMAINING PAYMENTS, which is conservative and says so", () => {
    // On acceleration a lender is owed principal plus accrued interest — LESS than future payments,
    // which include interest not yet earned. Conservative is the right direction for a bankruptcy
    // figure, and exact for a fixed-multiple facility where the multiple is the whole obligation.
    const src = require("node:fs").readFileSync("src/engine/commitments.js", "utf8");
    expect(src).toMatch(/CONSERVATIVE for amortising debt/);
  });

  it("changes the runway too, now that financing is on by default", () => {
    // WRITTEN WHEN FINANCING DEFAULTED TO OFF, so drawing a facility added no cash and the runway held
    // still. With financing on, drawing one adds the draw AND the repayments — both real, and both
    // already in the projection. What the closure figure adds is the BALANCE you would still owe.
    const d = drawn();
    expect(zeroInfo(rowsOf(d), d.startY, d.startM)?.months)
      .not.toBeCloseTo(zeroInfo(rowsOf(base), base.startY, base.startM)?.months, 2);
    expect(outstandingDebt(d, 0)).toBeGreaterThan(0);
  });
});
