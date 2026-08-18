import { describe, it, expect } from "vitest";
import { ARCHETYPES, archetypeById } from "../../src/state/archetypes.js";
import { demoDoc, canaryDoc } from "../../src/state/document.js";

describe("⚠️ four demo companies, and a canary that is not one of them", () => {
  it("KEEPS THE ORIGINAL DEMO OUT OF THE PICKER", () => {
    // It is the golden canary — a known runway figure at known toggle settings, used as the regression
    // check through every change. **Listing it would let somebody edit it into a different sanity
    // check**, which is the one thing it cannot survive.
    expect(canaryDoc().name).toBe("Demo Company");
    expect(ARCHETYPES.map(a => a.company)).not.toContain("Demo Company");
    expect(ARCHETYPES.map(a => a.id)).not.toContain("canary");
  });

  it("builds all four", () => {
    expect(ARCHETYPES).toHaveLength(4);
    for (const a of ARCHETYPES) {
      const d = a.build();
      expect(d.name, a.id).toBeTruthy();
      expect(d.cash, a.id).toBeGreaterThan(0);
      expect(d.employees.length, a.id).toBeGreaterThan(0);
    }
  });

  it("⚠️ EACH SHOWS A MECHANIC THE OTHERS DO NOT", () => {
    // The test for a demo is not "is this realistic" but "does this show something no other sample
    // shows". A mechanic no demo demonstrates is a mechanic nobody discovers.
    const by = (id) => archetypeById(id).build();
    const grants = (d) => d.projects.filter(p => p.type === "grant").map(p => p.grant);

    // arrears with a real lag, and a proposal that is NOT assumed funded
    const rg = grants(by("grant-startup"));
    expect(rg.some(g => g.reimburseTiming === "arrears" && g.reimburseLagMonths >= 2)).toBe(true);
    expect(rg.some(g => g.assumeFunded === false)).toBe(true);
    expect(rg.some(g => g.costShareType === "cash" && g.costSharePct > 0)).toBe(true);

    // orders with terms and a deposit; a closed round and a prior instrument
    const ks = by("hardware-vc");
    expect(ks.pos.some(p => p.termsDays >= 60)).toBe(true);
    expect(ks.pos.some(p => p.depositPct > 0)).toBe(true);
    expect(ks.rounds.filter(r => r.status === "closed")).toHaveLength(2);

    // milestone billing, an advance, and in-kind cost share — all three, nowhere else
    const tw = grants(by("nonprofit"));
    expect(tw.some(g => g.reimburseTiming === "milestone")).toBe(true);
    expect(tw.some(g => g.reimburseTiming === "advance")).toBe(true);
    expect(tw.some(g => g.costShareType === "inkind")).toBe(true);

    // three plans, and one whose churn is high enough to matter
    const lk = by("saas");
    expect(lk.saas).toHaveLength(3);
    expect(lk.saas.some(s => s.churnPct >= 3)).toBe(true);
    expect(lk.projects.some(p => p.type === "internal")).toBe(true);
  });

  it("⚠️ AN UNKNOWN ID FALLS BACK RATHER THAN THROWING", () => {
    // A bad link should show somebody a demo, not an error.
    expect(demoDoc("nonsense").name).toBe(ARCHETYPES[0].company);
    expect(demoDoc().name).toBe(ARCHETYPES[0].company);
  });

  it("marks the document as a demo and records which one", () => {
    const d = demoDoc("saas");
    expect(d.it).toBe("demo");
    expect(d.demoId).toBe("saas");
  });

  it("⚠️ INHERITS STRUCTURE FROM `emptyDoc`, so a new field reaches all four", () => {
    // Four hand-written full documents would be four places to forget a schema addition.
    const d = demoDoc("nonprofit");
    expect(d.schemaVersion).toBeTruthy();
    expect(d.settings).toBeTruthy();
  });

  it("each carries a blurb that says what it SHOWS", () => {
    // "An SBIR award and a proposal you have not won yet" is a description; "shows the gap between
    // spending and being reimbursed" is the reason to pick it.
    for (const a of ARCHETYPES) {
      expect(a.shows, a.id).toMatch(/^Shows /);
      expect(a.blurb.length, a.id).toBeGreaterThan(20);
    }
  });
});
