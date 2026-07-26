// The answers -> document mapping. Pure, so it gets real tests rather than DOM pokes.
import { describe, it, expect } from "vitest";
import { docFromSetup, missingSalaries, setupHasSubstance, num, classifyRunway } from "../../src/state/setup";
import { buildModelFromDoc } from "../../src/engine/buildmodel";
import { buildProjection, zeroInfo } from "../../src/engine/projection";

describe("reading what people type", () => {
  it("takes commas, spaces and currency noise", () => {
    expect(num("250,000")).toBe(250000);
    expect(num(" $1,500 ")).toBe(1500);
    expect(num(120000)).toBe(120000);
  });

  it("turns a blank into zero, never NaN", () => {
    // A NaN in cash propagates into every balance and the chart silently stops drawing.
    expect(num("")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num("abc")).toBe(0);
    expect(docFromSetup({ cash: "" }).cash).toBe(0);
  });
});

describe("building the document", () => {
  it("produces one the engine can actually project", () => {
    const doc = docFromSetup({
      name: "Acme", cash: "500,000",
      employees: [{ name: "Alex Rivera", title: "CEO", salary: "168000" }],
    });
    const rows = buildProjection(buildModelFromDoc(doc), doc.settings.toggles);
    const z = zeroInfo(rows);
    expect(z).not.toBeNull();               // there is burn, so there is a zero date
    expect(z.months).toBeGreaterThan(0);
    expect(rows[0].start).toBe(500000);
  });

  it("drops the trailing blank row the wizard always shows", () => {
    const doc = docFromSetup({
      employees: [{ name: "Alex", title: "CEO", salary: "1" }, { name: "", title: "", salary: "" }],
      projects: [{ name: "", type: "internal", budget: "" }],
    });
    expect(doc.employees).toHaveLength(1);
    expect(doc.projects).toHaveLength(0);
  });

  it("gives employees the shape payroll expects", () => {
    const e = docFromSetup({ employees: [{ name: "A", title: "T", salary: "100" }] }).employees[0];
    expect(e).toMatchObject({ basis: "annual", start: 0, end: null, raises: [], promotions: [] });
    expect(e.id).toBeTruthy();
  });

  it("keeps a person with no salary, at zero", () => {
    // Blocking on it would push somebody to leave the person out entirely, which is worse: a person
    // at zero is visible in the model and fixable; a person omitted is invisible.
    const doc = docFromSetup({ employees: [{ name: "Sam", title: "Eng", salary: "" }] });
    expect(doc.employees).toHaveLength(1);
    expect(doc.employees[0].amount).toBe(0);
    expect(missingSalaries({ employees: [{ name: "Sam", salary: "" }, { name: "Al", salary: "9" }] })).toEqual(["Sam"]);
  });

  it("defaults a round to planning, the conservative direction", () => {
    // status drives INST_CONF -> speculative -> off in the base projection. Being wrong this way
    // understates runway; the other way overstates it.
    const r = docFromSetup({ rounds: [{ name: "Seed", amount: "2000000" }] }).rounds[0];
    expect(r.status).toBe("planning");
    expect(r.kind).toBe("safe");
  });

  it("rejects junk enums rather than writing them into the document", () => {
    const doc = docFromSetup({
      projects: [{ name: "P", type: "nonsense", budget: "1" }],
      rounds: [{ name: "R", kind: "nonsense", status: "nonsense", amount: "1" }],
    });
    expect(doc.projects[0].type).toBe("internal");
    expect(doc.rounds[0].kind).toBe("safe");
    expect(doc.rounds[0].status).toBe("planning");
  });

  it("falls back to the document's own default name when none is given", () => {
    expect(docFromSetup({}).name).toBe("Untitled");
    expect(docFromSetup({ name: "  Acme  " }).name).toBe("Acme");
  });
});

describe("whether anything was said at all", () => {
  it("an all-skipped wizard has no substance", () => {
    expect(setupHasSubstance({})).toBe(false);
    expect(setupHasSubstance({ cash: "", employees: [{ name: "" }] })).toBe(false);
  });
  it("any one answer is enough", () => {
    expect(setupHasSubstance({ cash: "1" })).toBe(true);
    expect(setupHasSubstance({ employees: [{ name: "A" }] })).toBe(true);
    expect(setupHasSubstance({ rounds: [{ name: "Seed" }] })).toBe(true);
  });
});

describe("classifying how long the money lasts", () => {
  // zeroInfo returns ONE null for two different situations. These are the four states worth telling
  // apart, including the one the wizard's own inputs can't currently reach.
  const rows = (list) => list.map((r, m) => ({ m, ...r }));

  it("a real zero date is a real number of months", () => {
    const doc = docFromSetup({ cash: "300000", employees: [{ name: "A", salary: "600000" }] });
    const r = buildProjection(buildModelFromDoc(doc), doc.settings.toggles);
    expect(classifyRunway(r)).toMatchObject({ kind: "runway" });
    // Not pinned to 6: payroll carries a fringe percentage on top of salary, so the burn is higher
    // than salary/12 and the exact figure belongs to the payroll tests, not this one.
    expect(classifyRunway(r).months).toBeGreaterThan(0);
    expect(classifyRunway(r).months).toBeLessThan(6);
  });

  it("nothing burning is 'idle', not a date", () => {
    const doc = docFromSetup({ cash: "600000" });
    expect(classifyRunway(buildProjection(buildModelFromDoc(doc), doc.settings.toggles)))
      .toEqual({ kind: "idle" });
  });

  it("burning but outlasting the window is 'beyond' — NOT cash-flow positive", () => {
    // The bug this exists for: a steady burner whose pile is simply bigger than 36 months was being
    // told it was cash-flow positive.
    const doc = docFromSetup({ cash: "50000000", employees: [{ name: "A", salary: "120000" }] });
    expect(classifyRunway(buildProjection(buildModelFromDoc(doc), doc.settings.toggles)))
      .toEqual({ kind: "beyond" });
  });

  it("revenue covering costs at the end is 'positive'", () => {
    // Unreachable through the wizard today — it collects no recurring revenue — so it is exercised
    // here directly rather than left as a rule nobody has ever run.
    expect(classifyRunway(rows([
      { start: 100, rev: 0, cost: 10, net: -10, end: 90 },
      { start: 90, rev: 50, cost: 10, net: 40, end: 130 },
    ]))).toEqual({ kind: "positive" });
  });

  it("net exactly zero counts as positive, not as burning", () => {
    expect(classifyRunway(rows([{ start: 100, rev: 10, cost: 10, net: 0, end: 100 }])))
      .toEqual({ kind: "positive" });
  });

  it("a zero date beats a positive ending — you don't reach month 30 if you die at month 5", () => {
    expect(classifyRunway(rows([
      { start: 10, rev: 0, cost: 20, net: -20, end: -10 },
      { start: -10, rev: 99, cost: 1, net: 98, end: 88 },
    ]))).toMatchObject({ kind: "runway" });
  });

  it("says nothing about nothing", () => {
    expect(classifyRunway([])).toBeNull();
    expect(classifyRunway(null)).toBeNull();
  });
});
