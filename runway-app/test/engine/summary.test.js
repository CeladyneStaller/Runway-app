import { describe, it, expect } from "vitest";
import { projectSummary, budgetTag, spentToDate } from "../../src/engine";
import { resolveProjectRates, syncFulfilStage } from "../../src/engine";
import { SEED_PROJECTS, SEED_FULFIL, SEED_EMPLOYEES, SEED_POS_LINKED } from "../../src/seed";

const resolved = syncFulfilStage(resolveProjectRates([...SEED_PROJECTS, ...SEED_FULFIL], SEED_EMPLOYEES, 0.30), SEED_POS_LINKED);
const byType = (t) => resolved.filter(p => (p.type === t) || (t === "proposal" && p.stage === "prospective"));

describe("the budget tag has three states", () => {
  const planned = (m) => (m + 1) * 1000;   // $1k/month of planned cost
  it("no actuals -> no judgement", () => {
    expect(budgetTag(10000, {}, planned).tag).toBe("none");
  });
  it("spent over the whole budget -> over", () => {
    expect(budgetTag(10000, { 0: 6000, 1: 6000 }, planned).tag).toBe("over");
  });
  it("under budget but ahead of the plan -> at-risk", () => {
    // through month 2 the plan says $3k; we've spent $5k. On budget ($5k < $10k), tracking over.
    const t = budgetTag(10000, { 0: 2000, 1: 2000, 2: 1000 }, planned);
    expect(t.tag).toBe("at-risk");
    expect(t.ahead).toBeCloseTo(2000, 0);
  });
  it("under budget and on the plan -> on-budget", () => {
    expect(budgetTag(10000, { 0: 800, 1: 800 }, planned).tag).toBe("on-budget");
  });
  it("spentToDate sums recorded months", () => {
    expect(spentToDate({ 0: 100, 2: 250 })).toBe(350);
  });
});

describe("internal project summary", () => {
  const p = { ...byType("internal")[0], actuals: { 0: 12000, 1: 14000 } };
  const s = projectSummary(p, SEED_POS_LINKED);
  it("carries budget, spend, timeline and a tag", () => {
    expect(s.type).toBe("internal");
    expect(s.budget).toBeGreaterThan(0);
    expect(s.spent).toBe(26000);
    expect(typeof s.start).toBe("number");
    expect(["over", "at-risk", "on-budget", "none"]).toContain(s.tag);
  });
});

describe("grant summary", () => {
  const g = projectSummary(byType("grant")[0], SEED_POS_LINKED);
  it("splits federal and cost-share out of the total", () => {
    expect(g.total).toBeGreaterThan(0);
    expect(g.federal + g.costShare).toBeCloseTo(g.total, 2);
    expect(g.who).toBeTruthy();   // funder
  });
  it("reports milestone progress and the next due for milestone grants", () => {
    const m = resolved.find(p => p.type === "grant" && (p.grant.reimburseTiming === "milestone"));
    const s = projectSummary(m, SEED_POS_LINKED);
    expect(s.isMilestone).toBe(true);
    expect(s.milestonesTotal).toBeGreaterThan(0);
    expect(s.milestonesDone).toBeLessThanOrEqual(s.milestonesTotal);
  });
});

describe("fulfillment summary", () => {
  const f = projectSummary(byType("fulfillment")[0], SEED_POS_LINKED);
  it("is order value, cost, margin — with the customer as who", () => {
    expect(f.type).toBe("fulfillment");
    expect(f.orderValue).toBeGreaterThan(0);
    expect(f.margin).toBeCloseTo(f.orderValue - f.costToFulfil, 2);
    expect(f.who).toBeTruthy();   // customer
  });
});

describe("proposal summary", () => {
  it("is a grant-shaped summary carrying a decision month", () => {
    const p = byType("proposal")[0];
    if (!p) return;
    const s = projectSummary(p, SEED_POS_LINKED);
    expect(s.type).toBe("proposal");
    expect(s.total).toBeGreaterThan(0);
    expect(s.decisionMonth).not.toBeNull();
  });
});
