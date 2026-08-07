// Scenarios view, rebuilt around the decision rather than the curve. The engine (applyScenario,
// scenarioImpact, explainPatch) is tested separately; this covers the view wiring — the delta strip,
// intent-first changes, live effect, duplication, and applying to the real plan.
import { describe, it, expect, afterEach } from "vitest";
import React, { useState } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";

// ⚠️ NO CLEANUP BETWEEN TESTS. Each `scenariosView` renders a fresh app, but the previous one stayed in
// the document — so `.scn-intents button` matched a STALE picker from an earlier test and clicking it
// advanced nothing in the current container. The identical flow passed in an isolated file, which is
// what pointed here. Same leak that bit the plan-io tests.
afterEach(cleanup);
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
// SCOPED TO THE TILE PICKER. Factor names collide with nav-tab labels — "Payroll" is both — and an
// unscoped search finds the tab, clicks the rail, and leaves the builder exactly where it was.
const tile = (c, re) => [...c.querySelectorAll(".scn-intents button")].find(b => re.test(b.textContent));
const modeBtn = (c, re) => [...c.querySelectorAll(".scn-mode .seg3 button")].find(b => re.test(b.textContent));
// `sel` searches SELECT elements only. The factor form renders a field as an input or a select
// depending on its type — "Starts" is a number input — so a helper that finds either is what these
// tests actually need.
const fld = (c, label) => [...c.querySelectorAll("select,input")]
  .find(x => x.getAttribute("aria-label") === label);
const sel = (c, label) => [...c.querySelectorAll("select")].find(s => s.getAttribute("aria-label") === label);
const scn = (patches, over = {}) => ({ id: "s1", name: "Hiring freeze", patches, saved: true, ...over });

