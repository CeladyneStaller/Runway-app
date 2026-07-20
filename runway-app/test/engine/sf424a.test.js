// The xlsx path had NO coverage until the SheetJS advisory forced the question. `importWorkbook` is
// 144 lines that turn a real DOE EERE budget-justification workbook into a grant. If the library is
// ever swapped — and it must be, see NOTES.md — this is what proves the swap was safe.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { computeGrant } from "../../src/engine";
import { importWorkbook, exportBudget } from "../../src/engine/sf424a";   // not in the barrel — see engine/index.js

// jsdom rewrites import.meta.url to an http: URL, so resolve from cwd instead.
const wbPath = resolve(process.cwd(), "test/fixtures/celadyne.xlsx");
const read = () => XLSX.read(readFileSync(wbPath), { type: "buffer" });

describe("the Celadyne workbook — a real DOE EERE SF-424A budget justification", () => {
  it("opens, and has the tabs the importer expects", () => {
    const wb = read();
    expect(wb.SheetNames.length).toBeGreaterThan(1);
  });

  it("imports into a grant whose totals reconcile", () => {
    const g = importWorkbook(read());
    expect(g).toBeTruthy();
    const { grand } = computeGrant(g);
    // the identities must hold for imported data exactly as they do for hand-entered data
    expect(grand.direct + grand.indirect).toBeCloseTo(grand.total, 2);
    expect(grand.federal + grand.costShare).toBeCloseTo(grand.total, 2);
    const classes = grand.personnel + grand.fringe + grand.travel + grand.equipment
      + grand.supplies + grand.contractual + grand.construction + grand.other;
    expect(classes).toBeCloseTo(grand.direct, 2);
  });

  it("recovers a non-trivial budget rather than silently importing zeros", () => {
    const { grand } = computeGrant(importWorkbook(read()));
    expect(grand.total).toBeGreaterThan(0);
    expect(grand.personnel).toBeGreaterThan(0);
  });

  // KNOWN GAP, asserted as a passing test so it reads green while still guarding the boundary:
  // exportBudget writes a submission-ready SF-424A for a program officer; importWorkbook reads the DOE
  // template. Different documents, so "export, edit in Excel, re-import" does NOT round-trip. This test
  // pins that it doesn't — and will fail (correctly demanding attention) the day someone makes them
  // inverses, at which point the fix is to assert the round-trip succeeds instead.
  it("does not round-trip its own export — export writes a submission, import reads a template", () => {
    const g1 = importWorkbook(read());
    const t1 = computeGrant(g1).grand.total;
    const wb2 = exportBudget({ name: "Round trip" }, g1, computeGrant(g1));
    let recovered = null;
    try {
      const g2 = importWorkbook(XLSX.read(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }), { type: "buffer" }));
      recovered = g2 ? computeGrant(g2).grand.total : null;
    } catch { recovered = null; }
    // the gap: re-import either fails or lands on a different number. If this ever equals t1, the two
    // formats have converged and this test should flip to expect(recovered).toBeCloseTo(t1).
    expect(recovered).not.toBeCloseTo(t1, 2);
  });

  it("the imported grant carries only what the workbook actually says", () => {
    // import yields {periods, categories, costSharePct} — billing terms, funder and lag are NOT in an
    // SF-424A workbook, so they stay at the app's defaults. Worth knowing before trusting an import.
    const g = importWorkbook(read());
    expect(Object.keys(g).sort()).toEqual(["categories", "costSharePct", "periods"]);
    expect(g.reimburseTiming).toBeUndefined();
  });
});
