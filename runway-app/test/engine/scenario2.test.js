// The scenario capabilities the redesigned tab needs: removal, readable descriptions, subscription
// what-ifs, impact with attribution, and duplication.
import { describe, it, expect } from "vitest";
import { applyScenario, applyPatch, explainPatch, describePatch, scenarioImpact,
         duplicateScenario, emptyScenario, scenarioRound, PATCH_SCHEMA } from "../../src/engine/scenario";
import { emptyDoc } from "../../src/state/document";
import { blankSaas } from "../../src/engine/saas";

// Salaries are deliberately large so every runway here lands INSIDE the 36-month horizon —
// past it, `months` is null and a delta cannot be stated. That case has its own test at the end.
const emp = (id, name, over = {}) => ({
  id, name, title: "Engineer", basis: "annual", amount: 480000, start: 0, end: null,
  raises: [], promotions: [], ...over,
});
const base = (over = {}) => ({
  ...emptyDoc(), startY: 2026, startM: 6, cash: 600000,
  employees: [emp("e1", "Alex Rivera"), emp("e2", "Sam Okafor", { start: 2 })],
  ...over,
});
const ctx = { START_Y: 2026, START_M: 6 };

describe("taking something out entirely", () => {
  it("removes the item rather than pushing it past the horizon", () => {
    // "Don't hire Sam" used to be a start month set past the horizon — a delay wearing a disguise,
    // which then read as a delay in the description and broke when the horizon moved.
    const d = applyScenario(base(), { patches: [{ kind: "remove", collection: "employees", id: "e2" }] });
    expect(d.employees.map(e => e.id)).toEqual(["e1"]);
  });

  it("leaves the base document alone", () => {
    const b = base();
    applyScenario(b, { patches: [{ kind: "remove", collection: "employees", id: "e2" }] });
    expect(b.employees).toHaveLength(2);
  });

  it("shrugs at an id that isn't there", () => {
    const d = applyPatch(base(), { kind: "remove", collection: "employees", id: "nope" });
    expect(d.employees).toHaveLength(2);
  });

  it("and it actually changes the runway", () => {
    const before = scenarioImpact(base(), emptyScenario()).months;
    // TOGGLES STATED EXPLICITLY, because the point is the AXIS and not the default. This test used to
    // rely on financing defaulting to off; the default is now on, and a test that depends on a default
    // is a test that breaks when somebody changes one for a good reason.
    const noFinancing = { ...base(), settings: { ...base().settings,
      toggles: { ...base().settings?.toggles, financing: false } } };
    const after = scenarioImpact(noFinancing, { patches: [{ kind: "remove", collection: "employees", id: "e2" }] }).months;
    expect(after).toBeGreaterThan(before);
  });
});

describe("changes that read as sentences", () => {
  it("names the item, the verb and the new value — with the old one beside it", () => {
    // Was "Sam: start -> 5": a field name, an arrow, and a raw month index.
    const e = explainPatch({ kind: "item", collection: "employees", id: "e2", field: "start", value: 8 }, base(), ctx);
    expect(e.text).toBe("Sam Okafor starts Mar 27");
    expect(e.was).toBe("Sep 26");
    expect(describePatch({ kind: "item", collection: "employees", id: "e2", field: "start", value: 8 }, base(), ctx))
      .toBe("Sam Okafor starts Mar 27, was Sep 26");
  });

  it("shows money as money", () => {
    const e = explainPatch({ kind: "item", collection: "employees", id: "e1", field: "amount", value: 90000 }, base(), ctx);
    expect(e.text).toBe("Alex Rivera paid $90,000");
    expect(e.was).toBe("$480,000");
  });

  it("falls back to a month index when there is no start date to render against", () => {
    const e = explainPatch({ kind: "item", collection: "employees", id: "e2", field: "start", value: 8 }, base(), {});
    expect(e.text).toBe("Sam Okafor starts month 8");
  });

  it("describes a removal as a removal", () => {
    expect(explainPatch({ kind: "remove", collection: "employees", id: "e2" }, base(), ctx).text)
      .toBe("Sam Okafor removed");
  });

  it("names toggles and top-level fields properly", () => {
    expect(explainPatch({ kind: "toggle", path: "speculative", value: true }, base(), ctx).text)
      .toBe("Speculative revenue on");
    expect(explainPatch({ kind: "field", path: "cash", value: 900000 }, base(), ctx))
      .toMatchObject({ text: "Cash on hand $900,000", was: "$600,000" });
  });
});

