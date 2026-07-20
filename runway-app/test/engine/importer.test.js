// The import merge seam — format-agnostic. A QuickBooks CSV, an Excel file, or this mock all produce
// ImportRow[]; this is what turns them into ledger months. The parser (which reads the actual file)
// sits on top of this and is the only part that depends on QuickBooks' column names.
import { describe, it, expect } from "vitest";
import { monthIndexOf, mergeImport, codesInRows } from "../../src/engine";

// model starts Jul 2026 (startY 2026, startM 6), as the demo does
const SY = 2026, SM = 6;

describe("calendar date -> month index", () => {
  it("maps against the model start", () => {
    expect(monthIndexOf("2026-07-15", SY, SM)).toBe(0);
    expect(monthIndexOf("2026-08-01", SY, SM)).toBe(1);
    expect(monthIndexOf("2026-12-31", SY, SM)).toBe(5);
    expect(monthIndexOf("2027-07-01", SY, SM)).toBe(12);
  });
  it("returns negative for dates before the start", () => {
    expect(monthIndexOf("2026-06-15", SY, SM)).toBe(-1);
    expect(monthIndexOf("2026-01-01", SY, SM)).toBe(-6);
  });
  it("rejects an unparseable date", () => {
    expect(monthIndexOf("not a date", SY, SM)).toBeNull();
  });
});

describe("merging rows into a ledger", () => {
  const rows = [
    { date: "2026-07-03", code: "CUST-A", amount: 5000, note: "materials" },
    { date: "2026-07-20", code: "CUST-B", amount: 3000 },
    { date: "2026-08-10", code: "CUST-A", amount: 4000, note: "labor" },
  ];

  it("groups by month and produces ledger lines", () => {
    const { history, report } = mergeImport([], rows, SY, SM);
    expect(report.imported).toBe(3);
    expect(history).toHaveLength(2);              // July + August
    expect(history[0].month).toBe(0);
    expect(history[0].lines).toHaveLength(2);     // two July rows
    expect(history[0].lines[0]).toEqual({ code: "CUST-A", amount: 5000, note: "materials" });
    expect(history[1].lines[0].note).toBe("labor");
  });

  it("appends to an existing month rather than replacing it", () => {
    const existing = [{ month: 0, lines: [{ code: "6000", amount: 44000, note: "payroll" }] }];
    const { history } = mergeImport(existing, rows, SY, SM);
    const july = history.find(m => m.month === 0);
    expect(july.lines).toHaveLength(3);           // 1 existing + 2 imported
    expect(july.lines[0].code).toBe("6000");      // existing kept
  });

  it("surfaces rows before the start date instead of silently dropping them", () => {
    const withEarly = [...rows, { date: "2026-05-01", code: "CUST-A", amount: 999 }];
    const { report } = mergeImport([], withEarly, SY, SM);
    expect(report.beforeStart).toBe(1);
    expect(report.imported).toBe(4);              // kept by default
  });

  it("can drop pre-start rows when asked", () => {
    const withEarly = [...rows, { date: "2026-05-01", code: "X", amount: 999 }];
    const { history, report } = mergeImport([], withEarly, SY, SM, { dropBeforeStart: true });
    expect(report.imported).toBe(3);
    expect(history.every(m => m.month >= 0)).toBe(true);
  });

  it("counts bad rows rather than crashing on them", () => {
    const messy = [
      { date: "2026-07-01", code: "A", amount: "not a number" },
      { date: "garbage", code: "B", amount: 100 },
      { date: "2026-07-01", code: "C", amount: 200 },
    ];
    const { report } = mergeImport([], messy, SY, SM);
    expect(report.badAmount).toBe(1);
    expect(report.badDate).toBe(1);
    expect(report.imported).toBe(1);
  });
});

describe("code discovery from rows", () => {
  it("lists distinct codes so the UI can prompt for mapping", () => {
    const rows = [{ code: "A" }, { code: "B" }, { code: "A" }, { code: "" }, { code: "C" }];
    expect(codesInRows(rows)).toEqual(["A", "B", "C"]);
  });
});
