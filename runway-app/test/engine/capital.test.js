import { describe, it, expect } from "vitest";

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