describe("subscription what-ifs", () => {
  const withSaas = () => base({ saas: [{ ...blankSaas(), id: "s1", name: "Pro plan", startCustomers: 200, arpu: 300, newPerMonth: 10, churnPct: 5 }] });

  it("churn is patchable at all — it wasn't", () => {
    expect(PATCH_SCHEMA.saas).toBeTruthy();
    expect(Object.keys(PATCH_SCHEMA.saas.fields)).toContain("churnPct");
  });

  it("doubling churn shortens the runway", () => {
    const doc = withSaas();
    const plain = scenarioImpact(doc, emptyScenario());
    const worse = scenarioImpact(doc, { patches: [{ kind: "item", collection: "saas", id: "s1", field: "churnPct", value: 10 }] });
    expect(worse.months).toBeLessThan(plain.months);
  });

  it("and reads as a sentence with a percentage", () => {
    const e = explainPatch({ kind: "item", collection: "saas", id: "s1", field: "churnPct", value: 10 }, withSaas(), ctx);
    expect(e.text).toBe("Pro plan churn 10%/mo");
    expect(e.was).toBe("5%/mo");
  });
});

describe("what a scenario does, and which change did it", () => {
  it("reports the delta against the plan", () => {
    const i = scenarioImpact(base(), { patches: [{ kind: "remove", collection: "employees", id: "e2" }] });
    expect(i.baseMonths).toBeGreaterThan(0);
    expect(i.delta).toBeCloseTo(i.months - i.baseMonths, 6);
    expect(i.delta).toBeGreaterThan(0);
  });

  it("attributes by LEAVE-ONE-OUT, so a change that lands after you're dead doesn't get credit", () => {
    // Removing Sam (starts month 2) matters. A raise in month 30 does not — the money is gone first.
    // The trivial change is FIRST on purpose: ranking by patch order, or by "the biggest number",
    // would both pick it. Only actually re-running without each change finds the one carrying it.
    const i = scenarioImpact(base(), { patches: [
      { kind: "item", collection: "employees", id: "e1", field: "amount", value: 481000 },
      { kind: "remove", collection: "employees", id: "e2" },
    ] });
    expect(i.driver).toMatchObject({ kind: "remove", id: "e2" });
  });

  it("names the only change when there is only one", () => {
    const i = scenarioImpact(base(), { patches: [{ kind: "field", path: "cash", value: 2000000 }] });
    expect(i.driver).toMatchObject({ kind: "field", path: "cash" });
  });

  it("has no driver and no delta for an empty scenario", () => {
    const i = scenarioImpact(base(), emptyScenario());
    expect(i.driver).toBeNull();
    expect(i.delta).toBeCloseTo(0, 6);
  });

  it("tells 'never runs out' apart from 'cash-flow positive'", () => {
    // The conflation this whole redesign keeps tripping over. A huge pile that still drains is NOT
    // cash-flow positive.
    const rich = scenarioImpact(base(), { patches: [{ kind: "field", path: "cash", value: 500000000 }] });
    expect(rich.months).toBeNull();
    expect(rich.cashFlowPositive).toBe(false);

    const noBurn = scenarioImpact(base({ employees: [] }), emptyScenario());
    expect(noBurn.months).toBeNull();
    expect(noBurn.cashFlowPositive).toBe(true);
  });

  it("reports how much the monthly burn moved", () => {
    const i = scenarioImpact(base(), { patches: [{ kind: "remove", collection: "employees", id: "e2" }] });
    expect(i.burnDelta).toBeGreaterThan(0);   // less negative net = burning less
  });
});

describe("duplicating", () => {
  it("copies the changes under a new id and name", () => {
    const s = { ...emptyScenario("Hiring freeze"), patches: [{ kind: "remove", collection: "employees", id: "e2" }] };
    const c = duplicateScenario(s);
    expect(c.id).not.toBe(s.id);
    expect(c.name).toBe("Hiring freeze copy");
    expect(c.patches).toEqual(s.patches);
  });

  it("copies patches by value, so editing one doesn't edit the other", () => {
    const s = { ...emptyScenario(), patches: [{ kind: "field", path: "cash", value: 1 }] };
    const c = duplicateScenario(s);
    c.patches[0].value = 999;
    expect(s.patches[0].value).toBe(1);
  });
});

