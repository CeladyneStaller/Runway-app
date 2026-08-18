// Company spend is now a coded ledger; codes map to projects; coded spend becomes each project's
// actuals. Uncoded stays in the baseline. Manual override redistributes within a project and flags
// when it changes the total.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { canaryDoc as demoDoc, migrate, SCHEMA_VERSION } from "../../src/state/document";

function open(doc) {
  let d = doc;
  const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
  const click = (re, sel = "button") => { const b = [...container.querySelectorAll(sel)].find(x => re.test(x.textContent)); if (b) fireEvent.click(b); return !!b; };
  return { container, click, get: () => d };
}

describe("the spend ledger", () => {
  it("renders coded lines with their mapped project", () => {
    const api = open(demoDoc());
    api.click(/Spend history/i);
    api.click(/^Ledger/, ".subtab");
    // the demo maps 5000 -> Catalyst; that name should appear against the coded line
    expect(api.container.textContent).toMatch(/Catalyst scale-up/);
    expect(api.container.querySelector(".ledmonth")).toBeTruthy();
  });
  it("prompts to map a code it hasn't seen", () => {
    const doc = { ...demoDoc(), codeMap: {} };   // forget every mapping
    const api = open(doc);
    api.click(/Spend history/i);
    api.click(/^Ledger/, ".subtab");
    expect(api.container.textContent).toMatch(/Unmapped cost codes/i);
    expect(api.container.querySelectorAll(".ledmonth")).toBeTruthy();
  });
  it("a v1 document migrates to a ledger without losing its totals", () => {
    const v1 = { schemaVersion: 1, cash: 100000, history: [{ mo: "Jan", v: 50000, note: "x" }], settings: {} };
    const d = migrate(v1);
    // THE CURRENT VERSION, not a hard-coded number that has to be edited on every schema bump — the
    // point of the assertion is "it walked the whole chain", and pinning a literal made it fail when
    // v4 arrived for a reason that had nothing to do with ledgers.
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.history[0].lines).toEqual([{ code: "", amount: 50000, note: "x" }]);
  });
});

describe("customer mapping (Piece 2)", () => {
  it("surfaces an unmapped customer with a project dropdown", () => {
    let d = demoDoc();
    d.history = [{ month: 0, lines: [{ customer: "Acme Corp", amount: 15000 }] }, ...d.history.slice(1)];
    const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Spend history/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll(".subtab")].find(b => b.textContent.startsWith("Ledger")));
    expect(container.textContent).toMatch(/Unmapped customers/);
    const panel = [...container.querySelectorAll(".panel")].find(p => /Unmapped customers/.test(p.textContent));
    expect(panel.querySelector("select")).toBeTruthy();
    expect(panel.textContent).toMatch(/Acme Corp/);
  });
})

describe("revenue replacement (Piece 3)", () => {
  it("flags recorded revenue that differs from projection", () => {
    const d = demoDoc();
    d.history = [
      { month: 0, lines: [{ code: "5000", amount: 12345, kind: "revenue", note: "actual payment" }] },
      ...d.history.slice(1),
    ];
    const { container } = render(<RunwayApp doc={d} setDoc={() => {}} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Spend history/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll(".subtab")].find(b => b.textContent.startsWith("Ledger")));
    expect(container.textContent).toMatch(/Recorded revenue differs from projection/);
    expect(container.textContent).toMatch(/Catalyst/);
  });
})
