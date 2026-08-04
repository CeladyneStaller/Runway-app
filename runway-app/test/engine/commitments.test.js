import { describe, it, expect } from "vitest";
import { commitmentPressure, promote, addManual, promotable, removeCommitment, markPaid,
         costShareCommitments }
  from "../../src/engine/commitments.js";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { demoDoc } from "../../src/state/document.js";

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
