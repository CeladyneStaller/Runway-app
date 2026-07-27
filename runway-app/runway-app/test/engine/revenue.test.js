// Piece 3: recorded revenue replaces projected revenue. Past-only, per project-month, total
// suppression, always on, differences flagged. These pin every one of those four decisions plus the
// runway-critical edge cases (the whole reason this got its own turn).
import { describe, it, expect } from "vitest";
import { applyRevenueActuals, recordedThrough, lineProject, buildProjection, tagRevenue } from "../../src/engine";

const ON = { committed: true, expected: true, speculative: true, financing: true };

// a project "g1" with a recurring $50k/mo projected grant reimbursement, months 0-5
const projectedGrant = [
  { kind: "revenue", cadence: "recurring", amount: 50000, start: 0, end: 5, confidence: "committed", projectId: "g1" },
];

describe("recordedThrough — the per-project bound", () => {
  it("is the last recorded month per project", () => {
    expect(recordedThrough({ g1: { 0: 1, 1: 2, 3: 3 }, p2: { 2: 9 } })).toEqual({ g1: 3, p2: 2 });
  });
  it("ignores projects with no actuals", () => {
    expect(recordedThrough({ g1: {} })).toEqual({});
  });
});

describe("lineProject — resolving a revenue line to a project", () => {
  it("uses projectId directly", () => {
    expect(lineProject({ projectId: "g1" }, {})).toBe("g1");
  });
  it("resolves a PO line through poProject", () => {
    expect(lineProject({ poId: "po7" }, { po7: "proj-x" })).toBe("proj-x");
  });
});

describe("past-only replacement", () => {
  it("replaces projected revenue up to the last recorded month, leaves the future alone", () => {
    // actuals for g1 in months 0-2; projection continues 3-5 untouched
    const revActuals = { g1: { 0: 45000, 1: 48000, 2: 52000 } };
    const { lineItems } = applyRevenueActuals(projectedGrant, revActuals, ON);
    // the recurring line should now start at month 3 (0-2 removed), plus 3 actual lines
    const recurring = lineItems.find(l => l.cadence === "recurring");
    expect(recurring.start).toBe(3);
    expect(recurring.end).toBe(5);
    const actuals = lineItems.filter(l => l.isActual);
    expect(actuals.map(a => a.amount).sort((x, y) => x - y)).toEqual([45000, 48000, 52000]);
    expect(actuals.every(a => a.confidence === "committed")).toBe(true);
  });

  it("the projection uses actuals for the past and projection for the future", () => {
    const revActuals = { g1: { 0: 45000, 1: 45000, 2: 45000 } };
    const { lineItems } = applyRevenueActuals(projectedGrant, revActuals, ON);
    const rows = buildProjection({ cashOnHand: 0, horizon: 5, lineItems: tagRevenue(lineItems) }, ON);
    expect(rows[0].rev).toBe(45000);   // actual
    expect(rows[2].rev).toBe(45000);   // actual
    expect(rows[3].rev).toBe(50000);   // projection resumes
    expect(rows[5].rev).toBe(50000);
  });
});

describe("total suppression within a recorded month", () => {
  it("removes ALL of a project's projected revenue in a recorded month, even multiple lines", () => {
    const twoLines = [
      { kind: "revenue", cadence: "recurring", amount: 30000, start: 0, end: 5, confidence: "committed", projectId: "g1" },
      { kind: "revenue", cadence: "onetime", amount: 20000, start: 1, confidence: "expected", projectId: "g1" },
    ];
    const { lineItems } = applyRevenueActuals(twoLines, { g1: { 1: 55000 } }, ON);
    const rows = buildProjection({ cashOnHand: 0, horizon: 5, lineItems: tagRevenue(lineItems) }, ON);
    expect(rows[1].rev).toBe(55000);   // the actual, NOT 55k + the projected 30k+20k
  });

  it("a recorded $0 month suppresses projection to zero (actual is the whole truth)", () => {
    // g1 recorded through month 2, but month 1 has an explicit 0 — projection must not leak in
    const { lineItems } = applyRevenueActuals(projectedGrant, { g1: { 0: 45000, 1: 0, 2: 45000 } }, ON);
    const rows = buildProjection({ cashOnHand: 0, horizon: 5, lineItems: tagRevenue(lineItems) }, ON);
    expect(rows[1].rev).toBe(0);
  });
});

describe("variance flagging", () => {
  it("flags where actual and projected disagree, but still uses the actual", () => {
    const { lineItems, variances } = applyRevenueActuals(projectedGrant, { g1: { 0: 40000 } }, ON);
    expect(variances).toHaveLength(1);
    expect(variances[0]).toMatchObject({ projectId: "g1", month: 0, projected: 50000, actual: 40000, delta: -10000 });
    const rows = buildProjection({ cashOnHand: 0, horizon: 5, lineItems: tagRevenue(lineItems) }, ON);
    expect(rows[0].rev).toBe(40000);   // the actual wins despite the variance
  });
  it("does not flag when they agree", () => {
    const { variances } = applyRevenueActuals(projectedGrant, { g1: { 0: 50000 } }, ON);
    expect(variances).toHaveLength(0);
  });
});

describe("no actuals = no change", () => {
  it("returns the line items untouched when there are no revenue actuals", () => {
    const { lineItems, variances } = applyRevenueActuals(projectedGrant, {}, ON);
    expect(lineItems).toBe(projectedGrant);   // same reference — provably a no-op
    expect(variances).toEqual([]);
  });
});
