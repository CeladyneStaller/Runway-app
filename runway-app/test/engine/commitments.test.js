import { describe, it, expect } from "vitest";
import { commitmentPressure, promote, addManual, promotable, removeCommitment, markPaid }
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
    const d = addManual(base, { label: "Late", signedMonth: 0, payMonth: 7, amount: 188000 });
    const p = commitmentPressure(d, rowsOf(d));
    expect(p.uncovered).toBe(188000);
    expect(p.rows[0].covered).toBe(false);
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
    // The common case, and the one where this must cost nothing and change nothing.
    expect(commitmentPressure(base, rowsOf(base))).toBeNull();
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
    expect(commitmentPressure(paid, rowsOf(paid))).toBeNull();
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
