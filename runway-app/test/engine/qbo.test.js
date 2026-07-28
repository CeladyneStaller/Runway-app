// The QuickBooks report flattener. Fixtures here are cut down from real probe output against the
// Intuit sandbox (ProfitAndLossDetail and GeneralLedger, 28 Jul 2026), keeping the shapes that decide
// correctness: nested sections, a section Summary, a report that already has an "Account" column, and
// rows shorter than the declared column list.
import { describe, it, expect } from "vitest";
import { quickbooksSource, columnValues } from "../../src/engine/qbo.js";

const col = (title, type) => ({ ColTitle: title, ColType: type });
const leaf = (...values) => ({ ColData: values.map(v => ({ value: v })) });

/** ProfitAndLossDetail: two levels of section — Income / Design income — with a Summary on each. */
const pnl = {
  Columns: { Column: [col("Date", "tx_date"), col("Transaction Type", "txn_type"),
                      col("Num", "doc_num"), col("Name", "name"),
                      col("Memo/Description", "memo"), col("Amount", "subt_nat_amount")] },
  Rows: { Row: [
    { Header: { ColData: [{ value: "Income" }] },
      Rows: { Row: [
        { Header: { ColData: [{ value: "Design income" }] },
          Rows: { Row: [
            leaf("2026-05-04", "Invoice", "1037", "Kate Whelan", "Custom Design", "225.00"),
            leaf("2026-05-24", "Invoice", "1038", "Dylan Sollfrank", "Custom Design", "337.50"),
          ] },
          Summary: { ColData: [{ value: "Total for Design income" }, { value: "562.50" }] },
          type: "Section" },
      ] },
      Summary: { ColData: [{ value: "Total for Income" }, { value: "562.50" }] },
      type: "Section" },
    { Header: { ColData: [{ value: "Expenses" }] },
      Rows: { Row: [
        { Header: { ColData: [{ value: "Fuel" }] },
          Rows: { Row: [leaf("2026-06-02", "Expense", "", "Chin's Gas and Oil", "", "54.55")] },
          type: "Section" },
      ] },
      type: "Section" },
  ] },
};

describe("quickbooksSource", () => {
  it("keeps the report's own columns, in order, and appends the two synthesised ones", () => {
    const g = quickbooksSource(pnl);
    expect(g.headers).toEqual(["Date", "Transaction Type", "Num", "Name", "Memo/Description",
                               "Amount", "Account", "Section Path"]);
  });

  it("emits one row per transaction and NO section totals", () => {
    const g = quickbooksSource(pnl);
    // Three leaves. A Summary counted as data would double the report and then some.
    expect(g.rows.length).toBe(3);
    expect(g.rows.some(r => r.some(c => String(c).startsWith("Total")))).toBe(false);
  });

  it("carries the NEAREST section header down as Account", () => {
    const g = quickbooksSource(pnl);
    const account = g.headers.indexOf("Account");
    expect(g.rows.map(r => r[account])).toEqual(["Design income", "Design income", "Fuel"]);
  });

  it("carries the FULL ancestor chain as Section Path", () => {
    const g = quickbooksSource(pnl);
    const path = g.headers.indexOf("Section Path");
    expect(g.rows.map(r => r[path])).toEqual([
      "Income > Design income", "Income > Design income", "Expenses > Fuel",
    ]);
  });

  it("does not let an UNNAMED section reset the trail to the root", () => {
    // THE REGRESSION. A real report wraps everything in sections, some without a Header, and the first
    // implementation treated the level below an unnamed one as outermost — nineteen distinct values
    // where two were intended.
    const wrapped = {
      Columns: { Column: [col("Date", "tx_date"), col("Amount", "subt_nat_amount")] },
      Rows: { Row: [
        { Header: { ColData: [{ value: "Ordinary Income/Expenses" }] },
          Rows: { Row: [
            { Rows: { Row: [                                     // unnamed level
              { Header: { ColData: [{ value: "Job Expenses" }] },
                Rows: { Row: [
                  { Header: { ColData: [{ value: "Equipment Rental" }] },
                    Rows: { Row: [leaf("2026-06-02", "120.00")] },
                    type: "Section" },
                ] },
                type: "Section" },
            ] }, type: "Section" },
          ] },
          type: "Section" },
      ] },
    };
    const g = quickbooksSource(wrapped);
    expect(g.rows[0][g.headers.indexOf("Account")]).toBe("Equipment Rental");
    expect(g.rows[0][g.headers.indexOf("Section Path")])
      .toBe("Ordinary Income/Expenses > Job Expenses > Equipment Rental");
  });

  it("produces rows the existing profile machinery can map", async () => {
    const { applyProfile } = await import("../../src/engine/importer.js");
    const g = quickbooksSource(pnl);
    const rows = applyProfile(g, {
      columns: { date: "Date", amount: "Amount", code: "Account",
                 customer: "Name", note: "Memo/Description" },
      dateFormat: "YMD",
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].code).toBe("Design income");
    expect(rows[0].amount).toBe(225);
    // NOTE what is NOT asserted: `kind`. Revenue-vs-cost cannot be read off this grid — the report's
    // own wrapper is called "Ordinary Income/Expenses", so no name-matching rule survives contact
    // with it. That decision belongs to the mapping screen and a person looking at their accounts.
  });
});

