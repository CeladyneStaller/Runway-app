// The answers -> document mapping. Pure, so it gets real tests rather than DOM pokes.
import { describe, it, expect } from "vitest";
import { docFromSetup, missingSalaries, setupHasSubstance, num } from "../../src/state/setup";
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
