// Company spend is now a coded ledger; codes map to projects; coded spend becomes each project's
// actuals. Uncoded stays in the baseline. Manual override redistributes within a project and flags
// when it changes the total.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc, migrate } from "../../src/state/document";

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
    expect(d.schemaVersion).toBe(2);
    expect(d.history[0].lines).toEqual([{ code: "", amount: 50000, note: "x" }]);
  });
});
