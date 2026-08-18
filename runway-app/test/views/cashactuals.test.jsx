// Recorded cash is a DOCUMENT field. It used to be App-local useState seeded with the demo's numbers,
// which caused three distinct failures — each asserted here so none can come back.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { emptyDoc, canaryDoc as demoDoc } from "../../src/state/document";
import { buildProjection, zeroInfo, anchorToActuals } from "../../src/engine";

function harness(initial) {
  const ref = { current: initial };
  function H() {
    const [d, setD] = useState(initial);
    ref.current = d;
    return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
  }
  const { container } = render(<H />);
  return { container, get: () => ref.current };
}
const toCash = (container) => {
  fireEvent.click([...container.querySelectorAll("button")].find(b => /history/i.test(b.textContent)));
  const t = [...container.querySelectorAll(".subtab")].find(b => /cash/i.test(b.textContent));
  if (t) fireEvent.click(t);
};

describe("recorded cash is a document field", () => {
  it("a brand-new user does NOT see the demo company's recorded balances", () => {
    const fresh = emptyDoc(); fresh.cash = 100000;
    const { container } = harness(fresh);
    toCash(container);
    // the demo's 560,000 / 467,000 must not appear in an empty document
    expect(container.textContent).not.toMatch(/560,?000/);
    expect(container.textContent).not.toMatch(/467,?000/);
  });

  it("reads recorded cash FROM the document (the old local state ignored doc entirely)", () => {
    const d = emptyDoc();
    d.cash = 100000;
    // a distinctive value that appears nowhere in the demo or the hardcoded seed
    d.cashActuals = { 0: { cash: 123456, revenue: 0, additional: 0, grants: {} } };
    const { container } = harness(d);
    toCash(container);
    expect(container.textContent).toMatch(/123,456/);
  });

  it("saving a recorded month writes it into the document, so it survives a reload", () => {
    const fresh = emptyDoc(); fresh.cash = 100000;
    const h = harness(fresh);
    expect(h.get().cashActuals).toEqual({});
    toCash(h.container);
    // "Add month" opens the modal; the modal's own confirm (also labelled "Add month") is what commits
    const openers = [...h.container.querySelectorAll("button")].filter(b => /add month/i.test(b.textContent));
    fireEvent.click(openers[0]);
    const confirms = [...h.container.querySelectorAll("button")].filter(b => /add month/i.test(b.textContent));
    expect(confirms.length).toBeGreaterThan(1);   // opener + modal confirm
    fireEvent.click(confirms[confirms.length - 1]);
    // the commit must land in the DOCUMENT, not just React state
    expect(Object.keys(h.get().cashActuals).length).toBeGreaterThan(0);
  });

  it("a fresh user's runway is NOT anchored to demo cash (was 8.3mo shown for a true 4.0mo)", () => {
    const model = { cashOnHand: 100000, horizon: 36,
      lineItems: [{ kind: "cost", cadence: "recurring", amount: 25000, start: 0 }] };
    const T = { committed: true, expected: true, speculative: false, financing: false };
    const rows = buildProjection(model, T);
    // with an empty document there is nothing to anchor to, so the honest number stands
    const anchored = anchorToActuals(rows, emptyDoc().cashActuals, true);
    expect(zeroInfo(anchored).months).toBeCloseTo(4.0, 1);
  });

  it("the demo still carries its recorded cash, with the field name the UI reads", () => {
    const d = demoDoc();
    expect(d.cashActuals[0].cash).toBe(560000);
    expect(d.cashActuals[0].revenue).toBe(15000);   // `revenue`, not `rev` — History reads r.revenue
    expect(d.cashActuals[4].cash).toBe(108000);
  });
});
