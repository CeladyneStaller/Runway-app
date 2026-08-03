import { describe, it, expect } from "vitest";
import { advisorTiles, TILES } from "../../src/engine/advisor.js";
import { buildModelParts, buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { buildProjection } from "../../src/engine/projection.js";
import { demoDoc } from "../../src/state/document.js";

const ctx = (doc) => {
  const p = buildModelParts(doc);
  return { ...p, rows: buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {}) };
};

describe("advisor tiles", () => {
  const doc = demoDoc();
  const tiles = advisorTiles(doc, ctx(doc));
  const byView = Object.fromEntries(tiles.map(t => [t.view, t]));

  it("builds a tile for every tab that applies", () => {
    expect(tiles.length).toBeGreaterThan(3);
    for (const t of tiles) {
      expect(t.view).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.tone).toBeTruthy();
      expect(t.sub, `${t.view} has no supporting line`).toBeTruthy();
    }
  });

  it("REPORTS PAYROLL AS A REAL FIGURE, not a plausible zero", () => {
    // THE BUG THIS CAUGHT. The first version summed `l.amounts[0]` across `employeeLines`, and those
    // lines carry a flat `amount` with no per-month array — so every payroll tile read
    // "0k/mo · 0% of burn". Nothing failed; the tile simply lied, which is worse than an error.
    expect(byView.pay).toBeTruthy();
    expect(byView.pay.value).toBeGreaterThan(0);
    expect(byView.pay.sub).not.toMatch(/^0k\/mo/);
    expect(byView.pay.sub).toMatch(/\d+k\/mo · \d+% of burn/);
  });

  it("omits a tile rather than showing a zero for what a company does not have", () => {
    // Absent and zero are different statements. A company with no SaaS revenue has no MRR, which is
    // not the same as MRR of nothing.
    const bare = { ...demoDoc(), saas: [], rounds: [], employees: [] };
    const views = advisorTiles(bare, ctx(bare)).map(t => t.view);
    expect(views).not.toContain("sales");
    expect(views).not.toContain("inv");
    expect(views).not.toContain("pay");
  });

  it("does not open a door into a room the company closed", () => {
    // `company_tabs` and the role gate already decide visibility for every other surface; this reads
    // them rather than keeping its own list.
    const views = advisorTiles(doc, ctx(doc), { hidden: ["proj", "inv"] }).map(t => t.view);
    expect(views).not.toContain("proj");
    expect(views).not.toContain("inv");
  });

  it("respects a role gate as well as company settings", () => {
    const views = advisorTiles(doc, ctx(doc), { canSee: (v) => v !== "pay" }).map(t => t.view);
    expect(views).not.toContain("pay");
  });

  it("says when a round closes after the cash runs out", () => {
    // The same question the investment goals chart asks, and the one that matters most about a round.
    expect(byView.inv?.sub).toMatch(/closes after the cash|mo left at close/);
  });

  it("never throws on a broken or empty client model", () => {
    // One bad model must not take down a portfolio of twenty.
    expect(() => advisorTiles(null, null)).not.toThrow();
    expect(() => advisorTiles({}, {})).not.toThrow();
    expect(() => advisorTiles({ employees: [{}], rounds: [{}], saas: [{}] }, {})).not.toThrow();
    expect(advisorTiles(null, null)).toEqual([]);
  });

  it("keeps its tiles in the rail's order", () => {
    // So an advisor's eye lands where it does everywhere else in the product.
    const order = TILES.map(t => t.view);
    const got = tiles.map(t => t.view);
    expect(got).toEqual(order.filter(v => got.includes(v)));
  });

  it("distinguishes 'not loaded' from 'none' for scenarios", () => {
    // `myScenarios` absent means nobody has fetched them; an empty array means the advisor has none.
    // A tile reading "0 scenarios" before the fetch returns is a lie with a short shelf life.
    expect(advisorTiles(doc, ctx(doc)).map(t => t.view)).not.toContain("scn");
    const withNone = advisorTiles(doc, { ...ctx(doc), myScenarios: [] });
    expect(withNone.find(t => t.view === "scn")?.value).toBe(0);
  });
});
