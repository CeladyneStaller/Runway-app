import { describe, it, expect } from "vitest";
import { bankAccountsSource } from "../../supabase/functions/_shared/qbo-report.js";

// A BalanceSheet in QuickBooks' own shape: sections nested by Header, accounts as ColData rows.
const report = () => ({
  Header: { EndPeriod: "2026-07-31" },
  Rows: { Row: [{
    Header: { ColData: [{ value: "ASSETS" }] },
    Rows: { Row: [{
      Header: { ColData: [{ value: "Current Assets" }] },
      Rows: { Row: [{
        Header: { ColData: [{ value: "Bank Accounts" }] },
        Rows: { Row: [
          { ColData: [{ value: "Operating checking", id: "35" }, { value: "412,806.19" }] },
          { ColData: [{ value: "Payroll reserve", id: "36" }, { value: "88,000.00" }] },
          { ColData: [{ value: "Stripe holding", id: "37" }, { value: "6,204.55" }] },
          { ColData: [{ value: "Total Bank Accounts" }, { value: "507,010.74" }] },
        ] },
      }, {
        Header: { ColData: [{ value: "Accounts Receivable" }] },
        Rows: { Row: [{ ColData: [{ value: "Accounts Receivable", id: "40" }, { value: "94,000.00" }] }] },
      }] },
    }] },
  }] },
});

describe("reading cash from a BalanceSheet", () => {
  const { accounts, asOf } = bankAccountsSource(report());

  it("RETURNS THE LIST, never a sum", () => {
    // QuickBooks' Bank type includes things a founder may not count as runway — a merchant holding
    // account, a foreign-currency account, an escrow. Summing them is the obvious rule and quietly
    // wrong for some companies.
    expect(accounts.map(a => a.name))
      .toEqual(["Operating checking", "Payroll reserve", "Stripe holding"]);
  });

  it("⚠️ EXCLUDES THE SECTION TOTAL", () => {
    // "Total Bank Accounts" would appear as a selectable row and, ticked alongside its members, would
    // double every balance.
    expect(accounts.some(a => /^total/i.test(a.name))).toBe(false);
  });

  it("does not reach into other sections", () => {
    // Accounts Receivable is a current asset and is not cash.
    expect(accounts.some(a => a.name === "Accounts Receivable")).toBe(false);
  });

  it("parses formatted balances", () => {
    expect(accounts[0].balance).toBe(412806.19);
    expect(accounts[2].balance).toBe(6204.55);
  });

  it("carries the account id, so a choice survives a rename", () => {
    expect(accounts[0].id).toBe("35");
  });

  it("reports the date it is a balance AT", () => {
    // A cash figure with no date is a number somebody has to trust.
    expect(asOf).toBe("2026-07-31");
  });

  it("survives a report with no bank section at all", () => {
    expect(bankAccountsSource({ Rows: { Row: [] } }).accounts).toEqual([]);
    expect(bankAccountsSource(null).accounts).toEqual([]);
  });

  it("accepts the other names QuickBooks uses for the section", () => {
    const alt = { Rows: { Row: [{
      Header: { ColData: [{ value: "Checking/Savings" }] },
      Rows: { Row: [{ ColData: [{ value: "Main", id: "1" }, { value: "100.00" }] }] },
    }] } };
    expect(bankAccountsSource(alt).accounts).toHaveLength(1);
  });
});