describe("revenue-vs-cost, which this report cannot tell you", () => {
  // The finding that produced `profile.revenueCodes`. Against the Intuit sandbox, ProfitAndLossDetail
  // returned `Design income +7/-0` and `Fuel +6/-0` — income and expense BOTH POSITIVE. In signed mode
  // every revenue row books as spending, which for a runway model is not a cosmetic error: income
  // becomes burn and the runway goes to zero.
  const bothPositive = {
    Columns: { Column: [col("Date", "tx_date"), col("Amount", "subt_nat_amount")] },
    Rows: { Row: [
      { Header: { ColData: [{ value: "Ordinary Income/Expenses" }] },
        Rows: { Row: [
          { Header: { ColData: [{ value: "Income" }] },
            Rows: { Row: [
              { Header: { ColData: [{ value: "Design income" }] },
                Rows: { Row: [leaf("2026-05-04", "225.00")] }, type: "Section" },
            ] }, type: "Section" },
        ] }, type: "Section" },
      { Header: { ColData: [{ value: "Expenses" }] },
        Rows: { Row: [
          { Header: { ColData: [{ value: "Fuel" }] },
            Rows: { Row: [leaf("2026-06-02", "54.55")] }, type: "Section" },
        ] }, type: "Section" },
    ] },
  };

  const map = (extra) => import("../../src/engine/importer.js").then(({ applyProfile }) =>
    applyProfile(quickbooksSource(bothPositive),
      { columns: { date: "Date", amount: "Amount", code: "Account" }, dateFormat: "YMD", ...extra }));

  it("gets it WRONG without help, and that is the point", async () => {
    const rows = await map({});
    expect(rows.map(r => r.kind)).toEqual(["cost", "cost"]);   // the revenue row booked as spending
  });

  it("is fixed by naming the revenue accounts", async () => {
    const rows = await map({ revenueCodes: ["Design income"] });
    expect(rows.map(r => r.kind)).toEqual(["revenue", "cost"]);
  });

  it("matches an account name regardless of case, because a person typed it", async () => {
    const rows = await map({ revenueCodes: ["  DESIGN INCOME  "] });
    expect(rows[0].kind).toBe("revenue");
  });

  it("overrides a kindColumn, since a named account is more reliable than an inferred label", async () => {
    const rows = await map({ kindColumn: true, kindRevenueValue: "nothing-matches",
                             revenueCodes: ["Design income"] });
    expect(rows[0].kind).toBe("revenue");
  });

  it("changes nothing when absent or empty", async () => {
    for (const extra of [{}, { revenueCodes: [] }, { revenueCodes: null }]) {
      expect((await map(extra)).map(r => r.kind)).toEqual(["cost", "cost"]);
    }
  });
});

describe("the shapes that would corrupt a mapping silently", () => {
  it("disambiguates a duplicate header rather than shadowing it", () => {
    // GeneralLedger really does return a column called "Account", and we synthesise one too.
    // `applyProfile` resolves by indexOf, so a duplicate would be mapped and then never read.
    const gl = {
      Columns: { Column: [col("Date", "tx_date"), col("Account", "account_name"),
                          col("Amount", "subt_nat_amount")] },
      Rows: { Row: [
        { Header: { ColData: [{ value: "Checking" }] },
          Rows: { Row: [leaf("2026-02-03", "6000 Salaries", "-18400.00")] },
          type: "Section" },
      ] },
    };
    const g = quickbooksSource(gl);
    expect(g.headers).toEqual(["Date", "Account", "Amount", "Account (2)", "Section Path"]);
    expect(g.rows[0][g.headers.indexOf("Account")]).toBe("6000 Salaries");      // the report's
    expect(g.rows[0][g.headers.indexOf("Account (2)")]).toBe("Checking");       // the section's
  });

  it("pads a short row instead of letting the synthesised columns slide left", () => {
    const ragged = {
      Columns: { Column: [col("Date", "tx_date"), col("Num", "doc_num"), col("Amount", "subt_nat_amount")] },
      Rows: { Row: [
        { Header: { ColData: [{ value: "Fuel" }] },
          Rows: { Row: [{ ColData: [{ value: "2026-06-02" }] }] },   // one cell, three columns
          type: "Section" },
      ] },
    };
    const g = quickbooksSource(ragged);
    expect(g.rows[0]).toEqual(["2026-06-02", "", "", "Fuel", "Fuel"]);
  });

  it("survives an empty or malformed report without throwing", () => {
    for (const bad of [null, undefined, {}, { Rows: {} }, { Columns: {} }]) {
      const g = quickbooksSource(bad);
      expect(Array.isArray(g.rows)).toBe(true);
      expect(g.headers).toContain("Account");
    }
  });
});

describe("columnValues", () => {
  it("lists what a column actually contains, so somebody can choose their code source", () => {
    const g = quickbooksSource(pnl);
    expect(columnValues(g, "Account")).toEqual(["Design income", "Fuel"]);
    expect(columnValues(g, "Section Path")).toEqual(["Income > Design income", "Expenses > Fuel"]);
    expect(columnValues(g, "Class")).toEqual([]);   // absent, not an error
  });
});
