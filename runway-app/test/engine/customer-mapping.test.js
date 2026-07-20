// Piece 2: import is keyed on customer, not code. A customerMap resolves customer -> project, parallel
// to codeMap, and takes precedence when both are present. These pin the resolution and the end-to-end
// path: an imported customer row lands in the right project's actuals.
import { describe, it, expect } from "vitest";
import { resolveLine, codedActuals, overheadByMonth, unmappedCustomers, customersInLedger,
         unresolvedLines, mergeImport, OVERHEAD } from "../../src/engine";

describe("resolveLine consults both maps", () => {
  const maps = { codeMap: { "5000": "proj-code" }, customerMap: { "Acme Corp": "proj-cust" } };
  it("customer wins when both resolve", () => {
    expect(resolveLine({ customer: "Acme Corp", code: "5000" }, maps)).toBe("proj-cust");
  });
  it("falls back to code when no customer", () => {
    expect(resolveLine({ code: "5000" }, maps)).toBe("proj-code");
  });
  it("returns null when neither maps", () => {
    expect(resolveLine({ customer: "Unknown", code: "9999" }, maps)).toBeNull();
  });
  it("a bare codeMap (old call style) still works", () => {
    expect(resolveLine({ code: "5000" }, { "5000": "x" })).toBe("x");
  });
});

describe("customer discovery for the mapping UI", () => {
  const hist = [
    { month: 0, lines: [{ customer: "Acme", amount: 100 }, { customer: "Beta", amount: 50 }] },
    { month: 1, lines: [{ customer: "Acme", amount: 200 }, { code: "x", amount: 10 }] },
  ];
  it("lists distinct customers", () => {
    expect(customersInLedger(hist)).toEqual(["Acme", "Beta"]);
  });
  it("flags unmapped ones", () => {
    expect(unmappedCustomers(hist, { "Acme": "p1" })).toEqual(["Beta"]);
  });
});

describe("customer-coded spend reaches the project", () => {
  const hist = [
    { month: 0, lines: [{ customer: "Acme Corp", amount: 30000, note: "invoice work" }] },
    { month: 1, lines: [{ customer: "Acme Corp", amount: 25000 }] },
  ];
  const maps = { codeMap: {}, customerMap: { "Acme Corp": "proj-acme" } };
  it("codedActuals attributes it to the mapped project", () => {
    expect(codedActuals("proj-acme", hist, maps)).toEqual({ 0: 30000, 1: 25000 });
  });
  it("an unmapped customer's spend sits in overhead", () => {
    expect(overheadByMonth(hist, { codeMap: {}, customerMap: {} })).toEqual({ 0: 30000, 1: 25000 });
    expect(overheadByMonth(hist, maps)).toEqual({ 0: 0, 1: 0 });   // now attributed, out of baseline
  });
});

describe("import produces customer-bearing lines end to end", () => {
  it("a customer column survives the merge and then resolves", () => {
    const rows = [
      { date: "2026-07-05", customer: "Acme Corp", amount: 12000, note: "Q3" },
      { date: "2026-08-05", customer: "Beta LLC", amount: 8000 },
    ];
    const { history } = mergeImport([], rows, 2026, 6);
    expect(history[0].lines[0].customer).toBe("Acme Corp");
    // map one, leave the other
    const maps = { codeMap: {}, customerMap: { "Acme Corp": "proj-a" } };
    expect(codedActuals("proj-a", history, maps)).toEqual({ 0: 12000 });
    expect(unresolvedLines(history, maps).map(r => r.customer)).toEqual(["Beta LLC"]);
  });
});
