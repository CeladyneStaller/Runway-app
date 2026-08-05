import { describe, it, expect } from "vitest";
import { commitmentPressure, outstandingDebt, royaltyCommitments } from "../../src/engine/commitments.js";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { demoDoc } from "../../src/state/document.js";

const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
const bare = () => {
  const d = demoDoc();
  return { ...d, commitments: [], rounds: [],
           lines: (d.lines || []).filter(l => !String(l.id).startsWith("l_demo_")) };
};
const withNote = (o) => ({ ...bare(), rounds: [{
  id: "n1", name: "2025 note", kind: "note", status: "closed", amount: 500000,
  closeMonth: 0, maturityMonths: 24, ...o }] });

describe("a convertible note", () => {
  it("REPAYING AT MATURITY IS A CLOSURE OBLIGATION", () => {
    // Principal plus accrued, due on a date, owed whether or not you close — and counted nowhere,
    // because `outstandingDebt` only looked at `kind === "debt"`. A convertible that CONVERTS owes
    // nothing; one that REPAYS owes everything.
    const d = withNote({ atMaturity: "repay" });
    expect(outstandingDebt(d, 0)).toBeGreaterThanOrEqual(500000);
  });

  it("that CONVERTS owes nothing", () => {
    expect(outstandingDebt(withNote({ atMaturity: "convert" }), 0)).toBe(0);
  });

  it("that has already matured owes nothing more", () => {
    // Past maturity the cash has moved and the projection has it.
    const d = withNote({ atMaturity: "repay", maturityMonths: 6 });
    expect(outstandingDebt(d, 12)).toBe(0);
  });

  it("assumed extended owes nothing yet", () => {
    expect(outstandingDebt(withNote({ atMaturity: "repay", assumeExtended: true }), 0)).toBe(0);
  });
});

describe("a royalty note", () => {
  const roy = withNote({ atMaturity: "royalty", royaltyPct: 0.04, capMultiple: 3 });

  it("becomes an INDEXED commitment", () => {
    const rc = royaltyCommitments(roy);
    expect(rc).toHaveLength(1);
    expect(rc[0].flavor).toBe("indexed");
    expect(rc[0].index.pct).toBe(0.04);
  });

  it("DOES NOT AFFECT THE CLEAN-EXIT DATE, and that is correct rather than convenient", () => {
    // A royalty is paid out of revenue you are earning. Stop trading and there is no revenue and
    // nothing further owed — unlike a maturity repayment, walking away discharges it.
    // MEASURED AS THE GAP, not as the date. A royalty costs cash, so it lowers the balance and the exit
    // date moves with the runway — that is unavoidable and correct. What matters is that it adds no
    // CLOSURE OBLIGATION: the distance between "cash runs out" and "cannot close cleanly" is unchanged.
    //
    // My first version asserted the date itself and failed, which was the test being wrong rather than
    // the code — an indexed obligation that costs money must move every downstream number.
    const gap = (d) => {
      const r = rowsOf(d);
      return (zeroInfo(r, d.startY, d.startM)?.months ?? 0)
           - (commitmentPressure(d, r)?.coveredMonths ?? 0);
    };
    expect(gap(roy)).toBeCloseTo(gap(bare()), 1);
  });

  it("still costs money, so it shortens the runway", () => {
    expect(zeroInfo(rowsOf(roy), roy.startY, roy.startM)?.months)
      .toBeLessThan(zeroInfo(rowsOf(bare()), bare().startY, bare().startM)?.months);
  });

  it("carries its cap, so the tab need not imply it runs forever", () => {
    expect(royaltyCommitments(roy)[0].cap).toBe(1500000);   // 500k x 3
  });
});

describe("the drawn-debt toggle", () => {
  const d = withNote({ atMaturity: "repay" });

  it("counts debt by default", () => {
    const on = commitmentPressure(d, rowsOf(d), { withDebt: true });
    const off = commitmentPressure(d, rowsOf(d), { withDebt: false });
    expect(commitmentPressure(d, rowsOf(d)).coveredMonths).toBe(on.coveredMonths);
    expect(off.coveredMonths).toBeGreaterThanOrEqual(on.coveredMonths);
  });

  it("EXCLUDING IT ANSWERS A DIFFERENT QUESTION", () => {
    // A facility can dwarf everything else, and then the exit date says only "you owe a bank". Taking
    // it out shows the timeline for settling everybody ELSE, which is also worth knowing.
    const off = commitmentPressure(d, rowsOf(d), { withDebt: false });
    expect(off.withDebt).toBe(false);
    expect(off.debtTotal).toBe(commitmentPressure(d, rowsOf(d)).debtTotal);   // still reported
  });
});
