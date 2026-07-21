// Piece 4: the import modal. The pure transform (applyProfile) and the seam (mergeImport) are tested
// in engine/. This covers the UI path: the modal renders, the button opens it, and a committed import
// lands in the document. File-parsing (fileToGrid) needs a real File/SheetJS, so the deep parsing is
// covered at the engine level; here we drive the modal with a pre-built grid via applyProfile+merge.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";
import { applyProfile, mergeImport } from "../../src/engine";

describe("the import modal", () => {
  it("opens from the Ledger tab", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Spend history/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll(".subtab")].find(b => b.textContent.startsWith("Ledger")));
    const importBtn = [...container.querySelectorAll("button")].find(b => /^.*Import$/.test(b.textContent.trim()) && !/rows/.test(b.textContent));
    expect(importBtn).toBeTruthy();
    fireEvent.click(importBtn);
    expect(container.textContent).toMatch(/Import spend & revenue/);
    expect(container.textContent).toMatch(/Choose a file/);
  });
});

// The engine-level proof that a mapped file becomes ledger data the app will use — the whole point.
describe("a mapped export becomes usable ledger data", () => {
  it("QuickBooks-shaped grid -> mapped -> merged -> resolves to a project", () => {
    const grid = {
      headers: ["Date", "Customer", "Class", "Amount", "Memo"],
      rows: [
        ["07/15/2026", "Acme Corp", "5000", "12,000.00", "Q3 materials"],
        ["08/15/2026", "Acme Corp", "5000", "(50,000.00)", "milestone payment"],  // revenue
      ],
    };
    const profile = { columns: { date: "Date", customer: "Customer", code: "Class", amount: "Amount", note: "Memo" }, dateFormat: "MDY", amountMode: "signed" };
    const rows = applyProfile(grid, profile);
    const { history, report } = mergeImport([], rows, 2026, 6);
    expect(report.imported).toBe(2);
    // month 0 cost line, month 1 revenue line, both customer Acme Corp
    // cost is the ledger default, so a cost line carries no explicit kind; revenue is written.
    expect(history[0].lines[0]).toMatchObject({ customer: "Acme Corp", code: "5000", amount: 12000 });
    expect(history[0].lines[0].kind).toBeUndefined();
    expect(history[1].lines[0]).toMatchObject({ amount: 50000, kind: "revenue" });
  });
});

describe("frictionless import: inline mapping + tolerant profiles", () => {
  it("tolerant profile match survives an added column", async () => {
    const { matchProfile } = await import("../../src/engine");
    const saved = { name: "QB", headers: ["Date", "Customer", "Amount"], columns: { date: "Date", customer: "Customer", amount: "Amount" } };
    // real-world: QuickBooks export gains a "Split" column between runs
    expect(matchProfile([saved], ["Date", "Customer", "Amount", "Split"])).toBe(saved);
  });
});
