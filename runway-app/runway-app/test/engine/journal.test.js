// The projection journal records what the forecast SAID, so later it can be compared to what happened.
// Phase 1 is the recorder only — these tests pin the digest shape, the weekly cadence, and the
// plan-change signal the weekly cadence exists to preserve.
import { describe, it, expect } from "vitest";
import {
  makeSnapshot, dueForSnapshot, appendSnapshot, removeSnapshot, worthSnapshotting,
  forecastAt, planDelta, zeroOfCurve, monthIndexAt, sortedJournal, JOURNAL_CAP,
} from "../../src/engine";

const rowsOf = (starts) => starts.map((s, i) => ({
  m: i, start: s, end: starts[i + 1] ?? s, rev: 0, cost: 0, net: 0,
}));
const T = { committed: true, expected: true, speculative: false, financing: false };
const snapOf = (starts, when, extra = {}) => makeSnapshot({
  rows: rowsOf(starts), toggles: T, cash: starts[0], startY: 2026, startM: 6,
  now: new Date(when), ...extra,
});

describe("a snapshot is a self-contained digest of what was predicted", () => {
  it("stores the curve, the toggles it was made under, and the predicted crossing", () => {
    const s = snapOf([100000, 75000, 50000, 25000, -5000], "2026-07-15T12:00:00Z");
    expect(s.curve).toEqual([100000, 75000, 50000, 25000, -5000]);
    expect(s.toggles).toEqual(T);            // comparing like with like in Phase 2 depends on this
    expect(s.zeroMonths).toBeCloseTo(3.83, 1);
    expect(s.id).toBeTruthy();
    expect(s.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rounds to whole dollars — no float noise, smaller documents", () => {
    const s = makeSnapshot({ rows: [{ start: 1234.567, end: 1000.4 }], toggles: T, cash: 1234.567,
      startY: 2026, startM: 6, now: new Date("2026-07-01T00:00:00Z") });
    expect(s.curve).toEqual([1235]);
    expect(s.cash).toBe(1235);
  });

  it("records which projection month it was taken in, so lead time is recoverable later", () => {
    // projection starts July 2026; a snapshot taken that October is month 3
    const s = snapOf([100000, 90000], "2026-10-09T12:00:00Z");
    expect(s.atMonth).toBe(3);
    expect(monthIndexAt(new Date("2027-01-09T12:00:00Z"), 2026, 6)).toBe(6);
  });
});

describe("zeroOfCurve", () => {
  it("interpolates within the month it crosses", () => {
    expect(zeroOfCurve([100, 50, -50])).toBeCloseTo(1.5, 2);
  });
  it("is null when the curve never runs dry", () => {
    expect(zeroOfCurve([100, 120, 140])).toBeNull();
  });
  it("is 0 when it starts at or below zero", () => {
    expect(zeroOfCurve([0, 10])).toBe(0);
    expect(zeroOfCurve([-5, 10])).toBe(0);
  });
});

describe("weekly cadence", () => {
  const s = snapOf([100000, 90000], "2026-07-01T00:00:00Z");
  it("an empty journal is always due — the clock starts on first use", () => {
    expect(dueForSnapshot([], new Date("2026-07-01T00:00:00Z"))).toBe(true);
  });
  it("is not due again the same day", () => {
    expect(dueForSnapshot([s], new Date("2026-07-01T18:00:00Z"))).toBe(false);
  });
  it("is not due at six days, is due at seven", () => {
    expect(dueForSnapshot([s], new Date("2026-07-07T00:00:00Z"))).toBe(false);
    expect(dueForSnapshot([s], new Date("2026-07-08T00:00:00Z"))).toBe(true);
  });
  it("measures from the LATEST entry, not the first", () => {
    const older = snapOf([100000], "2026-06-01T00:00:00Z");
    expect(dueForSnapshot([older, s], new Date("2026-07-03T00:00:00Z"))).toBe(false);
  });
});

describe("what is worth recording", () => {
  it("an empty document is not — zeroes would poison the statistics later", () => {
    expect(worthSnapshotting({ cash: 0, rows: rowsOf([0, 0, 0]) })).toBe(false);
  });
  it("cash on hand is enough to be worth recording", () => {
    expect(worthSnapshotting({ cash: 100000, rows: rowsOf([100000]) })).toBe(true);
  });
  it("so is activity with no cash", () => {
    expect(worthSnapshotting({ cash: 0, rows: [{ start: 0, end: 0, cost: 5000, rev: 0 }] })).toBe(true);
  });
});

describe("the journal is append-only and bounded", () => {
  it("appends", () => {
    const a = snapOf([100000], "2026-07-01T00:00:00Z");
    const b = snapOf([90000], "2026-07-08T00:00:00Z");
    expect(appendSnapshot(appendSnapshot([], a), b).map(s => s.curve[0])).toEqual([100000, 90000]);
  });
  it("drops the oldest past the cap rather than growing without bound", () => {
    let j = [];
    for (let i = 0; i < JOURNAL_CAP + 5; i++) j = appendSnapshot(j, snapOf([i], "2026-07-01T00:00:00Z"));
    expect(j.length).toBe(JOURNAL_CAP);
    expect(j[0].curve[0]).toBe(5);        // the first five fell off the front
  });
  it("can drop a single entry by id", () => {
    const a = snapOf([1], "2026-07-01T00:00:00Z"), b = snapOf([2], "2026-07-08T00:00:00Z");
    expect(removeSnapshot([a, b], a.id)).toEqual([b]);
  });
  it("sorts newest first for display", () => {
    const a = snapOf([1], "2026-07-01T00:00:00Z"), b = snapOf([2], "2026-07-08T00:00:00Z");
    expect(sortedJournal([a, b])[0].takenAt).toBe(b.takenAt);
  });
});

describe("forecastAt", () => {
  const s = snapOf([100000, 75000, 50000], "2026-07-01T00:00:00Z");
  it("returns what was predicted for a month it covered", () => {
    expect(forecastAt(s, 1)).toBe(75000);
  });
  it("returns null beyond the horizon it could see", () => {
    expect(forecastAt(s, 9)).toBeNull();
  });
});

describe("planDelta separates a plan change from a forecast miss", () => {
  it("a big move across a few days is the PLAN moving — reality does not move that fast", () => {
    const before = snapOf([100000, 90000, 80000, 70000], "2026-07-01T00:00:00Z");
    const after = snapOf([100000, 90000, 40000, 10000], "2026-07-03T00:00:00Z");  // hired someone
    const d = planDelta(before, after);
    expect(d.days).toBeCloseTo(2, 1);
    expect(d.maxAbs).toBe(60000);        // large delta, tiny elapsed time => the plan changed
  });
  it("an unchanged plan shows no delta", () => {
    const a = snapOf([100000, 90000, 80000], "2026-07-01T00:00:00Z");
    const b = snapOf([100000, 90000, 80000], "2026-07-08T00:00:00Z");
    expect(planDelta(a, b).maxAbs).toBe(0);
  });
});
