// The commercial model as the UI sees it. The database is authoritative for who may write; this is
// about saying the right thing to the right person.
import { describe, it, expect } from "vitest";
import { PLANS, planById, planSummary, unpaidMessage, TRIAL_DAYS } from "../../src/state/plans";

const NOW = new Date("2026-07-27T12:00:00Z");
const days = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

describe("the ladder", () => {
  it("prices the three tiers as agreed", () => {
    expect(PLANS.map(p => [p.id, p.price])).toEqual([["solo", 40], ["advisor", 99], ["connected", 149]]);
  });

  it("gates on companies, never on features", () => {
    // The engine ships to the browser: scenarios and SF-424A cannot be withheld from anyone who opens
    // devtools. A tier list promising to withhold them would be a lie with a price on it.
    expect(PLANS[0].companies).toBe(1);
    expect(PLANS[1].companies).toBe(Infinity);
    for (const p of PLANS) {
      expect(p.features.join(" ")).not.toMatch(/only|not included|upgrade to unlock/i);
    }
  });

  it("marks Connected as not built, so nobody sells it by accident", () => {
    expect(planById("connected").comingSoon).toBe(true);
    expect(planById("solo").comingSoon).toBeUndefined();
  });
});

describe("where somebody stands", () => {
  it("a fresh account is trialing, with days remaining", () => {
    const s = planSummary({ status: "none", plan: "none", trial_ends_at: days(9) }, NOW);
    expect(s.state).toBe("trialing");
    expect(s.daysLeft).toBe(9);
  });

  it("an expired trial is LAPSED, not 'none'", () => {
    // Materially different: one tried the product, the other never got in. They need different words.
    expect(planSummary({ status: "none", trial_ends_at: days(-1) }, NOW).state).toBe("lapsed");
    expect(planSummary({ status: "none" }, NOW).state).toBe("none");
  });

  it("a paying account reports its plan", () => {
    const s = planSummary({ status: "active", plan: "advisor", period_end: days(20) }, NOW);
    expect(s.state).toBe("active");
    expect(s.plan.name).toBe("Advisor");
  });

  it("past_due is still active, because a failing card is dunning not lockout", () => {
    expect(planSummary({ status: "past_due", plan: "solo", period_end: days(3) }, NOW).state).toBe("past_due");
  });

  it("a cancelled subscription keeps access to the end of the paid period", () => {
    // Cancel on the 2nd, you paid for the month.
    const s = planSummary({ status: "canceled", plan: "solo", period_end: days(12) }, NOW);
    expect(s.state).toBe("active");
    expect(s.lapsing).toBe(true);
  });

  it("and stops once that period is over", () => {
    expect(planSummary({ status: "canceled", plan: "solo", period_end: days(-1) }, NOW).state).toBe("none");
  });
});

describe("what a blocked save says", () => {
  it("never implies the data is gone", () => {
    // It isn't: the edit is held in memory by storage's halt, and export is never gated.
    for (const st of ["lapsed", "past_due", "none"]) {
      const m = unpaidMessage({ state: st });
      expect(m).not.toMatch(/lost|deleted|gone/i);
    }
    expect(unpaidMessage({ state: "lapsed" })).toMatch(/still export/i);
  });

  it("tells a lapsed trial apart from an uncovered company", () => {
    expect(unpaidMessage({ state: "lapsed" })).toMatch(/trial has ended/i);
    expect(unpaidMessage({ state: "none" })).toMatch(/isn't covered by your plan/i);
  });

  it("reassures rather than alarms when a card merely failed", () => {
    expect(unpaidMessage({ state: "past_due" })).toMatch(/still saving/i);
  });
});

describe("the trial", () => {
  it("is 14 days, and the client agrees with the database", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});
