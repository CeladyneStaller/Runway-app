// Scenarios view, rebuilt around the decision rather than the curve. The engine (applyScenario,
// scenarioImpact, explainPatch) is tested separately; this covers the view wiring — the delta strip,
// intent-first changes, live effect, duplication, and applying to the real plan.
import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc, emptyDoc } from "../../src/state/document";
import { blankSaas } from "../../src/engine/saas";

function scenariosView(initial) {
  const ref = { current: initial };
  function Harness() {
    const [d, setD] = useState(initial);
    ref.current = d;
    return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
  }
  const { container } = render(<Harness />);
  fireEvent.click([...container.querySelectorAll("button.nav")].find(b => /Scenarios/.test(b.textContent)));
  return { container, get: () => ref.current };
}
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));
const sel = (c, label) => [...c.querySelectorAll("select")].find(s => s.getAttribute("aria-label") === label);
const scn = (patches, over = {}) => ({ id: "s1", name: "Hiring freeze", patches, saved: true, ...over });

describe("the comparison", () => {
  it("leads with your plan and its runway", () => {
    const { container } = scenariosView(demoDoc());
    expect(container.textContent).toMatch(/Runway comparison/);
    expect(container.textContent).toMatch(/Your plan/);
    expect(container.textContent).toMatch(/5\.6 mo/);
  });

  it("states the DELTA, not two numbers to subtract", () => {
    // The old tab showed base and scenario runways side by side and left the arithmetic to the reader.
    const doc = { ...demoDoc(), scenarios: [scn([{ kind: "remove", collection: "employees", id: demoDoc().employees[0].id }])] };
    const { container } = scenariosView(doc);
    expect(container.textContent).toMatch(/\+\d+\.\d mo/);
  });

  it("says which change caused it", () => {
    const emps = demoDoc().employees;
    const doc = { ...demoDoc(), scenarios: [scn([
      { kind: "remove", collection: "employees", id: emps[0].id },
      { kind: "item", collection: "employees", id: emps[1].id, field: "amount", value: emps[1].amount + 500 },
    ])] };
    const { container } = scenariosView(doc);
    expect(container.textContent).toMatch(/Mostly/);
    expect(container.textContent).toMatch(new RegExp(emps[0].name));
  });

  it("tells 'never runs out' apart from 'cash-flow positive'", () => {
    // Both used to print "cash-positive". A huge pile that still drains is not cash-flow positive.
    const burning = scenariosView({ ...emptyDoc(), cash: 500000000,
      employees: [{ id: "e", name: "A", title: "T", basis: "annual", amount: 120000, start: 0, end: null, raises: [], promotions: [] }] });
    expect(burning.container.textContent).toMatch(/36\+ mo/);
    expect(burning.container.textContent).toMatch(/still burning/);

    const idle = scenariosView({ ...emptyDoc(), cash: 250000 });
    expect(idle.container.textContent).toMatch(/cash-flow positive/);
  });
});

describe("scenario cards", () => {
  it("show the changes as sentences, not a count", () => {
    // Was "3 changes". Now each change says what it is and what it was.
    const e = demoDoc().employees[0];
    const doc = { ...demoDoc(), scenarios: [scn([{ kind: "item", collection: "employees", id: e.id, field: "start", value: 8 }])] };
    const { container } = scenariosView(doc);
    expect(container.textContent).toMatch(new RegExp(`${e.name} starts Mar 27`));
    expect(container.textContent).toMatch(/was Jul 26/);
  });

  it("duplicate makes an independent copy", () => {
    const doc = { ...demoDoc(), scenarios: [scn([{ kind: "field", path: "cash", value: 1 }])] };
    const { container, get } = scenariosView(doc);
    fireEvent.click(btn(container, /^Duplicate$/));
    expect(get().scenarios).toHaveLength(2);
    expect(get().scenarios[1].name).toBe("Hiring freeze copy");
    expect(get().scenarios[1].id).not.toBe("s1");
  });

  it("delete removes it", () => {
    const doc = { ...demoDoc(), scenarios: [scn([])] };
    const { container, get } = scenariosView(doc);
    fireEvent.click(container.querySelector('[aria-label="Delete Hiring freeze"]'));
    expect(get().scenarios).toHaveLength(0);
  });
});

