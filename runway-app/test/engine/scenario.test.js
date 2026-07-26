// Scenarios: overlay patches over a base doc, engine untouched. The load-bearing guarantees: the base
// is never mutated, an empty scenario is a faithful copy (golden-safe), and each patch kind works.
import { describe, it, expect } from "vitest";
import { applyScenario, applyPatch, emptyScenario, describePatch } from "../../src/engine";

const base = () => ({
  cash: 500000,
  settings: { toggles: { committed: true, expected: true, speculative: false, financing: false } },
  employees: [{ id: "e1", name: "Alice", start: 0 }, { id: "e2", name: "Bob", start: 2 }],
  projects: [{ id: "g1", name: "Grant A", stage: "expected", budget: 100000 }],
  rounds: [], pos: [], milestones: [],
});

describe("base is never mutated", () => {
  it("applyScenario returns a new doc and leaves base untouched", () => {
    const b = base();
    const scn = { patches: [{ kind: "field", path: "cash", value: 999 }] };
    const out = applyScenario(b, scn);
    expect(out.cash).toBe(999);
    expect(b.cash).toBe(500000);          // base unchanged
    expect(out).not.toBe(b);
    expect(out.employees).not.toBe(b.employees);   // deep clone, not shared refs
  });
});

describe("empty scenario is a faithful copy (golden-safe)", () => {
  it("no patches => structurally identical to base", () => {
    const b = base();
    const out = applyScenario(b, emptyScenario());
    expect(out).toEqual(b);               // same shape and values
    expect(out).not.toBe(b);              // but a different object
  });
});

describe("field patch", () => {
  it("sets a top-level field", () => {
    const out = applyScenario(base(), { patches: [{ kind: "field", path: "cash", value: 750000 }] });
    expect(out.cash).toBe(750000);
  });
  it("ignores an unknown field", () => {
    const out = applyScenario(base(), { patches: [{ kind: "field", path: "nonexistent", value: 1 }] });
    expect(out.nonexistent).toBeUndefined();
  });
});

describe("toggle patch", () => {
  it("flips a toggle without disturbing the others", () => {
    const out = applyScenario(base(), { patches: [{ kind: "toggle", path: "speculative", value: true }] });
    expect(out.settings.toggles.speculative).toBe(true);
    expect(out.settings.toggles.committed).toBe(true);   // untouched
  });
});

describe("item patch — the powerful one", () => {
  it("delays a specific hire by id", () => {
    const out = applyScenario(base(), { patches: [{ kind: "item", collection: "employees", id: "e2", field: "start", value: 5 }] });
    expect(out.employees.find(e => e.id === "e2").start).toBe(5);
    expect(out.employees.find(e => e.id === "e1").start).toBe(0);   // other employee untouched
  });
  it("awards a specific grant by id", () => {
    const out = applyScenario(base(), { patches: [{ kind: "item", collection: "projects", id: "g1", field: "stage", value: "awarded" }] });
    expect(out.projects.find(p => p.id === "g1").stage).toBe("awarded");
  });
  it("a patch to a since-deleted item does nothing (degrades gracefully)", () => {
    const out = applyScenario(base(), { patches: [{ kind: "item", collection: "employees", id: "GONE", field: "start", value: 9 }] });
    expect(out.employees).toHaveLength(2);   // no crash, no phantom item
  });
});

describe("multiple patches compose", () => {
  it("applies several in order", () => {
    const out = applyScenario(base(), { patches: [
      { kind: "field", path: "cash", value: 800000 },
      { kind: "item", collection: "employees", id: "e2", field: "start", value: 4 },
      { kind: "toggle", path: "speculative", value: true },
    ] });
    expect(out.cash).toBe(800000);
    expect(out.employees.find(e => e.id === "e2").start).toBe(4);
    expect(out.settings.toggles.speculative).toBe(true);
  });
});

describe("describePatch", () => {
  it("names an item patch using the item's name", () => {
    // Was "Bob: start -> 5" — the document schema read aloud. It now names the item, says what it
    // does, and carries the old value, because "starts month 5" is a fact and "starts month 5, was
    // month 2" is a decision.
    expect(describePatch({ kind: "item", collection: "employees", id: "e2", field: "start", value: 5 }, base())).toBe("Bob starts month 5, was month 2");
  });
  it("describes a toggle", () => {
    expect(describePatch({ kind: "toggle", path: "speculative", value: true }, base())).toBe("Speculative revenue on, was off");
  });
});
