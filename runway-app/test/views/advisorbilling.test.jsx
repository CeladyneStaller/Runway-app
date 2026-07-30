// The advisor's own plan. Everything here is a decision about WHEN to show a price, which is the part
// of a billing screen most easily got wrong: an offer shown to somebody it would do nothing for reads
// as an upsell, and a consequence not mentioned until it happens reads as a fault.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { AdvisorBilling } from "../../src/views/chrome/AdvisorBilling";

afterEach(cleanup);

const api = (plan, over = {}) => ({
  advisorPlan: vi.fn().mockResolvedValue(plan),
  checkoutAdvisor: vi.fn().mockResolvedValue("https://checkout.stripe.com/x"),
  advisorPortal: vi.fn().mockResolvedValue("https://billing.stripe.com/x"),
  ...over,
});

const draw = async (a) => {
  const v = render(<AdvisorBilling account={a} onError={() => {}} />);
  await waitFor(() => expect(a.advisorPlan).toHaveBeenCalled());
  return v;
};

describe("when it stays out of the way", () => {
  it("IS SHOWN to somebody with one company and no plan", async () => {
    // REVERSED DELIBERATELY. This used to assert absence, on the reasoning that an advisor tier does
    // nothing for a founder with a single company. True of a founder, and it hid the panel from the one
    // person it is for: a fractional CFO evaluating this before any client has invited them has exactly
    // one company, or none.
    const v = await draw(api({ companies: 1, allowed: 0 }));
    expect(v.container.textContent).toMatch(/Advise several companies/i);
  });

  it("is shown to somebody in no companies at all", async () => {
    const v = await draw(api({ companies: 0, allowed: 0 }));
    expect(v.container.textContent).toMatch(/Advise several companies/i);
  });

  it("leads with WHO it is for rather than what it costs", async () => {
    // Somebody it does not apply to should be able to stop reading at the first line.
    const v = await draw(api({ companies: 1, allowed: 0 }));
    expect(v.container.textContent).toMatch(/accountants and fractional CFOs/i);
  });

  it("is absent when the plan call fails", async () => {
    const v = await draw(api(null, { advisorPlan: vi.fn().mockRejectedValue(new Error("offline")) }));
    expect(v.container.textContent).toBe("");
  });
});

describe("when it appears", () => {
  it("pitches to somebody already in several companies", async () => {
    // Still the strongest signal an advisor plan is worth something to them — it just is no longer the
    // CONDITION for showing it.
    const v = await draw(api({ companies: 3, allowed: 0 }));
    expect(v.container.textContent).toMatch(/Advise several companies/i);
    expect(v.container.textContent).toMatch(/Choose Advisor/);
  });

  it("shows a subscriber their usage against the limit", async () => {
    const v = await draw(api({ companies: 2, allowed: 3, plan: "advisor" }));
    expect(v.container.textContent).toMatch(/2 of 3 companies/);
  });

  it("says what to do when the plan is full", async () => {
    const v = await draw(api({ companies: 3, allowed: 3, plan: "advisor" }));
    expect(v.container.textContent).toMatch(/cannot join another/i);
  });
});

describe("what it offers", () => {
  it("does not offer the plan you are already on", async () => {
    // A card marked "your plan" beside one that is not is how a pricing panel reads as an upsell.
    const v = await draw(api({ companies: 2, allowed: 3, plan: "advisor" }));
    expect(v.container.textContent).toMatch(/Switch to Advisor Unlimited/);
    expect(v.container.textContent).not.toMatch(/Switch to Advisor ·/);
  });

  it("offers the SMALLER plan to somebody on the top one", async () => {
    // A downgrade is a legitimate thing to want, and hiding it would mean the only way down is the
    // Stripe portal. What must not appear is the plan they are already on.
    const v = await draw(api({ companies: 9, allowed: 1000000, plan: "advisor_unlimited" }));
    expect(v.container.textContent).toMatch(/Switch to Advisor/);
    expect(v.container.textContent).not.toMatch(/Switch to Advisor Unlimited/);
    expect(v.container.textContent).toMatch(/Manage billing/);
  });

  it("starts a checkout for the tier picked", async () => {
    const a = api({ companies: 3, allowed: 0 });
    const v = await draw(a);
    fireEvent.click(v.getByText(/Choose Advisor Unlimited/));
    await waitFor(() => expect(a.checkoutAdvisor).toHaveBeenCalledWith("advisor_unlimited"));
  });

  it("offers the portal only once there is a subscription to manage", async () => {
    const withPlan = await draw(api({ companies: 1, allowed: 3, plan: "advisor" }));
    expect(withPlan.container.textContent).toMatch(/Manage billing/);
    cleanup();
    const without = await draw(api({ companies: 4, allowed: 0 }));
    expect(without.container.textContent).not.toMatch(/Manage billing/);
  });
});

describe("the usage figure comes from the right field", () => {
  it("reports the companies you are actually in", async () => {
    // THE BUG THIS PINS. `advisor_usage()` returns `companies`; `advisorSummary` speaks `used`. The
    // row was spread rather than mapped, so `used` defaulted to 0 and somebody in three companies was
    // told they were in none — a number quietly wrong rather than absent, which is worse.
    const v = await draw(api({ companies: 3, allowed: 3, plan: "advisor" }));
    expect(v.container.textContent).toMatch(/3 of 3 companies/);
    expect(v.container.textContent).not.toMatch(/0 of 3/);
  });
});

describe("the consequence nobody expects", () => {
  it("warns that lapsing takes a seat in every company you are in", async () => {
    // An advisor who lapses stops being exempt and starts consuming a seat everywhere at once, which
    // can push several companies over capacity — and their owners will see people lose write access
    // without having changed anything. Said before it happens rather than after.
    const v = await draw(api({ companies: 4, allowed: 1000000, plan: "advisor_unlimited" }));
    expect(v.container.textContent).toMatch(/take a seat in each of the 4 companies/i);
    expect(v.container.textContent).toMatch(/over their limit/i);
  });

  it("says it in the singular for one company", async () => {
    const v = await draw(api({ companies: 1, allowed: 3, plan: "advisor" }));
    expect(v.container.textContent).toMatch(/each of the 1 company\b/i);
  });

  it("does not warn somebody who has no plan to lose", async () => {
    const v = await draw(api({ companies: 5, allowed: 0 }));
    expect(v.container.textContent).not.toMatch(/take a seat in each/i);
  });
});

describe("failures reach the caller", () => {
  it("reports a checkout that could not start", async () => {
    const onError = vi.fn();
    const a = api({ companies: 3, allowed: 0 },
                  { checkoutAdvisor: vi.fn().mockRejectedValue(new Error("not_configured")) });
    const v = render(<AdvisorBilling account={a} onError={onError} />);
    await waitFor(() => expect(a.advisorPlan).toHaveBeenCalled());
    fireEvent.click(v.getByText(/Choose Advisor Unlimited/));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("not_configured"));
  });
});
