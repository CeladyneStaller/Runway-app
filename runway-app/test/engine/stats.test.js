// Aggregate statistics. The privacy policy makes promises about this feature, so these tests are
// mostly about what the output must NOT contain and when it must refuse to produce anything.
import { describe, it, expect } from "vitest";
import { companyStats, computeStats, contributes, MIN_COHORT } from "../../src/engine/stats";
import { emptyDoc, canaryDoc as demoDoc } from "../../src/state/document";

const emp = (name, amount) => ({
  id: "e" + name, name, title: "Engineer", basis: "annual", amount,
  start: 0, end: null, raises: [], promotions: [],
});
const co = (over = {}) => ({ ...emptyDoc(), cash: 600000, employees: [emp("Alex Rivera", 480000)], ...over });
const many = (n, over = {}) => Array.from({ length: n }, () => co(over));

describe("what may leave this module", () => {
  it("emits NUMBERS ONLY — the structural guard the policy rests on", () => {
    // Adding `topEarner: "Alex Rivera"` to companyStats must fail the build, not ship.
    const s = companyStats(demoDoc());
    expect(s).toBeTruthy();
    for (const [k, v] of Object.entries(s)) {
      expect(typeof v === "number" || v === null, `${k} is ${typeof v}, expected number|null`).toBe(true);
    }
  });

  it("carries no employee name, title, or salary out of a document that has them", () => {
    const doc = co({ employees: [emp("Alex Rivera", 480000), emp("Jordan Chen", 312000)] });
    const blob = JSON.stringify(companyStats(doc));
    expect(blob).not.toMatch(/Alex Rivera|Jordan Chen|Engineer/);
    expect(blob).not.toMatch(/480000|312000/);
  });

  it("carries no customer or company name either", () => {
    const doc = co({ name: "Harbor Point Labs", pos: [{ id: "p1", customer: "Northwind", amount: 145000 }] });
    const blob = JSON.stringify(computeStats(many(MIN_COHORT).concat(doc)));
    expect(blob).not.toMatch(/Harbor Point|Northwind/);
  });

  it("reports a headcount but never a person", () => {
    // A count is a company attribute, the same kind of fact as how much cash it has.
    expect(companyStats(co({ employees: [emp("A", 1), emp("B", 2)] })).headcount).toBe(2);
  });
});

describe("the minimum cohort", () => {
  it("suppresses every financial figure below the floor", () => {
    const r = computeStats(many(MIN_COHORT - 1));
    expect(r.suppressed).toBe(true);
    expect(r.totalCash).toBeNull();
    expect(r.medianRunwayMonths).toBeNull();
    expect(r.totalFundingRaised).toBeNull();
    expect(r.totalAnnualRevenue).toBeNull();
  });

  it("suppresses by ABSENCE, not by rounding or fuzzing", () => {
    // A blurred figure still carries information; a missing one does not.
    const r = computeStats(many(2));
    expect(Object.entries(r).filter(([, v]) => typeof v === "number" && v > 100)).toEqual([]);
  });

  it("still reports the COUNT, which says nothing about anybody", () => {
    const r = computeStats(many(3));
    expect(r.companies).toBe(3);
    expect(r.suppressed).toBe(true);
  });

  it("publishes once the floor is reached", () => {
    const r = computeStats(many(MIN_COHORT));
    expect(r.suppressed).toBe(false);
    expect(r.totalCash).toBe(600000 * MIN_COHORT);
  });

  it("takes a stricter floor when asked, never a looser one by accident", () => {
    expect(computeStats(many(12), { minCohort: 25 }).suppressed).toBe(true);
  });
});

describe("the figures themselves", () => {
  it("sums cash across the cohort", () => {
    expect(computeStats(many(MIN_COHORT, { cash: 250000 })).totalCash).toBe(250000 * MIN_COHORT);
  });

  it("counts only closed and committed money as raised", () => {
    // Money somebody hopes to raise is not money raised.
    const doc = co({ rounds: [
      { id: "r1", kind: "safe", status: "closed", amount: 1000000, closeMonth: 0 },
      { id: "r2", kind: "safe", status: "committed", amount: 500000, closeMonth: 2 },
      { id: "r3", kind: "safe", status: "planning", amount: 9000000, closeMonth: 6 },
    ] });
    expect(companyStats(doc).fundingRaised).toBe(1500000);
  });

  it("does NOT average 'no zero date' in as the horizon", () => {
    // Capping the healthiest customers at HORIZON would understate exactly the companies doing best.
    const dying = co({ cash: 100000, employees: [emp("A", 1200000)] });
    const thriving = co({ cash: 900000000, employees: [emp("B", 120000)] });
    expect(companyStats(thriving).runwayMonths).toBeNull();
    expect(companyStats(thriving).beyondHorizon).toBe(1);

    const r = computeStats([...many(MIN_COHORT - 1, { cash: 100000, employees: [emp("A", 1200000)] }), dying, thriving]);
    expect(r.companiesBeyondHorizon).toBe(1);
    expect(r.runwaySampleSize).toBe(MIN_COHORT);         // the thriving one is excluded from the mean
    expect(r.meanRunwayMonths).toBeLessThan(12);
  });

  it("reports a median as well as a mean, because one outlier moves a mean", () => {
    const r = computeStats(many(MIN_COHORT));
    expect(r.medianRunwayMonths).toBeGreaterThan(0);
    expect(r.meanRunwayMonths).toBeGreaterThan(0);
  });

  it("records the sample size and floor alongside the figures", () => {
    // A published number without its cohort is unfalsifiable.
    const r = computeStats(many(MIN_COHORT));
    expect(r.sampleSize).toBe(MIN_COHORT);
    expect(r.minCohort).toBe(MIN_COHORT);
    expect(r.computedAt).toMatch(/^\d{4}-/);
  });
});

describe("surviving bad input", () => {
  it("skips a document that cannot be projected rather than counting it as zeros", () => {
    // A broken company contributing zeros would drag every average down invisibly.
    expect(companyStats(null)).toBeNull();
    expect(companyStats("nonsense")).toBeNull();
    expect(companyStats({})).toBeNull();
  });

  it("EXCLUDES a company that signed up and never typed anything", () => {
    // The setup wizard creates an empty document by design, and empty documents project happily —
    // straight to zero. Counting them inflates "N companies use Waterline" with people who never
    // used it, and drags every average down. Wrong in the flattering direction.
    expect(contributes(emptyDoc())).toBe(false);
    expect(companyStats(emptyDoc())).toBeNull();
    expect(contributes({ ...emptyDoc(), cash: 1 })).toBe(true);
    expect(contributes({ ...emptyDoc(), employees: [emp("A", 1)] })).toBe(true);
  });

  it("excludes skipped documents from the cohort count, so the floor stays honest", () => {
    const r = computeStats([...many(MIN_COHORT - 1), null, undefined, {}, emptyDoc()]);
    expect(r.companies).toBe(MIN_COHORT - 1);
    expect(r.suppressed).toBe(true);
  });

  it("returns a coherent empty result for no input at all", () => {
    const r = computeStats([]);
    expect(r.companies).toBe(0);
    expect(r.suppressed).toBe(true);
    expect(r.totalCash).toBeNull();
  });
});
