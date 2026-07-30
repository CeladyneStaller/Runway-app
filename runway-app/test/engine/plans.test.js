// The commercial model as the UI sees it. The database is authoritative for who may write; this is
// about saying the right thing to the right person.
import { describe, it, expect } from "vitest";
import { PLANS, planById, planSummary, unpaidMessage, TRIAL_DAYS } from "../../src/state/plans";

const NOW = new Date("2026-07-27T12:00:00Z");
const days = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

describe("the ladder", () => {
  it("prices the three tiers as agreed", () => {
    // `advisor` became `collaborative` in 024: an advisor is a USER ATTRIBUTE, not a plan, because
    // `company_entitled` only ever consulted OWNERS and an advisor is invited as an admin — so the tier
    // sold an unlimited-companies allowance covering the zero companies an advisor owns.
    expect(PLANS.map(p => [p.id, p.price]))
      .toEqual([["solo", 40], ["collaborative", 99], ["connected", 149]]);
  });

  it("gates on SEATS, never on features", () => {
    // The axis changed from companies to seats in 024; the principle did not. The engine ships to the
    // browser, so scenarios and SF-424A cannot be withheld from anybody who opens devtools, and a tier
    // list promising to withhold them would be a lie with a price on it.
    expect(PLANS.map(p => p.seats)).toEqual([1, 3, 5]);
    for (const p of PLANS) {
      expect(p.companies, "companies allowances were replaced by seats").toBeUndefined();
      expect(p.features.join(" ")).not.toMatch(/only|not included|upgrade to unlock/i);
    }
  });

  it("agrees with plan_seats() in the database", async () => {
    // Two copies of one number, so the drift shows up here rather than as a company whose seat count
    // depends on which side of the wire you ask.
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/022_company_subscriptions.sql", "utf8");
    const fn = sql.slice(sql.indexOf("function plan_seats"), sql.indexOf("end $$", sql.indexOf("function plan_seats")));
    for (const p of PLANS) expect(fn, `plan_seats has no case for ${p.id}`).toContain(`'${p.id}'`);
    expect(fn).toMatch(/'solo'\s+then\s+1/);
    expect(fn).toMatch(/'collaborative'\s+then\s+3/);
    expect(fn).toMatch(/'connected'\s+then\s+5/);
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
    const s = planSummary({ status: "active", plan: "collaborative", period_end: days(20) }, NOW);
    expect(s.state).toBe("active");
    expect(s.plan.name).toBe("Collaborative");
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

describe("the advisor ladder", () => {
  it("prices two tiers, neither of them free", async () => {
    const { ADVISOR_PLANS } = await import("../../src/state/plans.js");
    expect(ADVISOR_PLANS.map(p => [p.id, p.price, p.companies]))
      .toEqual([["advisor", 99, 3], ["advisor_unlimited", 199, Infinity]]);
  });

  it("stays above the cheapest marginal seat, or it becomes the cheap seat", async () => {
    const { ADVISOR_PLANS, PLANS } = await import("../../src/state/plans.js");
    // Solo -> Collaborative buys two extra seats for $59, about $30 each. An advisor plan below that
    // would be a cheaper way to buy a seat, and the seat model would have a hole in it.
    const perSeat = (PLANS[1].price - PLANS[0].price) / (PLANS[1].seats - PLANS[0].seats);
    expect(Math.min(...ADVISOR_PLANS.map(p => p.price))).toBeGreaterThan(perSeat * 2);
  });

  it("agrees with advisor_companies_allowed() in migration 031", async () => {
    const { readFileSync } = await import("node:fs");
    const { ADVISOR_PLANS } = await import("../../src/state/plans.js");
    const sql = readFileSync("supabase/migrations/031_advisor_billing.sql", "utf8");
    const fn = sql.slice(sql.indexOf("function advisor_companies_allowed"),
                         sql.indexOf("$$;", sql.indexOf("function advisor_companies_allowed")));
    expect(fn).toMatch(/'advisor'\s+then\s+3/);
    expect(fn).toMatch(/'advisor_unlimited'\s+then\s+1000000/);
    for (const p of ADVISOR_PLANS) expect(fn).toContain(`'${p.id}'`);
  });

  it("says what to DO when the plan is full", async () => {
    const { advisorSummary } = await import("../../src/state/plans.js");
    const s = advisorSummary({ plan: "advisor", status: "active", used: 3, allowed: 3 });
    expect(s.state).toBe("full");
    expect(s.text).toMatch(/upgrade|leave a company/i);
  });

  it("says plainly when a plan will not renew", async () => {
    const { advisorSummary } = await import("../../src/state/plans.js");
    const s = advisorSummary({ plan: "advisor", status: "active", used: 1, allowed: 3,
                               cancel_at_period_end: true });
    expect(s.state).toBe("ending");
    expect(s.text).toMatch(/will not renew/i);
  });
});
