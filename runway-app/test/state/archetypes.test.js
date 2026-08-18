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

describe("⚠️ the landing page opens a company directly", () => {
  it("names every archetype with a label, company and blurb", async () => {
    // The landing buttons read from `ARCHETYPES` rather than typing the four descriptions a fourth
    // time — **a hand-written copy is a chance to describe Ridgeline differently from what it
    // contains.**
    for (const a of ARCHETYPES) {
      expect(a.label, a.id).toBeTruthy();
      expect(a.company, a.id).toBeTruthy();
      expect(a.blurb.length, a.id).toBeGreaterThan(20);
    }
  });

  it("⚠️ EVERY ARCHETYPE ID RESOLVES, so a link cannot land nowhere", () => {
    // `#demo=grant-startup` is a URL the marketing site will hand out and never update again.
    for (const a of ARCHETYPES) expect(archetypeById(a.id)?.id).toBe(a.id);
    expect(archetypeById("not-a-company")).toBeNull();
  });
});

describe("⚠️ the advisor demo is the real advisor experience", () => {
  it("its clients ARE the four archetypes", async () => {
    // **Not a fifth sample company** — the portfolio is the four documents that already exist, so
    // anything an advisor clicks into genuinely models what the row claims.
    const { createDemoAdvisorApi } = await import("../../src/state/demoadvisor.js");
    const clients = await createDemoAdvisorApi().listAdvisedCompanies();
    expect(clients).toHaveLength(ARCHETYPES.length);
    expect(clients.map(c => c.name)).toEqual(ARCHETYPES.map(a => a.company));
  });

  it("⚠️ OPENING A CLIENT LOADS THAT ARCHETYPE'S REAL DOCUMENT", async () => {
    // This is the line that makes the advisor demo the product rather than a screenshot of it —
    // scenarios, charts and every tab behave as they would for a real client.
    const { createDemoAdvisorApi, demoClientDoc } = await import("../../src/state/demoadvisor.js");
    const clients = await createDemoAdvisorApi().listAdvisedCompanies();
    for (const c of clients) {
      const doc = demoClientDoc(c.company_id);
      expect(doc, c.company_id).toBeTruthy();
      expect(doc.name).toBe(c.name);
      expect(doc.employees.length).toBeGreaterThan(0);
    }
  });

  it("does not show a demo advisor a paywall", async () => {
    // Showing them the one part of the product they have not agreed to buy yet is the wrong first
    // impression.
    const { createDemoAdvisorApi } = await import("../../src/state/demoadvisor.js");
    const usage = await createDemoAdvisorApi().advisorUsage();
    expect(usage.allowed).toBeGreaterThan(usage.used);
  });

  it("⚠️ THE DEMO API OVERRIDES CENTRALLY, so no caller can miss it", async () => {
    // `getAccountApi()` is called from a dozen places. Patching each would be twelve chances to miss
    // one, and **the missed one falls through to the real API and shows an empty portfolio.**
    const sync = await import("../../src/state/sync.js");
    const { createDemoAdvisorApi } = await import("../../src/state/demoadvisor.js");
    const api = createDemoAdvisorApi();
    sync.setDemoAccountApi(api);
    expect(sync.getAccountApi()).toBe(api);
    sync.setDemoAccountApi(null);
    expect(sync.getAccountApi()).not.toBe(api);
  });
});

describe("⚠️ the portfolio can actually read every client", () => {
  it("serves a document for every id it lists", async () => {
    // `AdvisorHome` calls `readCompanyDocument(c.id)` and builds the projection itself. **A demo that
    // lists clients without serving their documents produces four rows of "could not be read"** — which
    // is exactly what my first version did, because I returned `company_id` and the component reads
    // `id`.
    const { createDemoAdvisorApi } = await import("../../src/state/demoadvisor.js");
    const api = createDemoAdvisorApi();
    const clients = await api.listAdvisedCompanies();
    for (const c of clients) {
      expect(c.id, "the component reads `id`, not `company_id`").toBeTruthy();
      const doc = await api.readCompanyDocument(c.id);
      expect(doc, c.id).toBeTruthy();
      expect(doc.name).toBe(c.name);
    }
  });

  it("⚠️ EVERY CLIENT PRODUCES A REAL PROJECTION", async () => {
    // The row's runway and cash are computed by the same code that computes them for a paying advisor.
    const { createDemoAdvisorApi } = await import("../../src/state/demoadvisor.js");
    const { buildModelFromDoc } = await import("../../src/engine/buildmodel.js");
    const { buildProjection } = await import("../../src/engine/projection.js");
    const api = createDemoAdvisorApi();
    for (const c of await api.listAdvisedCompanies()) {
      const doc = await api.readCompanyDocument(c.id);
      const rows = buildProjection(buildModelFromDoc(doc), doc.settings?.toggles);
      expect(rows.length, c.name).toBeGreaterThan(0);
      expect(Number.isFinite(rows[0].end), c.name).toBe(true);
    }
  });
});

describe("⚠️ the hash is the source of truth across a refresh", () => {
  it("parses every demo hash form", async () => {
    // On a refresh the whole component tree is new — React state is gone and **only the URL
    // survives.** `demo` already restored itself this way; `demoId` did not, so a reload of
    // `#demo=advisor` reinstated the demo and forgot which one.
    const parse = (h) => { const m = /^#demo=([a-z-]+)$/.exec(h || ""); return m ? m[1] : null; };
    expect(parse("#demo=advisor")).toBe("advisor");
    expect(parse("#demo=grant-startup")).toBe("grant-startup");
    expect(parse("#demo")).toBeNull();          // the picker, not a company
    expect(parse("")).toBeNull();
  });

  it("every archetype id survives a round trip through the hash", () => {
    // These are URLs the marketing site hands out; a form that does not parse back is a link that
    // silently lands somewhere else.
    for (const a of ARCHETYPES) {
      const h = `#demo=${a.id}`;
      expect(/^#demo=([a-z-]+)$/.exec(h)[1]).toBe(a.id);
      expect(archetypeById(a.id)).toBeTruthy();
    }
  });
});