describe("the comparison", () => {
  it("leads with your plan and its runway", () => {
    const { container } = scenariosView(demoDoc());
    expect(container.textContent).toMatch(/Runway comparison/);
    expect(container.textContent).toMatch(/Your plan/);
    expect(container.textContent).toMatch(/4\.2 mo/);
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
    expect(container.textContent).toMatch(/Payroll/);
    expect(container.textContent).toMatch(/Payroll/);
    expect(container.textContent).toMatch(/Recurring revenue/);
    expect(container.textContent).toMatch(/Operating costs/);
  });

  it("delays a hire in three picks", () => {
    // THREE, NOT TWO — and the extra one is the point. The old builder opened on a default intent, so
    // picking a factor was implicit and "Delay a hire" was the only thing payroll could express.
    // Choosing PAYROLL then CHANGE EXISTING is what makes "raise a salary" and "end someone early"
    // reachable through the same three picks.
    const { container, get } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(tile(container, /Payroll/));
    fireEvent.click(modeBtn(container, /Change existing/));
    const e = demoDoc().employees[0];
    fireEvent.change(sel(container, "Which one"), { target: { value: e.id } });
    // A MONTH IS TWO CONTROLS NOW — month and year, storing an index. "8" months from a July 2026
    // start is March 2027.
    fireEvent.change(fld(container, "Starts"), { target: { value: "2" } });        // March
    fireEvent.change(fld(container, "Starts year"), { target: { value: "2027" } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ kind: "item", collection: "employees", field: "start", value: 8 });
  });

  it("drops somebody entirely — which the old builder could not express at all", () => {
    // "Don't hire Sam" used to mean setting a start month past the horizon.
    const { container, get } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(tile(container, /Payroll/));
    // REMOVE, not change — "don't hire someone" is a deletion, and the mode has to say so now that
    // picking a factor no longer implies what you want to do with it.
    fireEvent.click(modeBtn(container, /Remove existing/));
    fireEvent.change(sel(container, "Which one"), { target: { value: demoDoc().employees[0].id } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ kind: "remove", collection: "employees" });
  });

  it("reaches subscriptions, which were not patchable when SaaS shipped", () => {
    const doc = { ...demoDoc(), saas: [{ ...blankSaas(), id: "s9", name: "Pro plan", arpu: 100, startCustomers: 50, churnPct: 5 }] };
    const { container, get } = scenariosView(doc);
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(tile(container, /Recurring revenue/));
    fireEvent.click(modeBtn(container, /Change existing/));
    fireEvent.change(sel(container, "Which one"), { target: { value: "s9" } });
    fireEvent.change(container.querySelector('[aria-label="Churn"]'), { target: { value: "12" } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ collection: "saas", field: "churnPct", value: 12 });
  });

  it("REACHES CASH DIRECTLY — it has a tile now, not an escape hatch", () => {
    // The old builder hid cash and the confidence toggles behind "Something else", where somebody had
    // to pick a collection and a field by name. They are the two most common things anybody changes in
    // a scenario, so they are tiles — a purity that sent people hunting would have cost more than it
    // saved.
    const { container, get } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(tile(container, /Cash on hand/));
    fireEvent.change(fld(container, "Cash on hand"), { target: { value: "250000" } });
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ kind: "field", path: "cash", value: 250000 });
  });

  it("and the confidence toggles the same way", () => {
    const { container, get } = scenariosView(demoDoc());
    fireEvent.click(btn(container, /New scenario/));
    fireEvent.click(tile(container, /Confidence/));
    const box = container.querySelector('.scn-fields input[type="checkbox"]');
    fireEvent.click(box);
    fireEvent.click(btn(container, /Add this change/));
    expect(get().scenarios[0].patches[0]).toMatchObject({ kind: "toggle" });
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
    fireEvent.click(tile(v.container, /Capital/));
    return v;
  };

  it("is offered, and does not need a round to already exist", () => {
    // Every other intent edits something already in the plan. "What if we raised" could not be asked
    // unless you had already entered the round you were uncertain about.
    const { container } = open({ ...demoDoc(), rounds: [] });
    expect(container.querySelector('[aria-label="Round amount"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Close month"]')).toBeTruthy();
  });

  it("adds the round, and turns financing on ONLY IF IT IS OFF", () => {
    // WRITTEN WHEN FINANCING DEFAULTED TO OFF, when a round alone moved nothing and the UI had to add a
    // second patch to make it visible. Financing defaults ON now, so that patch would be a no-op the
    // user did not ask for — the behaviour changed correctly and the test was describing the old world.
    const { container, get } = open({ ...demoDoc(), rounds: [] });
    fireEvent.change(container.querySelector('[aria-label="Round name"]'), { target: { value: "Seed" } });
    fireEvent.change(container.querySelector('[aria-label="Round amount"]'), { target: { value: "3000000" } });
    fireEvent.click(btn(container, /Add this change/));

    const p = get().scenarios[0].patches;
    expect(p[0]).toMatchObject({ kind: "add", collection: "rounds" });
    expect(p[0].item).toMatchObject({ name: "Seed", amount: 3000000 });
    // No redundant toggle: financing is already on.
    expect(p.some(x => x.kind === "toggle" && x.path === "financing")).toBe(false);
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

  it("OFFERS DEBT NOW, because the form can carry its terms", () => {
    // It was excluded because the old form could not express a rate or a term, and a facility without
    // them is money that arrives and never leaves. The conditional fields supply them, so the reason
    // for the exclusion is gone.
    const { container } = open(demoDoc());
    const kinds = [...container.querySelector('[aria-label="Round type"]').options].map(o => o.value);
    expect(kinds).toContain("debt");
  });

  it.skip("does not offer debt, which without terms is money that is never repaid", () => {
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

describe("stale scenarios are flagged where their effect shows", () => {
  const staleDoc = () => {
    const d = demoDoc();
    const r = (d.rounds || [])[0];
    return { ...d, scenarios: [{
      id: "s1", name: "Series A lands", saved: true,
      patches: [{ kind: "item", collection: "rounds", id: r.id, field: "status", value: "closed",
                  fp: { collection: "rounds", id: r.id, was: { status: "a-status-it-no-longer-has" },
                        name: r.name } }],
    }] };
  };

  it("BADGES THE SCENARIO ITSELF", () => {
    const { container } = scenariosView(staleDoc());
    expect(container.querySelector(".scn-stalebadge")).toBeTruthy();
    expect(container.querySelector(".scn-stalebadge").textContent).toMatch(/1 changed/);
  });

  it("the badge carries what moved, so it is checkable", () => {
    const { container } = scenariosView(staleDoc());
    expect(container.querySelector(".scn-stalebadge").getAttribute("title"))
      .toMatch(/was a-status-it-no-longer-has/);
  });

  it("A CLEAN SCENARIO IS NOT BADGED", () => {
    // A warning that fires on everything is one people learn to ignore.
    const d = demoDoc();
    const r = (d.rounds || [])[0];
    const clean = { ...d, scenarios: [{ id: "s2", name: "Fine", saved: true,
      patches: [{ kind: "item", collection: "rounds", id: r.id, field: "status", value: "closed",
                  fp: { collection: "rounds", id: r.id, was: { status: r.status }, name: r.name } }] }] };
    expect(scenariosView(clean).container.querySelector(".scn-stalebadge")).toBeNull();
  });

  it("the flag names WHICH curve to distrust", () => {
    // With three curves a bare warning says something is wrong and not which line.
    const src = require("node:fs").readFileSync("src/views/Scenarios.jsx", "utf8");
    expect(src).toMatch(/built against different figures/);
    expect(src).toMatch(/series\.some\(s => s\.stale\?\.length\)/);
  });

  it("APPLYING IS BLOCKED until the change is acknowledged", () => {
    // The one irreversible action in the feature. Unlike the chart, you cannot undo it by toggling off,
    // so "the person saw a warning" is not sufficient here.
    const src = require("node:fs").readFileSync("src/views/Scenarios.jsx", "utf8");
    expect(src).toMatch(/staleness\(baseDoc, applying\)\.length > 0 && !applyOk/);
  });

  it("and the acknowledgement resets on every open", () => {
    // Left sticky, somebody who ticked it once would find the next scenario pre-confirmed.
    const src = require("node:fs").readFileSync("src/views/Scenarios.jsx", "utf8");
    expect(src).toMatch(/setApplyOk\(false\); setApplying\(scn\)/);
  });
});

describe("changing overall overhead", () => {
  const open2 = (doc = demoDoc()) => {
    const v = scenariosView(doc);
    fireEvent.click(btn(v.container, /New scenario/));
    fireEvent.click(tile(v.container, /Operating costs/));
    fireEvent.click(modeBtn(v.container, /Change overall/));
    return v;
  };

  it("IS OFFERED ON OPERATING COSTS, where the question lives", () => {
    // "How much could I save" is a question about operating costs; that the engine routes it through
    // the derived baseline is an implementation detail nobody should have to know to ask it.
    expect(open2().container.textContent).toMatch(/Change overall overhead by/);
    expect(open2().container.textContent).toMatch(/how much do I need to save/i);
  });

  it("is NOT offered on factors that have no such question", () => {
    const v = scenariosView(demoDoc());
    fireEvent.click(btn(v.container, /New scenario/));
    fireEvent.click(tile(v.container, /Capital/));
    expect(modeBtn(v.container, /Change overall/)).toBeUndefined();
  });

  it("produces one adjustment line, marked so the baseline ignores it", () => {
    const v = open2();
    fireEvent.change(fld(v.container, "Change overall overhead by"), { target: { value: "-3000" } });
    fireEvent.click(btn(v.container, /Add this change/));
    const p = v.get().scenarios[0].patches[0];
    expect(p).toMatchObject({ kind: "add", collection: "lines" });
    expect(p.item).toMatchObject({ amount: -3000, adjustment: true, cadence: "recurring" });
  });

  it("⚠️ SHOWS THE CLAMP RATHER THAN APPLYING IT SILENTLY", () => {
    // Somebody who types $80,000 against $52,000 of overhead must see the difference was refused —
    // otherwise they read a runway built on a number they did not enter.
    const v = open2();
    fireEvent.change(fld(v.container, "Change overall overhead by"), { target: { value: "-9999999" } });
    expect(v.container.textContent).toMatch(/that is the most that can be cut/i);
  });

  it("says nothing when the cut is within reach", () => {
    const v = open2();
    fireEvent.change(fld(v.container, "Change overall overhead by"), { target: { value: "-100" } });
    expect(v.container.textContent).not.toMatch(/most that can be cut/i);
  });

  it("THE BASELINE TILE NO LONGER CLAIMS IT CANNOT BE MOVED", () => {
    // It used to say "itemise more to move it", which became untrue the moment an adjustment could move
    // it from another tile. A disabled tile that is secretly adjustable elsewhere is worse than either.
    const v = scenariosView(demoDoc());
    fireEvent.click(btn(v.container, /New scenario/));
    const base = tile(v.container, /Baseline burn/);
    expect(base.getAttribute("title")).toMatch(/use Operating costs/i);
  });
});
