// Two failures, one reported and one structural.
//
// REPORTED: the Scenarios tab was a blank white screen that could not be escaped. `zeroInfo` returns
// NULL — not `{ months: null }` — when the balance never crosses zero, and Scenarios dereferenced
// `.months` on it. Any model with cash and no burn crashed, which is every brand-new account between
// entering cash and adding a first expense.
//
// STRUCTURAL: that it took the WHOLE APP down. React unmounts the tree on an uncaught render error, so
// there was no rail left to navigate away with. The fix for the deref is one line; the fix for
// "unescapable" is a boundary, and the second one matters more because it covers the next bug too.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp, ViewBoundary } from "../../src/App";
import { demoDoc, emptyDoc } from "../../src/state/document";

vi.mock("../../src/views/Milestones", () => ({
  Milestones: () => { throw new Error("deliberate test explosion"); },
}));

const openView = (initial, label) => {
  function H() { const [d, setD] = useState(initial); return <RunwayApp doc={d} setDoc={setD} />; }
  const { container } = render(<H />);
  fireEvent.click([...container.querySelectorAll("button.nav")].find(b => new RegExp(label).test(b.textContent)));
  return container;
};

// React logs caught render errors loudly; the boundary is the thing under test, not the noise.
let quiet;
beforeEach(() => { quiet = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => quiet.mockRestore());

describe("Scenarios opens for a runway that never ends", () => {
  it("cash but no burn — the exact model that showed a white screen", () => {
    const c = openView({ ...emptyDoc(), cash: 250000 }, "Scenarios");
    expect(c.textContent).toMatch(/Runway comparison/);
    // The label is now specific about WHICH kind of "no zero date" this is; it used to say
    // "cash-positive" for a steady burner that merely outlasted the horizon.
    expect(c.textContent).toMatch(/cash-flow positive/);
    expect(c.textContent).not.toMatch(/couldn't be drawn/);
  });

  it("and with a saved scenario in the table, which reads the zero date a second way", () => {
    const doc = { ...emptyDoc(), cash: 250000, scenarios: [{ id: "s1", name: "Hire two", patches: [] }] };
    const c = openView(doc, "Scenarios");
    expect(c.textContent).toMatch(/Hire two/);
    expect(c.textContent).toMatch(/cash-flow positive/);
  });

  it("still reports a finite runway when there IS burn", () => {
    const c = openView(demoDoc(), "Scenarios");
    expect(c.textContent).toMatch(/4\.3 mo/);   // the DEMO carries five commitments; the seed still reads 5.6;
  });
});

describe("a crashing view is escapable", () => {
  it("keeps the rail and the nav mounted, so there is somewhere to go", () => {
    const c = openView(demoDoc(), "Milestones");
    expect(c.textContent).toMatch(/couldn't be drawn/);
    // THE POINT. Before the boundary this was an empty <body> — no rail, no nav, no escape.
    expect(c.querySelector(".railfoot")).toBeTruthy();
    expect([...c.querySelectorAll("button.nav")].length).toBeGreaterThan(5);
  });

  it("recovers when you navigate away — the boundary is keyed on the view", () => {
    const c = openView(demoDoc(), "Milestones");
    expect(c.textContent).toMatch(/couldn't be drawn/);
    fireEvent.click([...c.querySelectorAll("button.nav")].find(b => /Dashboard/.test(b.textContent)));
    // Without the key the boundary would stay stuck in its error state on every subsequent view.
    expect(c.textContent).not.toMatch(/couldn't be drawn/);
    expect(c.textContent).toMatch(/Runway remaining/i);
  });

  it("says the model is unharmed, and shows the error for a bug report", () => {
    const c = openView(demoDoc(), "Milestones");
    expect(c.textContent).toMatch(/has not been changed/i);
    expect(c.textContent).toMatch(/deliberate test explosion/);
  });

  it("offers a way back that actually fires", () => {
    const onLeave = vi.fn();
    const Boom = () => { throw new Error("kaboom"); };
    const { container } = render(<ViewBoundary label="Payroll" onLeave={onLeave}><Boom /></ViewBoundary>);
    expect(container.textContent).toMatch(/Payroll couldn't be drawn/);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Back to the dashboard/.test(b.textContent)));
    expect(onLeave).toHaveBeenCalled();
  });

  it("passes children straight through when nothing is wrong", () => {
    const { container } = render(<ViewBoundary label="X" onLeave={() => {}}><p>fine</p></ViewBoundary>);
    expect(container.textContent).toBe("fine");
  });
});

describe("a caught crash is reported, not just logged", () => {
  it("hands the boundary's error to the reporter with the view name", async () => {
    // It used to console.error only, which in production means a console nobody is reading.
    const { initErrorReporting, _resetErrorReporting } = await import("../../src/state/errors");
    const sent = [];
    initErrorReporting(e => sent.push(e));
    try {
      openView(demoDoc(), "Milestones");
      expect(sent.length).toBeGreaterThan(0);
      expect(sent[0].message).toMatch(/deliberate test explosion/);
      expect(sent[0].context).toMatchObject({ kind: "view-crash", view: "Milestones" });
    } finally { _resetErrorReporting(); }
  });

  it("sends no document data along with it", async () => {
    const { initErrorReporting, _resetErrorReporting } = await import("../../src/state/errors");
    const sent = [];
    initErrorReporting(e => sent.push(e));
    try {
      openView(demoDoc(), "Milestones");
      const blob = JSON.stringify(sent);
      expect(blob).not.toMatch(/Alex Rivera|Harbor Point|560000/);
    } finally { _resetErrorReporting(); }
  });
});
