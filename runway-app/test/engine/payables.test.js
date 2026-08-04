import { describe, it, expect } from "vitest";
import { payablesToCommitments } from "../../src/engine/payables.js";

const grid = (rows) => ({
  headers: ["Tx Date", "Txn Type", "Doc Num", "Vendor", "Due Date", "Memo", "Open Balance"],
  rows,
});
const opts = { startY: 2026, startM: 6 };   // July 2026 is month 0

describe("unpaid bills into commitments", () => {
  it("maps a bill to an obligation with both dates", () => {
    const r = payablesToCommitments(grid([
      ["2026-07-12", "Bill", "B-1001", "Bruker", "2026-09-30", "Service", "42,000.00"],
    ]), opts);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].amount).toBe(42000);
    expect(r.drafts[0].signedMonth).toBe(0);      // July 2026
    expect(r.drafts[0].payMonth).toBe(2);         // September 2026
    expect(r.drafts[0].label).toMatch(/Bruker/);
  });

  it("COUNTS A BILL WITH NO DUE DATE rather than guessing one", () => {
    // Money owed with no month to sit in. Guessing would put a real obligation against the runway at an
    // invented moment; dropping it silently would make it vanish.
    const r = payablesToCommitments(grid([
      ["2026-07-12", "Bill", "B-1", "Acme", "", "x", "1,000"],
    ]), opts);
    expect(r.drafts).toHaveLength(0);
    expect(r.noDate).toBe(1);
  });

  it("IGNORES CREDIT NOTES, which reduce what you owe", () => {
    // A negative open balance imported as an obligation would overstate the total by twice its value.
    const r = payablesToCommitments(grid([
      ["2026-07-01", "Credit", "C-1", "Acme", "2026-08-01", "refund", "(500.00)"],
      ["2026-07-01", "Bill", "B-2", "Acme", "2026-08-01", "", "500.00"],
    ]), opts);
    expect(r.drafts).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it("does not re-import a bill already recorded", () => {
    const r = payablesToCommitments(grid([
      ["2026-07-01", "Bill", "B-9", "Acme", "2026-08-01", "", "100"],
    ]), { ...opts, existing: [{ extRef: "B-9" }] });
    expect(r.drafts).toHaveLength(0);
    expect(r.duplicates).toBe(1);
  });

  it("SAYS SO when the columns do not match, rather than importing nothing", () => {
    // A mapping problem and an empty payables list must not look alike.
    const r = payablesToCommitments({ headers: ["A", "B"], rows: [["x", "y"]] }, opts);
    expect(r.drafts).toHaveLength(0);
    expect(r.reason).toMatch(/no amount column/i);
  });

  it("matches columns by NAME, not position", () => {
    // Position is what breaks when somebody adds a column.
    const r = payablesToCommitments({
      headers: ["Open Balance", "Due Date", "Vendor Name"],
      rows: [["2,500", "2026-10-15", "Meridian"]],
    }, opts);
    expect(r.drafts[0].amount).toBe(2500);
    expect(r.drafts[0].payMonth).toBe(3);
  });

  it("ALWAYS STATES THAT IT IS INVOICED OBLIGATIONS ONLY", () => {
    // A bill is raised when an invoice arrives; a commitment begins when you sign. This misses
    // everything signed and not yet billed — precisely the long-dated PO the feature exists for — and
    // an empty list read as "nothing outstanding" would be worse than not importing at all.
    const r = payablesToCommitments(grid([]), opts);
    expect(r.note).toMatch(/not yet invoiced/i);
  });

  it("sorts by when the money is due", () => {
    const r = payablesToCommitments(grid([
      ["2026-07-01", "Bill", "B-2", "B", "2026-12-01", "", "100"],
      ["2026-07-01", "Bill", "B-1", "A", "2026-08-01", "", "100"],
    ]), opts);
    expect(r.drafts.map(d => d.payMonth)).toEqual([1, 5]);
  });

  it("survives an empty or malformed grid", () => {
    expect(() => payablesToCommitments(null, opts)).not.toThrow();
    expect(payablesToCommitments(null, opts).drafts).toEqual([]);
    expect(() => payablesToCommitments(grid([[], [null]]), opts)).not.toThrow();
  });
});

describe("dates near a month boundary", () => {
  // THE BUG THIS CAUGHT, and the reason the suite runs under TZ=America/Denver. `new Date("2026-08-01")`
  // is UTC midnight by spec; read back with `getMonth()` in any negative offset it is 31 July, so a
  // bill due on the FIRST of a month landed in the month before it — every time, everywhere west of
  // Greenwich. The tests that passed were the ones whose dates were mid-month.
  const grid = (due) => ({
    headers: ["Due Date", "Open Balance"],
    rows: [[due, "1000"]],
  });
  const at = (due) => payablesToCommitments(grid(due), { startY: 2026, startM: 6 }).drafts[0]?.payMonth;

  it("puts the FIRST of a month in that month", () => {
    expect(at("2026-08-01")).toBe(1);
    expect(at("2026-09-01")).toBe(2);
    expect(at("2027-01-01")).toBe(6);
  });

  it("puts the LAST of a month in that month", () => {
    expect(at("2026-07-31")).toBe(0);
    expect(at("2026-12-31")).toBe(5);
  });

  it("handles a date with a time attached", () => {
    expect(at("2026-08-01T00:00:00")).toBe(1);
  });
});
