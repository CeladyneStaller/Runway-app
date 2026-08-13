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
const wbPath = resolve(process.cwd(), "test/fixtures/harborpoint.xlsx");
const read = () => XLSX.read(readFileSync(wbPath), { type: "buffer" });

describe("the Harbor Point workbook — a real DOE EERE SF-424A budget justification", () => {
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

  // ⚠️ THE GAP CLOSED, AND THE TEST SAID WHAT TO DO WHEN IT DID.
  //
  // This used to assert that export -> re-import does NOT round-trip: `exportBudget` wrote a
  // submission-ready SF-424A for a program officer, `importWorkbook` read the blank template, and they
  // were different documents. The old test pinned that gap so nobody assumed a round trip that did not
  // work — and its comment said that if the two ever converged, the fix was to assert the round trip
  // SUCCEEDS instead.
  //
  // They have converged: the exported workbook re-imports to the same grand total, to the cent. So the
  // assertion is inverted rather than deleted, and the property it now protects is the more useful one:
  // **you can export, edit in Excel, and re-import without losing money.**
  //
  // ⚠️ IT ONLY BECAME VISIBLE WHEN `exportBudget` STOPPED WRITING TO DISK. Before that it threw at
  // `XLSX.writeFile` under the test environment, so this assertion had not run in a long time — the
  // convergence could have happened at any point and nothing would have said so. **A test that cannot
  // reach its assertion is not a passing test or a failing one; it is an absent one.**
  it("round-trips its own export — export and import now agree on the same workbook", () => {
    const g1 = importWorkbook(read());
    const t1 = computeGrant(g1).grand.total;
    const { wb: wb2, filename } = exportBudget({ name: "Round trip" }, g1, computeGrant(g1));

    // It builds a workbook and names it; saving is the caller's job, which is what makes this testable.
    expect(filename).toMatch(/Round trip.*\.xlsx$/);

    const g2 = importWorkbook(XLSX.read(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }),
                                        { type: "buffer" }));
    expect(g2).toBeTruthy();
    expect(computeGrant(g2).grand.total).toBeCloseTo(t1, 2);
  });

  it("the imported grant carries only what the workbook actually says", () => {
    // import yields {periods, categories, costSharePct} — billing terms, funder and lag are NOT in an
    // SF-424A workbook, so they stay at the app's defaults. Worth knowing before trusting an import.
    const g = importWorkbook(read());
    expect(Object.keys(g).sort()).toEqual(["categories", "costSharePct", "periods"]);
    expect(g.reimburseTiming).toBeUndefined();
  });
});

describe("milestone schedule month placement (F8 residual fix)", () => {
  it("keeps a payment's real month rather than clamping past-horizon payments onto month 18", async () => {
    const { parseScheduleAoa } = await import("../../src/engine/sf424a");
    const aoa = [
      ["Milestone", "Month", "Payment"],
      ["Kickoff", 2, 50000],
      ["Final delivery", 24, 200000],   // past the 18-month horizon
    ];
    const rows = parseScheduleAoa(aoa);
    const final = rows.find(r => r.label === "Final delivery");
    // floorM keeps 24 (so the projection lets it fall off the horizon); clampM would have made it 18,
    // sliding a $200k payment onto the last visible month and inflating it.
    expect(final.month).toBe(24);
    expect(rows.find(r => r.label === "Kickoff").month).toBe(2);
  });
});

describe("import recovers funder + billing the export writes (narrows the export/import gap)", () => {
  it("reads Funder and Billing rows when a workbook carries them", async () => {
    const { importWorkbook } = await import("../../src/engine/sf424a");
    // start from the importable fixture, inject Funder + Billing rows into its Cost Categories sheet
    const wb = read();
    const name = wb.SheetNames.find(n => /cost categor|section b|424a/i.test(n));
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
    aoa.splice(2, 0, ["Funder", "ARPA-E"], ["Billing", "Monthly (as incurred)"]);
    wb.Sheets[name] = XLSX.utils.aoa_to_sheet(aoa);
    const back = importWorkbook(wb);
    // the injected terms come back; TIMING_LABEL reversal maps the label to the key
    expect(back.funder).toBe("ARPA-E");
    expect(back.reimburseTiming).toBe("monthly");
  });

  it("a template-only import (no funder/billing rows) returns the original shape, fields undefined", async () => {
    // importing a workbook without those rows shouldn't invent them
    const { importWorkbook } = await import("../../src/engine/sf424a");
    const back = importWorkbook(read());   // the DOE-template fixture, no Funder/Billing rows
    expect(back.periods.length).toBeGreaterThan(0);
    // funder/billing absent -> keys simply not present (defaults applied downstream)
    expect(back.funder).toBeUndefined();
  });
});
