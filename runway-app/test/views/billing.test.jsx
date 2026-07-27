// The billing UI. Its real job is making a refused save legible: without it, "Couldn't save" reads as
// a bug and people retry, reload, and conclude the product is broken.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { BillingSection } from "../../src/views/Account";

const api = (plan, over = {}) => ({
  myPlan: async () => plan,
  checkout: vi.fn(async () => "https://checkout.stripe.com/x"),
  billingPortal: vi.fn(async () => "https://billing.stripe.com/x"),
  ...over,
});
const draw = async (a) => {
  const { container } = render(<BillingSection account={a} onError={() => {}} />);
  await waitFor(() => expect(container.textContent).toMatch(/Billing/));
  return container;
};
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();

describe("what it tells you", () => {
  it("counts down a trial, and says no card is needed", async () => {
    const c = await draw(api({ plan: "none", status: "none", trial_ends_at: days(9) }));
    await waitFor(() => expect(c.textContent).toMatch(/9 days left/));
    expect(c.textContent).toMatch(/No card needed/i);
  });

  it("names the current plan and its renewal", async () => {
    const c = await draw(api({ plan: "advisor", status: "active", period_end: days(20) }));
    await waitFor(() => expect(c.textContent).toMatch(/Advisor/));
    expect(c.textContent).toMatch(/\$99\/month/);
  });

  it("says a lapsed trial is lapsed, and that the model is still exportable", async () => {
    // Never imply the data is gone. It is not: the edit is held in memory and export is never gated.
    const c = await draw(api({ plan: "none", status: "none", trial_ends_at: days(-1) }));
    await waitFor(() => expect(c.textContent).toMatch(/trial has ended/i));
    expect(c.textContent).toMatch(/still export/i);
    expect(c.textContent).not.toMatch(/lost|deleted/i);
  });

  it("reports a failed card as dunning, not lockout", async () => {
    const c = await draw(api({ plan: "solo", status: "past_due", period_end: days(3) }));
    await waitFor(() => expect(c.textContent).toMatch(/didn't go through/i));
  });

  it("tells a staff account it is exempt rather than showing 'no plan'", async () => {
    const c = await draw(api({ plan: "staff", status: "staff" }));
    await waitFor(() => expect(c.textContent).toMatch(/exempt from billing/i));
    expect(c.querySelector(".plancard")).toBeNull();   // nothing to sell them
  });
});

describe("the ladder", () => {
  it("shows all three tiers with prices", async () => {
    const c = await draw(api({ plan: "none", status: "none" }));
    await waitFor(() => expect(c.querySelectorAll(".plancard").length).toBe(3));
    expect(c.textContent).toMatch(/\$40/);
    expect(c.textContent).toMatch(/\$99/);
    expect(c.textContent).toMatch(/\$149/);
  });

  it("marks Connected unavailable rather than selling something that does not exist", async () => {
    const c = await draw(api({ plan: "none", status: "none" }));
    await waitFor(() => expect(c.textContent).toMatch(/Not available yet/));
  });

  it("marks the plan you are on instead of offering it again", async () => {
    const c = await draw(api({ plan: "solo", status: "active", period_end: days(20) }));
    await waitFor(() => expect(c.textContent).toMatch(/Your plan/));
  });

  it("starts a checkout for the tier you pick", async () => {
    const a = api({ plan: "none", status: "none" });
    const c = await draw(a);
    await waitFor(() => expect(c.querySelectorAll(".plancard").length).toBe(3));
    fireEvent.click([...c.querySelectorAll("button")].find(b => /Choose Advisor/.test(b.textContent)));
    await waitFor(() => expect(a.checkout).toHaveBeenCalledWith("advisor"));
  });

  it("offers the portal only once there is a subscription to manage", async () => {
    const paid = await draw(api({ plan: "solo", status: "active", period_end: days(20) }));
    await waitFor(() => expect(paid.textContent).toMatch(/Manage billing/));

    const trial = await draw(api({ plan: "none", status: "none", trial_ends_at: days(5) }));
    expect(trial.textContent).not.toMatch(/Manage billing/);
  });
});
