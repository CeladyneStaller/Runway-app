// Fringe rate resolution: itemized parts -> % OR manual override, with the specified precedence.
import { describe, it, expect } from "vitest";
import { resolveFringeRate, itemizedFringeRate, itemizedIsEmpty, blankFringe } from "../../src/engine";

describe("itemizedIsEmpty", () => {
  it("a blank config is empty", () => {
    expect(itemizedIsEmpty(blankFringe())).toBe(true);
    expect(itemizedIsEmpty({})).toBe(true);
  });
  it("any set field makes it non-empty", () => {
    expect(itemizedIsEmpty({ ...blankFringe(), vacationDays: 10 })).toBe(false);
  });
  it("all-zero counts as empty (nothing to add)", () => {
    expect(itemizedIsEmpty({ vacationDays: 0, payrollTaxPct: 0 })).toBe(true);
  });
});

describe("itemized rate math", () => {
  it("PTO is days-off over 260 working days", () => {
    // 10 vac + 10 hol + 5 sick = 25 days / 260 = ~9.6%
    const r = itemizedFringeRate({ vacationDays: 10, holidayDays: 10, sickDays: 5 }, 0);
    expect(r).toBeCloseTo(25 / 260, 5);
  });
  it("adds payroll taxes as a straight percent", () => {
    expect(itemizedFringeRate({ payrollTaxPct: 7.65 }, 0)).toBeCloseTo(0.0765, 5);
  });
  it("401k cost is the employer match capped by employee deferral", () => {
    // defer 6%, match 4% -> employer pays 4%
    expect(itemizedFringeRate({ k401Pct: 6, k401MatchPct: 4 }, 0)).toBeCloseTo(0.04, 5);
    // defer 2%, match 4% -> employer only matches the 2% deferred
    expect(itemizedFringeRate({ k401Pct: 2, k401MatchPct: 4 }, 0)).toBeCloseTo(0.02, 5);
  });
  it("insurance $/person becomes a % of average salary", () => {
    // $6000/person on $100k average = 6%
    expect(itemizedFringeRate({ insurancePerPerson: 6000 }, 100000)).toBeCloseTo(0.06, 5);
  });
  it("insurance contributes nothing if no salary base", () => {
    expect(itemizedFringeRate({ insurancePerPerson: 6000 }, 0)).toBe(0);
  });
  it("combines all parts", () => {
    const r = itemizedFringeRate(
      { vacationDays: 10, holidayDays: 10, sickDays: 5, payrollTaxPct: 7.65, k401Pct: 6, k401MatchPct: 4, insurancePerPerson: 6000 },
      100000);
    // 25/260 + .0765 + .04 + .06
    expect(r).toBeCloseTo(25 / 260 + 0.0765 + 0.04 + 0.06, 5);
  });
});

describe("resolveFringeRate precedence", () => {
  it("manual override wins when mode is manual and a value is set", () => {
    expect(resolveFringeRate({ mode: "manual", manualPct: 35, vacationDays: 10 }, 100000)).toBeCloseTo(0.35, 5);
  });
  it("uses itemized when inputs are set and not in manual mode", () => {
    expect(resolveFringeRate({ mode: "itemized", payrollTaxPct: 10 }, 0)).toBeCloseTo(0.10, 5);
  });
  it("blank itemized falls back to the legacy default", () => {
    expect(resolveFringeRate(blankFringe(), 100000, 0.30)).toBeCloseTo(0.30, 5);
    expect(resolveFringeRate({}, 100000, 0.42)).toBeCloseTo(0.42, 5);
  });
  it("manual mode but blank value -> falls through to itemized/legacy", () => {
    // the spec: if the manual override is deleted/blank, use the automatic calc
    expect(resolveFringeRate({ mode: "manual", manualPct: "", payrollTaxPct: 15 }, 0)).toBeCloseTo(0.15, 5);
    expect(resolveFringeRate({ mode: "manual", manualPct: "" }, 0, 0.30)).toBeCloseTo(0.30, 5);
  });
  it("never negative", () => {
    expect(resolveFringeRate({ mode: "manual", manualPct: -5 }, 0)).toBe(0);
  });
});
