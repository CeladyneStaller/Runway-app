import { describe, it, expect } from "vitest";

describe("⚠️ instConf — one status spine, four kinds, four different documents", () => {
  it("a SIGNED safe or note is a contract, not a term sheet", async () => {
    // At status `committed` the labels read: equity "Term sheet", safe/note "Signed", debt "Commitment
    // letter". All four mapped to `expected`, which put a BINDING CONTRACT in the same tier as a
    // non-binding term sheet. The rule is: a contract or money in the bank is committed.
    const { instConf } = await import("../../src/engine/capital.js");
    expect(instConf({ kind: "safe", status: "committed" })).toBe("committed");
    expect(instConf({ kind: "note", status: "committed" })).toBe("committed");
  });

  it("⚠️ AND EQUITY AND DEBT DELIBERATELY DO NOT MOVE", async () => {
    // Equity: a term sheet is non-binding and dies in diligence.
    // Debt: a commitment letter binds the lender only SUBJECT TO CONDITIONS PRECEDENT — no material
    // adverse change, covenant compliance, often a final diligence pass. More than a term sheet, less
    // than money in the bank, and the spine has no state for it. Leaving it at `expected` FOLLOWS the
    // rule rather than excepting it: conditions you have not satisfied are not a contract you can spend.
    const { instConf } = await import("../../src/engine/capital.js");
    expect(instConf({ kind: "equity", status: "committed" })).toBe("expected");
    expect(instConf({ kind: "debt", status: "committed" })).toBe("expected");
  });

  it("every other status is untouched, for every kind", async () => {
    const { instConf } = await import("../../src/engine/capital.js");
    for (const kind of ["equity", "safe", "note", "debt"]) {
      expect(instConf({ kind, status: "closed" }), kind).toBe("committed");
      expect(instConf({ kind, status: "planning" }), kind).toBe("speculative");
      expect(instConf({ kind, status: "raising" }), kind).toBe("speculative");
    }
  });

  it("a manual pin still overrides the default, and unknown kinds fall back", async () => {
    // `confAuto === false` is the escape hatch Investment.jsx renders a control for — it exists for
    // exactly the cases a per-kind default gets wrong, and must keep winning.
    const { instConf } = await import("../../src/engine/capital.js");
    expect(instConf({ kind: "safe", status: "committed", confAuto: false, confidence: "speculative" }))
      .toBe("speculative");
    expect(instConf({ kind: "whatever", status: "committed" })).toBe("expected");
    expect(instConf({ status: "committed" })).toBe("expected");
  });
});

describe("⚠️ every instrument gets a close milestone, not just equity", () => {
  it("includes SAFEs, notes and debt", async () => {
    // A SAFE closing in month 9 used to put cash in the projection with **no marker on the chart** —
    // and a SAFE close is as much a date to work toward as a priced round, usually the nearer one.
    const { roundMS } = await import("../../src/engine/capital.js");
    const rounds = [
      { id: "a", kind: "equity", name: "Series A", status: "planning", closeMonth: 9 },
      { id: "b", kind: "safe", name: "Seed SAFE", status: "raising", closeMonth: 4 },
      { id: "c", kind: "debt", name: "Facility", status: "planning", closeMonth: 12 },
    ];
    expect(roundMS(rounds, 2026, 7).map(m => m.label))
      .toEqual(["Series A close", "Seed SAFE close", "Facility close"]);
  });

  it("still excludes closed rounds and undated ones", async () => {
    // A milestone is a date you are working toward: a closed round is history, and one with no
    // `closeMonth` has nowhere to sit.
    const { roundMS } = await import("../../src/engine/capital.js");
    const rounds = [
      { id: "d", kind: "safe", name: "Old", status: "closed", closeMonth: -18 },
      { id: "e", kind: "equity", name: "Undated", status: "planning", closeMonth: null },
    ];
    expect(roundMS(rounds, 2026, 7)).toHaveLength(0);
  });

  it("⚠️ CARRIES NO CASH TARGET, so widening the filter changes no threshold", async () => {
    // `msTarget` returns 0 for these and `msPass` is true at any non-negative balance — they are
    // dates, not thresholds. **That is why adding more of them is safe.**
    const { roundMS, msTarget, msPass } = await import("../../src/engine/capital.js");
    const [ms] = roundMS([{ id: "a", kind: "safe", name: "S", status: "planning", closeMonth: 3 }],
                         2026, 7);
    expect(msTarget(ms)).toBe(0);
    expect(msPass(0, ms)).toBe(true);
    expect(msPass(-1, ms)).toBe(false);
  });
});