describe("adding something that isn't in the plan at all", () => {
  it("puts a new round into the document", () => {
    // Every other patch kind edits an item that already exists, so "what if we raised" could not be
    // asked unless you had already entered the round you were unsure about.
    const item = scenarioRound({ name: "Seed", amount: 1500000, closeMonth: 4 });
    const d = applyScenario(base(), { patches: [{ kind: "add", collection: "rounds", item }] });
    expect(d.rounds).toHaveLength(1);
    expect(d.rounds[0]).toMatchObject({ name: "Seed", amount: 1500000, closeMonth: 4 });
  });

  it("leaves the base document alone", () => {
    const b = base();
    applyScenario(b, { patches: [{ kind: "add", collection: "rounds", item: scenarioRound({ amount: 1 }) }] });
    expect(b.rounds).toHaveLength(0);
  });

  it("keeps the SAME id every time it is applied", () => {
    // Minting an id on each apply gives the round a different identity on every render, which breaks
    // React keys and any later patch that refers to it.
    const p = { kind: "add", collection: "rounds", item: scenarioRound({ amount: 1 }) };
    const a = applyScenario(base(), { patches: [p] }).rounds[0].id;
    const b = applyScenario(base(), { patches: [p] }).rounds[0].id;
    expect(a).toBe(b);
  });

  it("refuses an item with no id rather than creating an unaddressable one", () => {
    const d = applyPatch(base(), { kind: "add", collection: "rounds", item: { name: "x" } });
    expect(d.rounds).toHaveLength(0);
  });

  it("MOVES THE RUNWAY now that financing defaults to on", () => {
    // Documented here because it is the trap the UI has to handle: a round added with no other change
    // moves the runway not at all, at ANY status, and looks like a broken feature.
    const after = scenarioImpact(base(), { patches: [
      { kind: "add", collection: "rounds", item: scenarioRound({ amount: 3000000, closeMonth: 2 }) },
    ] });
    // THE TRAP THIS DOCUMENTED IS GONE, and its disappearance is the point of the default change.
    // Adding a round used to move the runway NOT AT ALL because financing defaulted to off, which read
    // as a broken feature to anybody modelling a raise. It now does what somebody would expect.
    expect(after.delta).toBeGreaterThan(0);
  });

  it("and reaches the runway once financing is on", () => {
    const before = scenarioImpact(base(), emptyScenario());
    const after = scenarioImpact(base(), { patches: [
      { kind: "add", collection: "rounds", item: scenarioRound({ name: "Seed", amount: 3000000, closeMonth: 2 }) },
      { kind: "toggle", path: "financing", value: true },
    ] });
    expect(after.months).toBeGreaterThan(before.months);
  });

  it("defaults to COMMITTED — the only status that both emits a line and is switched on", () => {
    // `closed` emits NO line (the money is already in `cash`), and planning/raising map to
    // speculative, which is off by default. Both look like a broken feature.
    expect(scenarioRound({ amount: 1 }).status).toBe("committed");
    const closed = scenarioImpact(base(), { patches: [
      { kind: "add", collection: "rounds", item: scenarioRound({ amount: 3000000, status: "closed" }) },
      { kind: "toggle", path: "financing", value: true },
    ] });
    expect(closed.delta).toBeCloseTo(0, 6);
    const planned = scenarioImpact(base(), { patches: [
      { kind: "add", collection: "rounds", item: scenarioRound({ amount: 3000000, status: "planning" }) },
    ] });
    expect(planned.delta).toBeCloseTo(0, 6);
  });

  it("will not build debt, which without terms is money that is never repaid", () => {
    expect(scenarioRound({ amount: 1, kind: "debt" }).kind).toBe("safe");
    expect(scenarioRound({ amount: 1, kind: "equity" }).kind).toBe("equity");
  });

  it("coerces junk rather than writing it into the document", () => {
    const r = scenarioRound({ name: "  ", amount: "abc", closeMonth: -4, status: "nonsense" });
    expect(r.name).toBe("New round");
    expect(r.amount).toBe(0);
    expect(r.closeMonth).toBe(0);
    expect(r.status).toBe("committed");
  });

  it("reads as a sentence", () => {
    const item = scenarioRound({ name: "Seed", amount: 1500000, closeMonth: 8 });
    const e = explainPatch({ kind: "add", collection: "rounds", item }, base(), ctx);
    expect(e.text).toBe("Seed added — $1,500,000 closing Mar 27");
  });
});
