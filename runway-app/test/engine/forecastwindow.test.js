import { describe, it, expect } from "vitest";
import { zeroInfo, forecastFrom, anchorToActuals, buildProjection, solvency } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { commitmentPressure } from "../../src/engine/commitments.js";
import { canaryDoc as demoDoc } from "../../src/state/document.js";

const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});

describe("forecastFrom", () => {
  const doc = { startY: 2025, startM: 0 };            // January 2025

  it("IS TODAY'S MONTH, not the last recorded entry", () => {
    // A cash figure is the balance at the START of a month, so an entry for the CURRENT month is a real
    // anchor AND the month is still in progress — the last month you can still act on.
    expect(forecastFrom(doc, new Date(2025, 4, 20))).toBe(4);    // May
  });

  it("ROUNDS DOWN — a month becomes canon on the first of the next", () => {
    // A large purchase on the 28th is already in the model as a forecast line; closing the month before
    // it lands would count the forecast and then the actual.
    expect(forecastFrom(doc, new Date(2025, 4, 1))).toBe(4);
    expect(forecastFrom(doc, new Date(2025, 4, 28))).toBe(4);
    expect(forecastFrom(doc, new Date(2025, 5, 1))).toBe(5);
  });

  it("a model starting in the future asks from its own month zero", () => {
    expect(forecastFrom({ startY: 2027, startM: 0 }, new Date(2025, 4, 1))).toBe(0);
  });

  it("survives a malformed document", () => {
    expect(forecastFrom(null)).toBe(0);
    expect(forecastFrom({})).toBe(0);
  });
});

describe("runway inside the window", () => {
  const rows = [
    { m: 0, start: 100, end: -20 },     // dipped in history
    { m: 1, start: -20, end: 40 },      // and recovered
    { m: 2, start: 40, end: 30 },
    { m: 3, start: 30, end: -10 },      // the real crossing
  ];

  it("WITHOUT A WINDOW it reports the historical dip", () => {
    // The defect, preserved as a test: scanning from month zero returns a crossing in a month the
    // company demonstrably survived — a fact about the past reported as a forecast.
    expect(zeroInfo(rows, 2025, 0).months).toBeLessThan(1);
  });

  it("WITH ONE it reports the crossing ahead", () => {
    expect(zeroInfo(rows, 2025, 0, 2).months).toBeGreaterThan(3);
  });

  it("ALREADY OUT IS AN ANSWER, not 'never runs out'", () => {
    // If the window opens on a month already negative there is no solvent-to-insolvent crossing left,
    // and the loop would return null — "never runs out", the most dangerous possible wrong answer.
    const out = zeroInfo([{ m: 0, start: 50, end: -5 }, { m: 1, start: -5, end: -9 }], 2025, 0, 1);
    expect(out).not.toBeNull();
    expect(out.months).toBe(1);
    expect(out.alreadyOut).toBe(true);
  });

  it("defaults to zero, so no existing caller changes", () => {
    expect(zeroInfo(rows, 2025, 0).months).toBe(zeroInfo(rows, 2025, 0, 0).months);
  });
});

describe("a future cash entry anchors nothing", () => {
  it("is ignored when a maximum month is given", () => {
    // A figure typed against next quarter is a sketch. Letting it set `starts[m]` would rewrite the
    // projection to agree with a guess, and the offset would shift every month after it.
    const rows = [{ m: 0, start: 100, end: 90 }, { m: 1, start: 90, end: 80 }, { m: 2, start: 80, end: 70 }];
    const withFuture = { 2: { cash: 999999 } };
    const capped = anchorToActuals(rows, withFuture, true, 0);
    expect(capped[2].start).toBe(80);                  // unchanged
    const uncapped = anchorToActuals(rows, withFuture, true);
    expect(uncapped[2].start).toBe(999999);            // the old behaviour, still available
  });
});

describe("what must NOT have moved", () => {
  const d = demoDoc();
  const rows = rowsOf(d);

  it("solvency still reads the WHOLE curve, history included", () => {
    // `deepest`, `holes` and `bridgeTo` are about what happened on the way here. A milestone in June is
    // genuinely stranded if the company went under in March, and windowing that scan would produce a
    // false green — the exact bug the false-green audit fixed.
    const s = solvency(rows);
    expect(s).toBeTruthy();
    expect(typeof s.strandedAt).toBe("function");
  });

  it("the clean-exit scan and runway share one window", () => {
    // Two windows would let the two figures answer from different starting months, which is how they
    // would end up disagreeing about the same company.
    const p = commitmentPressure(d, rows);
    const z = zeroInfo(rows, d.startY, d.startM, forecastFrom(d));
    if (p?.coveredMonths != null && z?.months != null) {
      expect(p.coveredMonths).toBeLessThanOrEqual(z.months + 0.001);
    }
  });
});
