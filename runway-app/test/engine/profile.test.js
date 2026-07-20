// Piece 4: the pure column-mapping transform. A raw grid + a profile -> ImportRow[]. The two danger
// zones get the most tests: date-format ambiguity (03/04 is March or April ONLY per the profile) and
// amount-sign interpretation (QuickBooks writes money several ways). No real file needed to test any
// of this — that's the point of keeping it pure.
import { describe, it, expect } from "vitest";
import { applyProfile, parseAmount, parseDateWith } from "../../src/engine";

describe("parseAmount — the sign/format modes", () => {
  it("strips currency symbols and thousands separators", () => {
    expect(parseAmount("$1,234.50", "expensesPositive")).toEqual({ amount: 1234.5, kind: "cost" });
  });
  it("reads accounting parentheses as negative", () => {
    expect(parseAmount("(500.00)", "signed")).toEqual({ amount: 500, kind: "revenue" });
  });
  it("expensesPositive: everything is cost, magnitude only", () => {
    expect(parseAmount("800", "expensesPositive")).toEqual({ amount: 800, kind: "cost" });
    expect(parseAmount("-800", "expensesPositive")).toEqual({ amount: 800, kind: "cost" });
  });
  it("signed: positive=cost (out), negative=revenue (in)", () => {
    expect(parseAmount("1000", "signed")).toEqual({ amount: 1000, kind: "cost" });
    expect(parseAmount("-1000", "signed")).toEqual({ amount: 1000, kind: "revenue" });
  });
  it("rejects non-numbers", () => {
    expect(parseAmount("Total", "signed")).toBeNull();
    expect(parseAmount("", "signed")).toBeNull();
  });
});

describe("parseDateWith — declared format, no inference", () => {
  it("the same string parses to different months under different formats", () => {
    // 03/04/2026 — the ONLY thing that disambiguates is the profile
    expect(parseDateWith("03/04/2026", "MDY").getMonth()).toBe(2);  // March
    expect(parseDateWith("03/04/2026", "DMY").getMonth()).toBe(3);  // April
  });
  it("YMD / MDY / DMY", () => {
    expect(parseDateWith("2026-08-15", "YMD").getMonth()).toBe(7);
    expect(parseDateWith("8/15/2026", "MDY").getDate()).toBe(15);
    expect(parseDateWith("15/8/2026", "DMY").getDate()).toBe(15);
  });
  it("expands two-digit years", () => {
    expect(parseDateWith("8/1/26", "MDY").getFullYear()).toBe(2026);
  });
  it("parses at noon local so it can't shift a day under DST/timezone", () => {
    const d = parseDateWith("2026-08-01", "YMD");
    expect(d.getMonth()).toBe(7);   // August, not July — the UTC-midnight bug can't happen here
    expect(d.getDate()).toBe(1);
  });
  it("rejects garbage", () => {
    expect(parseDateWith("not a date", "YMD")).toBeNull();
  });
});

describe("applyProfile — grid to ImportRows", () => {
  const grid = {
    headers: ["Txn Date", "Customer", "Class", "Amount", "Memo"],
    rows: [
      ["08/01/2026", "Acme Corp", "5000", "1,200.00", "materials"],
      ["08/15/2026", "Beta LLC", "", "(3,000.00)", "grant payment"],   // negative -> revenue
      ["Total", "", "", "", ""],                                        // subtotal junk
    ],
  };
  const profile = {
    columns: { date: "Txn Date", customer: "Customer", code: "Class", amount: "Amount", note: "Memo" },
    dateFormat: "MDY", amountMode: "signed",
  };

  it("maps columns to the right fields", () => {
    const rows = applyProfile(grid, profile);
    expect(rows[0]).toMatchObject({ customer: "Acme Corp", code: "5000", amount: 1200, kind: "cost", note: "materials" });
    expect(rows[0].date.getMonth()).toBe(7);  // August
  });
  it("classifies a negative as revenue", () => {
    const rows = applyProfile(grid, profile);
    expect(rows[1]).toMatchObject({ customer: "Beta LLC", amount: 3000, kind: "revenue" });
  });
  it("passes subtotal junk through as an unparseable row (mergeImport counts it)", () => {
    const rows = applyProfile(grid, profile);
    expect(rows[2].date).toBeNull();
    expect(Number.isNaN(rows[2].amount)).toBe(true);
  });
  it("ignores columns the profile doesn't map", () => {
    const rows = applyProfile(grid, { columns: { date: "Txn Date", amount: "Amount" }, dateFormat: "MDY", amountMode: "expensesPositive" });
    expect(rows[0].customer).toBeUndefined();
    expect(rows[0].amount).toBe(1200);
  });
});

describe("applyProfile -> mergeImport, the full paper trail", () => {
  it("a mapped grid ends up as ledger months", async () => {
    const { mergeImport } = await import("../../src/engine");
    const grid = { headers: ["Date", "Cust", "Amt"], rows: [["7/5/2026", "Acme", "500"], ["8/5/2026", "Acme", "600"]] };
    const rows = applyProfile(grid, { columns: { date: "Date", customer: "Cust", amount: "Amt" }, dateFormat: "MDY", amountMode: "expensesPositive" });
    const { history, report } = mergeImport([], rows, 2026, 6);
    expect(report.imported).toBe(2);
    expect(history[0].lines[0].customer).toBe("Acme");
  });
});
