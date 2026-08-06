import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("the app header", () => {
  const src = readFileSync("src/App.jsx", "utf8");

  it("THE EYEBROW NAMES THE COMPANY, not the product", () => {
    // Somebody with three companies open in three tabs needs the tab to say which one they are in.
    // "Startup runway" is the same on all of them.
    expect(src).not.toMatch(/className="eyebrow">Startup runway</);
    expect(src).toMatch(/className="eyebrow">\{companyName/);
  });

  it("the sub line carries plan, cash-on-hand date and cash now", () => {
    expect(src).toMatch(/Cash on hand updated: /);
    expect(src).toMatch(/planName \|\|/);
    expect(src).toMatch(/money\(cashNow\)/);
  });

  it("IT IS THE LATEST RECORDED CASH MONTH, and the label now says so", () => {
    // It was "Last updated", which implied the whole model — so somebody who had just edited a payroll
    // line would read a months-old date and think the app had lost their work. Naming the FIGURE it
    // tracks removes the ambiguity: it moves when you close a month, not when you touch anything.
    //
    // The underlying reading was always right and worth keeping: a document saved this morning
    // with actuals ending in March is three months stale, and a modified date would hide exactly that.
    expect(src).toMatch(/lastActualMonth\(doc\?\.cashActuals/);
  });

  it("CASH NOW IS NOT CASH AT THE MODEL'S START", () => {
    // The start figure is a setting. This is the answer to "what is in the bank", which is what
    // somebody glancing at a header is asking.
    expect(src).toMatch(/const cashNow = useMemo/);
    expect(src).toMatch(/rows\[w\]\?\.start/);
  });

  it("the plan is shown by NAME, not by id", () => {
    expect(src).toMatch(/PLAN_LABEL\[row\?\.plan\]/);
  });

  it("says something sensible when there is nothing to say", () => {
    // A model with no actuals and no plan must not render "undefined · Last updated: undefined".
    expect(src).toMatch(/no entries yet/);
  });
});
