import { describe, it, expect } from "vitest";
import { royaltyVerdict } from "../../src/engine/capital.js";
import { commitmentPressure, outstandingDebt, royaltyCommitments } from "../../src/engine/commitments.js";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { canaryDoc as demoDoc } from "../../src/state/document.js";

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
    // `withDebt` BECAME TWO TOGGLES — venture and note — because a lender with a security interest is
    // not a noteholder, and a founder asking "could I settle everyone else" usually means one of them.
    const on = commitmentPressure(d, rowsOf(d), { withNoteDebt: true });
    const off = commitmentPressure(d, rowsOf(d), { withNoteDebt: false });
    expect(commitmentPressure(d, rowsOf(d)).coveredMonths).toBe(on.coveredMonths);
    expect(off.coveredMonths).toBeGreaterThanOrEqual(on.coveredMonths);
  });

  it("EXCLUDING IT ANSWERS A DIFFERENT QUESTION", () => {
    // A facility can dwarf everything else, and then the exit date says only "you owe a bank". Taking
    // it out shows the timeline for settling everybody ELSE, which is also worth knowing.
    const off = commitmentPressure(d, rowsOf(d), { withNoteDebt: false });
    expect(off.withNoteDebt).toBe(false);
    expect(off.debtTotal).toBe(commitmentPressure(d, rowsOf(d)).debtTotal);   // still reported
  });
});

describe("when a royalty actually starts", () => {

  const rows = Array.from({ length: 36 }, () => ({ rev: 100000 }));

  it("A TRIGGER OF ZERO FIRES IMMEDIATELY, not never", () => {
    // THE BUG. The guard was `cum >= trig && trig > 0`, so a note with no threshold — the common case,
    // and the most aggressive terms — reported that the trigger never fires. The app then printed "the
    // obligation is real and it is not in this picture" about an obligation that starts on the first
    // dollar, which is the opposite of the truth.
    const v = royaltyVerdict({ kind: "note", atMaturity: "royalty", amount: 500000,
                               triggerAmount: 0, capMultiple: 4 }, rows);
    expect(v.fires).toBe(0);
  });

  it("a real threshold fires when cumulative revenue reaches it", () => {
    const v = royaltyVerdict({ kind: "note", atMaturity: "royalty", amount: 500000,
                               triggerAmount: 250000, capMultiple: 4 }, rows);
    expect(v.fires).toBe(2);          // 100k a month, so month index 2 crosses 250k
  });

  it("never fires when the horizon does not reach the threshold", () => {
    const v = royaltyVerdict({ kind: "note", atMaturity: "royalty", amount: 500000,
                               triggerAmount: 99000000, capMultiple: 4 }, rows);
    expect(v.fires).toBeNull();
    expect(v.cum).toBe(3600000);      // and the copy can name what this number IS
  });

  it("reports the horizon it measured over, so the sentence can say so", () => {
    const v = royaltyVerdict({ kind: "note", atMaturity: "royalty", amount: 1,
                               triggerAmount: 99000000 }, rows);
    expect(v.months).toBe(36);
  });
});

describe("everything counted is also shown", () => {
  // TWICE NOW I HAVE COUNTED AN OBLIGATION AND LISTED IT NOWHERE — first drawn debt, then notes. A
  // figure that moves a headline number and appears on no screen is one people stop believing, so this
  // asserts the invariant directly rather than trusting the next addition to remember it.
  const rowsOf2 = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
  const base = () => {
    const d = demoDoc();
    return { ...d, commitments: [], rounds: [],
             lines: (d.lines || []).filter(l => !String(l.id).startsWith("l_demo_")) };
  };
  const withRound = (r) => ({ ...base(), rounds: [{ id: "r1", name: "Note", kind: "note",
    status: "closed", amount: 500000, closeMonth: 0, maturityMonths: 24, ...r }] });

  it("a note repaying at maturity is LISTED, not just counted", () => {
    const d = withRound({ atMaturity: "repay" });
    const p = commitmentPressure(d, rowsOf2(d));
    expect(p.debt.length).toBe(1);
    expect(p.debt[0].what).toBe("repaid at maturity");
    expect(p.debtTotal).toBeGreaterThan(0);
  });

  it("a royalty note is listed with its rate and cap", () => {
    const d = withRound({ atMaturity: "royalty", royaltyPct: 0.05, capMultiple: 4 });
    const p = commitmentPressure(d, rowsOf2(d));
    expect(p.royalties).toHaveLength(1);
    expect(p.royalties[0].pct).toBe(0.05);
    expect(p.royalties[0].cap).toBe(2000000);
  });

  it("a converting note appears in neither, because it owes nothing", () => {
    const d = withRound({ atMaturity: "convert" });
    const p = commitmentPressure(d, rowsOf2(d));
    expect(p.debt).toHaveLength(0);
    expect(p.royalties).toHaveLength(0);
  });

  it("WHATEVER THE CLOSURE FIGURE COUNTS, THE TAB SHOWS", () => {
    // The invariant, asserted as one: if `outstandingDebt` is non-zero, something is listed.
    for (const r of [{ atMaturity: "repay" }, { kind: "debt", atMaturity: undefined }]) {
      const d = withRound(r);
      const owed = outstandingDebt(d, 0);
      const p = commitmentPressure(d, rowsOf2(d));
      if (owed > 0) expect(p.debt.length, JSON.stringify(r)).toBeGreaterThan(0);
    }
  });
});
