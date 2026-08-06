import { describe, it, expect } from "vitest";
import { monthsFromNow, zeroInfo } from "../../src/engine/projection.js";
import { commitmentPressure } from "../../src/engine/commitments.js";
import { buildProjection } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { demoDoc } from "../../src/state/document.js";

describe("months are measured from today, not from the model's start", () => {
  const today = new Date(2026, 5, 15);          // 15 June 2026

  it("counts forward from today", () => {
    expect(monthsFromNow(new Date(2026, 8, 15), today)).toBeCloseTo(3, 1);
    expect(monthsFromNow(new Date(2027, 5, 15), today)).toBeCloseTo(12, 1);
  });

  it("NEVER GOES NEGATIVE for a date already gone", () => {
    expect(monthsFromNow(new Date(2026, 0, 1), today)).toBe(0);
  });

  it("survives a bad date", () => {
    expect(monthsFromNow(null)).toBeNull();
    expect(monthsFromNow(new Date("nonsense"))).toBeNull();
  });

  it("`months` IS UNCHANGED, so the golden canary and internal comparisons still hold", () => {
    // The index from model start is what the projection walks and what every internal comparison uses.
    // Only the DISPLAYED figure changes — a person reading "5.6 mo" means from now.
    const rows = [{ m: 0, start: 100, end: 50 }, { m: 1, start: 50, end: -10 }];
    const z = zeroInfo(rows, 2026, 0);
    expect(z.months).toBeGreaterThan(1);         // index from start
    expect(z.fromNow).not.toBeUndefined();       // and a separate figure for display
  });
});

describe("the dashboard and the tab agree", () => {
  const d = () => ({ ...demoDoc(), rounds: [{ id: "vd", name: "F", kind: "debt", status: "closed",
    amount: 800000, closeMonth: 0, termMonths: 36, rateAPR: 12 }] });
  const rowsOf = (x) => buildProjection(buildModelFromDoc(x), x.settings?.toggles || {});

  it("THE SAME TOGGLES PRODUCE THE SAME DATE", () => {
    // The dashboard called `commitmentPressure(doc, rows)` with no options, so it always counted debt
    // while the Commitments tab honoured `settings.exitCounts*`. Two screens, one figure, two dates —
    // worse than either being wrong, because both looked authoritative.
    const off = { ...d(), settings: { ...d().settings, exitCountsVentureDebt: false } };
    const opts = {
      withVentureDebt: off.settings.exitCountsVentureDebt !== false,
      withNoteDebt: off.settings.exitCountsNoteDebt !== false,
    };
    const tab = commitmentPressure(off, rowsOf(off), opts);
    const dash = commitmentPressure(off, rowsOf(off), opts);
    expect(dash.coveredMonths).toBe(tab.coveredMonths);
    expect(dash.withVentureDebt).toBe(false);
  });

  it("and the dashboard reads the setting rather than defaulting", () => {
    const src = require("node:fs").readFileSync("src/App.jsx", "utf8");
    expect(src).toMatch(/exitCountsVentureDebt !== false/);
    expect(src).toMatch(/exitCountsNoteDebt !== false/);
  });
});
