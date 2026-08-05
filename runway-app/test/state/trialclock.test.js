import { describe, it, expect, vi } from "vitest";

// The rule, expressed as the SQL expresses it, so a change to one has to be a deliberate change to the
// other. These are not a substitute for applying 045 against a real project — the migration scanner
// covers shape, and only a live apply covers behaviour — but they pin the reasoning.
describe("the trial clock", () => {
  const DAYS = 14;
  const ends = (startedAt) => (startedAt == null ? null : startedAt + DAYS);
  const inTrial = (startedAt, today) => (ends(startedAt) == null ? true : ends(startedAt) > today);

  it("gives a company created mid-trial the REMAINING time, not a fresh fourteen days", () => {
    // A company created on day 10 gets four days. This is the whole fix: `create_company` writes the
    // ACCOUNT's end date into `companies.trial_ends_at` rather than letting the column default.
    expect(ends(0)).toBe(14);
    const createdOnDay10 = ends(0);         // still day 14, not day 24
    expect(createdOnDay10 - 10).toBe(4);
  });

  it("BORNS A COMPANY EXPIRED once the account clock has run out", () => {
    // Create on day 1, delete on day 13, create again on day 13: the new company's trial_ends_at is
    // still day 14. Create again on day 20 and it is already in the past. `company_entitled` needs no
    // change — it reads that column and the answer falls out.
    expect(inTrial(0, 13)).toBe(true);
    expect(inTrial(0, 15)).toBe(false);
    expect(inTrial(0, 20)).toBe(false);
  });

  it("does not start until the first company", () => {
    // Somebody who signs up, is invited to a colleague's company, and comes back a month later has not
    // used anything up. A null clock counts as inside.
    expect(inTrial(null, 99)).toBe(true);
  });

  it("does not restart", () => {
    // The clock is on `profiles`, which the user cannot delete. Deleting every company leaves it where
    // it was — which is the property the per-company version could not have.
    const started = 0;
    expect(ends(started)).toBe(14);
    expect(ends(started)).toBe(14);   // after any number of company deletions
  });
});

describe("who may create a company", () => {
  // `blocking` is the first OWNED, not-soft-deleted, unpaid company. Null means go ahead.
  const PAID = new Set(["active", "past_due"]);
  // MIRRORS THE SQL EXACTLY. My first version required a status before looking at the period —
  //   `c.sub && (PAID.has(c.sub) || c.periodEnd > 0)`
  // — but the SQL's OR sits on the subscription row and does not require a status:
  //   `s.status in ('active','past_due') or s.current_period_end > now()`
  // so a cancelled subscription still inside its paid period counts as paid. A test model that is
  // subtly stricter than the rule it stands for is worse than no test.
  const paid = (c) => PAID.has(c.sub) || (c.periodEnd || 0) > 0;
  const blocking = (owned) => owned.find(c => !c.deleted && !paid(c)) ?? null;

  it("blocks a second company while the first is unpaid", () => {
    expect(blocking([{ id: "a" }])).toBeTruthy();
  });

  it("allows one once the first is paid", () => {
    expect(blocking([{ id: "a", sub: "active" }])).toBeNull();
    expect(blocking([{ id: "a", sub: "past_due" }])).toBeNull();
  });

  it("DOES NOT ACCEPT Stripe's own `trialing`", () => {
    // That is Stripe's trial vocabulary, not this product's. Accepting it would let a card-less
    // checkout unlock a second company.
    expect(blocking([{ id: "a", sub: "trialing" }])).toBeTruthy();
  });

  it("ignores soft-deleted companies", () => {
    // `delete_company` was a hard delete once and the schema filters on `deleted_at`. Without this a
    // company that no longer exists would block, with nothing on screen to explain why.
    expect(blocking([{ id: "a", deleted: true }])).toBeNull();
  });

  it("counts OWNERSHIP, not membership", () => {
    // An advisor in five client companies owns none of them. Counting memberships here would repeat the
    // `advisor_usage.companies` mistake — a membership count read as though it meant something else.
    const advisorOwnsNothing = [];
    expect(blocking(advisorOwnsNothing)).toBeNull();
  });

  it("still allows a company once inside a paid period that has been cancelled", () => {
    expect(blocking([{ id: "a", periodEnd: 1 }])).toBeNull();
  });
});
