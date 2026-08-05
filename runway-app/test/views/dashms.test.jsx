import { describe, it, expect } from "vitest";
import { solvency } from "../../src/engine/projection";

describe("a milestone reached after insolvency", () => {
  // THE DASHBOARD BUG. `pass` asks whether the balance is positive ON THE DAY. It says nothing about
  // whether the company survives to see it — so a projection that dips below zero in January and
  // recovers by March, because a milestone payment lands, showed a healthy balance and a tick.
  //
  // The Milestones tab has asked both questions since the false-green audit. The dashboard was still
  // asking the easier one.
  const rows = [
    { m: 0, start: 100, end: 60 }, { m: 1, start: 60, end: -40 },
    { m: 2, start: -40, end: -90 }, { m: 3, start: -90, end: 120 },
    { m: 4, start: 120, end: 100 },
  ];
  const s = solvency(rows);

  it("is STRANDED even though the balance on the day is positive", () => {
    expect(rows[3].end).toBeGreaterThan(0);      // looks fine
    expect(s.strandedAt(3)).toBe(true);          // and is not
  });

  it("names the bridge that would reach it", () => {
    // "You cannot get there" is a dead end. "You need this much to get there" is the next thing to do,
    // and it is the deepest deficit BEFORE the date, not the global worst.
    expect(s.bridgeTo(3)).toBeGreaterThan(0);
    expect(s.bridgeTo(3)).toBeCloseTo(90, 0);
  });

  it("a milestone before the dip is not stranded", () => {
    expect(s.strandedAt(0)).toBe(false);
    expect(s.bridgeTo(0)).toBe(0);
  });

  it("the dashboard reads both, not just pass", () => {
    const src = require("node:fs").readFileSync("src/App.jsx", "utf8");
    const tile = src.slice(src.indexOf("Next milestone") - 1400, src.indexOf("Next milestone") + 900);
    expect(tile).toMatch(/nextMs\.stranded/);
    expect(tile).toMatch(/nextMs\.bridge/);
  });
});