describe("building a change from the intent, not the schema", () => {
  it("offers the questions people arrive with", () => {
    const { container } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    expect(container.textContent).toMatch(/Delay a hire/);
    expect(container.textContent).toMatch(/Don't hire someone/);
    expect(container.textContent).toMatch(/Change churn or growth/);
    expect(container.textContent).toMatch(/Something else/);
  });

  it("delays a hire in two picks", () => {
    const { container, get } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    const e = demoDoc().employees[0];
    fireEvent.change(sel(container, "Which one"), { target: { value: e.id } });
    fireEvent.change(sel(container, "Start month"), { target: { value: "8" } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ kind: "item", collection: "employees", field: "start", value: 8 });
  });

  it("drops somebody entirely — which the old builder could not express at all", () => {
    // "Don't hire Sam" used to mean setting a start month past the horizon.
    const { container, get } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(btn(container, /Don't hire someone/));
    fireEvent.change(sel(container, "Which one"), { target: { value: demoDoc().employees[0].id } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ kind: "remove", collection: "employees" });
  });

  it("reaches subscriptions, which were not patchable when SaaS shipped", () => {
    const doc = { ...demoDoc(), saas: [{ ...blankSaas(), id: "s9", name: "Pro plan", arpu: 100, startCustomers: 50, churnPct: 5 }] };
    const { container, get } = scenariosView(doc);
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(btn(container, /Change churn or growth/));
    fireEvent.change(sel(container, "Which one"), { target: { value: "s9" } });
    fireEvent.change(container.querySelector('[aria-label="Churn"]'), { target: { value: "12" } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ collection: "saas", field: "churnPct", value: 12 });
  });

  it("keeps cash and the revenue toggles reachable through 'Something else'", () => {
    // They had no intent tile; dropping them would be losing capability to a redesign.
    const { container, get } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(btn(container, /Something else/));
    fireEvent.change(sel(container, "Where"), { target: { value: "field:cash" } });
    fireEvent.change(container.querySelector('[aria-label="Cash on hand"]'), { target: { value: "900000" } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ kind: "field", path: "cash", value: 900000 });
  });

  it("shows the runway moving as you build — the old editor was blind until you closed it", () => {
    const e = demoDoc().employees[0];
    const doc = { ...demoDoc(), scenarios: [scn([{ kind: "remove", collection: "employees", id: e.id }])] };
    const { container } = scenariosView(doc);
    fireEvent.click(btn(container, /^Edit$/));
    expect(container.textContent).toMatch(/Runway with these changes/);
    expect(container.textContent).toMatch(/\+\d+\.\d mo/);
  });

  it("a change can be taken back off", () => {
    const e = demoDoc().employees[0];
    const doc = { ...demoDoc(), scenarios: [scn([{ kind: "item", collection: "employees", id: e.id, field: "start", value: 8 }])] };
    const { container, get } = scenariosView(doc);
    fireEvent.click(btn(container, /^Edit$/));
    fireEvent.click(container.querySelector('[aria-label^="Remove change"]'));
    expect(get().scenarios[0].patches).toHaveLength(0);
  });

  it("has no Save button, because there never really was one", () => {
    // The old footer offered "Save scenario" and "Keep unsaved" — but edits already wrote straight
    // through, and nothing anywhere filtered on the flag.
    const doc = { ...demoDoc(), scenarios: [scn([])] };
    const { container } = scenariosView(doc);
    fireEvent.click(btn(container, /^Edit$/));
    expect(btn(container, /Save scenario/)).toBeFalsy();
    expect(btn(container, /Keep unsaved/)).toBeFalsy();
  });
});

describe("applying a scenario to the real plan", () => {
  const e0 = demoDoc().employees[0];
  const doc = () => ({ ...demoDoc(), scenarios: [scn([{ kind: "remove", collection: "employees", id: e0.id }])] });

  it("asks first, and says plainly that this one edits the model", () => {
    const { container } = scenariosView(doc());
    fireEvent.click(btn(container, /Apply to plan/));
    expect(container.textContent).toMatch(/Apply "Hiring freeze" to your plan/);
    expect(container.textContent).toMatch(/edits your real model/i);
  });

  it("previews what lands and what it does to the runway", () => {
    const { container } = scenariosView(doc());
    fireEvent.click(btn(container, /Apply to plan/));
    expect(container.textContent).toMatch(new RegExp(`${e0.name} removed`));
    expect(container.textContent).toMatch(/Runway after applying/);
  });

  it("cancelling changes nothing", () => {
    const { container, get } = scenariosView(doc());
    const before = get().employees.length;
    fireEvent.click(btn(container, /Apply to plan/));
    fireEvent.click(btn(container, /^Cancel$/));
    expect(get().employees).toHaveLength(before);
  });

  it("applying writes the changes into the real document", () => {
    // The step that did not exist: you modelled a freeze, decided to do it, and then re-entered every
    // change by hand on the real tabs.
    const { container, get } = scenariosView(doc());
    const before = get().employees.length;
    fireEvent.click(btn(container, /Apply to plan/));
    const modal = container.querySelector(".modal");
    fireEvent.click([...modal.querySelectorAll("button")].find(b => /^Apply to plan$/.test(b.textContent)));
    expect(get().employees).toHaveLength(before - 1);
    expect(get().employees.find(x => x.id === e0.id)).toBeUndefined();
  });

  it("keeps the scenario afterwards, so you can still compare against it", () => {
    const { container, get } = scenariosView(doc());
    fireEvent.click(btn(container, /Apply to plan/));
    const modal = container.querySelector(".modal");
    fireEvent.click([...modal.querySelectorAll("button")].find(b => /^Apply to plan$/.test(b.textContent)));
    expect(get().scenarios).toHaveLength(1);
  });
});

describe("adding a fundraise", () => {
  const open = (doc) => {
    const v = scenariosView(doc);
    fireEvent.click(btn(v.container, /New scenario/));
    fireEvent.click(btn(v.container, /Add a fundraise/));
    return v;
  };

  it("is offered, and does not need a round to already exist", () => {
    // Every other intent edits something already in the plan. "What if we raised" could not be asked
    // unless you had already entered the round you were uncertain about.
    const { container } = open({ ...demoDoc(), rounds: [] });
    expect(container.querySelector('[aria-label="Round amount"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Close month"]')).toBeTruthy();
  });

  it("adds the round AND turns financing on, visibly", () => {
    // Financing is a separate axis that defaults to off, so the round alone would move nothing at all.
    const { container, get } = open({ ...demoDoc(), rounds: [] });
    fireEvent.change(container.querySelector('[aria-label="Round name"]'), { target: { value: "Seed" } });
    fireEvent.change(container.querySelector('[aria-label="Round amount"]'), { target: { value: "3000000" } });
    fireEvent.click(btn(container, /Add this change/));

    const p = get().scenarios[0].patches;
    expect(p[0]).toMatchObject({ kind: "add", collection: "rounds" });
    expect(p[0].item).toMatchObject({ name: "Seed", amount: 3000000, status: "committed" });
    expect(p[1]).toMatchObject({ kind: "toggle", path: "financing", value: true });
    // and it is on screen, so the reason the numbers moved can be seen and taken back off
    expect(container.textContent).toMatch(/Financing on/);
  });

  it("moves the runway, which is the whole point", () => {
    const { container } = open({ ...demoDoc(), rounds: [] });
    expect(container.textContent).toMatch(/no change/);       // nothing added yet
    fireEvent.change(container.querySelector('[aria-label="Round amount"]'), { target: { value: "1000000" } });
    fireEvent.click(btn(container, /Add this change/));
    // Asserting IMPROVEMENT rather than a shape: the demo has enough revenue that a raise of this size
    // tips it past a zero date entirely, so pinning "+N mo" would pin the fixture, not the behaviour.
    expect(container.textContent).not.toMatch(/no change/);
    expect(container.textContent).toMatch(/cash-flow positive|\+\d+\.\d mo|36\+ mo/);
  });

  it("does not offer debt, which without terms is money that is never repaid", () => {
    const { container } = open(demoDoc());
    const kinds = [...container.querySelector('[aria-label="Round type"]').options].map(o => o.value);
    expect(kinds).toEqual(["safe", "equity", "note"]);
  });

  it("does not offer 'closed', which would emit no cash line at all", () => {
    // A closed round's money is already counted in `cash`; compileInstrument emits nothing for it.
    const { container } = open(demoDoc());
    const st = [...container.querySelector('[aria-label="Round status"]').options].map(o => o.value);
    expect(st).toEqual(["committed", "raising", "planning"]);
  });

  it("warns that a planned round is speculative and switched off by default", () => {
    const { container } = open(demoDoc());
    fireEvent.change(container.querySelector('[aria-label="Round status"]'), { target: { value: "planning" } });
    expect(container.textContent).toMatch(/speculative/i);
    expect(container.textContent).toMatch(/show no change/i);
  });

  it("needs an amount before it will add anything", () => {
    const { container } = open(demoDoc());
    expect(btn(container, /Add this change/).disabled).toBe(true);
    fireEvent.change(container.querySelector('[aria-label="Round amount"]'), { target: { value: "100" } });
    expect(btn(container, /Add this change/).disabled).toBe(false);
  });

  it("reads as a sentence in the change list", () => {
    const { container } = open({ ...demoDoc(), rounds: [] });
    fireEvent.change(container.querySelector('[aria-label="Round name"]'), { target: { value: "Series A" } });
    fireEvent.change(container.querySelector('[aria-label="Round amount"]'), { target: { value: "8000000" } });
    fireEvent.click(btn(container, /Add this change/));
    expect(container.textContent).toMatch(/Series A added — \$8,000,000 closing/);
  });
});
