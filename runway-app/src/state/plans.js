// The commercial model, in one place.
//
// Mirrors `009_plans.sql`. The DATABASE IS AUTHORITATIVE — this file exists so the UI can name a
// plan, price it and describe it, never so the client can decide who may write. Anything gated in
// React is gated in name only: the whole engine ships to the browser.
//
// SO THE TIERS DO NOT GATE FEATURES. Scenarios, confidence bands and SF-424A are in the bundle and
// cannot be withheld from anyone who opens devtools. What the server actually mediates is how many
// companies you may SAVE, and later whether a ledger connection runs — so that is what is priced.
// A tier list that promises to withhold something it cannot is worse than no tier list.

export const TRIAL_DAYS = 14;

// WHICH TERMS THIS BUILD ASKS PEOPLE TO ACCEPT. A DATE, NOT A NUMBER: it names when the document was
// published, which is what anybody investigating an acceptance actually wants to know.
//
// MUST MATCH `terms_current()` in migration 046, and a test reads both — a client one deploy behind
// that writes an old version string would read as accepted, which makes the whole record worthless.
// Bump this ONLY when the published terms change, because bumping it asks every existing user again.
export const TERMS_VERSION = "2026-08-04";

export const PLANS = [
  {
    id: "solo",
    name: "Solo",
    price: 40,
    seats: 1,
    blurb: "One company. Everything the app does.",
    features: [
      "Full projection, scenarios and confidence bands",
      "SF-424A import and export",
      "Ledger upload and reconciliation",
      "Export your model any time",
    ],
  },
  {
    id: "collaborative",
    name: "Collaborative",
    price: 99,
    seats: 3,
    blurb: "You and two colleagues in the same model.",
    features: [
      "Everything in Solo",
      "Up to 3 people",
      "Invite colleagues to a company",
    ],
  },
  {
    id: "connected",
    name: "Connected",
    price: 149,
    seats: 5,
    // NOT BUILT. Listed so the ladder is visible, and marked so nobody sells it by accident.
    comingSoon: true,
    blurb: "Your ledger, imported automatically.",
    features: [
      "Everything in Advisor",
      "Automatic ledger import",
      "Actuals reconciled without a CSV",
    ],
  },
];

export const planById = (id) => PLANS.find(p => p.id === id) || null;

/** What the Account page should say about where somebody stands.
 *  `state` is one of: trialing | active | past_due | lapsed | none. */
export function planSummary(row, now = new Date()) {
  const plan = planById(row?.plan);
  const trialEnds = row?.trial_ends_at ? new Date(row.trial_ends_at) : null;
  const periodEnd = row?.period_end ? new Date(row.period_end) : null;
  const paying = ["active", "trialing", "past_due"].includes(row?.status)
    || (periodEnd && periodEnd > now);

  if (paying) {
    return {
      state: row.status === "past_due" ? "past_due" : "active",
      plan, periodEnd,
      // Cancelled but paid up: access continues to the end of the period they bought.
      lapsing: row?.status === "canceled" || row?.status === "unpaid",
    };
  }
  if (trialEnds && trialEnds > now) {
    return {
      state: "trialing", plan: null, trialEnds,
      daysLeft: Math.max(0, Math.ceil((trialEnds - now) / 86400000)),
    };
  }
  // A trial that HAS ended is materially different from never having had one: the first is a
  // customer who tried the product, the second is somebody who never got in.
  return { state: trialEnds ? "lapsed" : "none", plan: null, trialEnds };
}

/** Wording for a save refused on billing. Kept beside the plans so the message and the model cannot
 *  drift apart, and phrased so nobody thinks their data is gone — it isn't, it is still in memory
 *  and still exportable. */
export function unpaidMessage(summary) {
  if (summary?.state === "lapsed") {
    return "Your trial has ended, so changes aren't being saved. Your model is safe and you can "
         + "still export it — choose a plan to start saving again.";
  }
  if (summary?.state === "past_due") {
    return "Your last payment didn't go through. Changes are still saving for now; update your card "
         + "to avoid interruption.";
  }
  return "This company isn't covered by your plan, so changes aren't being saved. Your model is safe "
       + "and you can still export it.";
}

// ---- the advisor product -----------------------------------------------------
// A SEPARATE LADDER, sold to a different person for a different thing. A company plan buys seats in
// one company; an advisor plan buys the ability to work across many without taking a seat in any of
// them. They share no table, no Stripe product and no vocabulary — `subscriptions` is keyed on the
// company, `advisor_subscriptions` on the user.
//
// NO FREE TIER, and the floor is arbitrage rather than taste: the cheapest marginal seat is
// Solo -> Collaborative, +$59 for two seats, about $30 each. An advisor plan below that would be a
// cheaper way to buy seats, and the seat model would have a hole in it.
export const ADVISOR_PLANS = [
  {
    id: "advisor",
    name: "Advisor",
    price: 99,
    companies: 3,
    blurb: "Up to three companies you advise.",
    features: [
      "A seat in three companies, without using any of their seats",
      "Your own scenarios in each, shared only if you offer them",
      "One portfolio view across all of them",
    ],
  },
  {
    id: "advisor_unlimited",
    name: "Advisor Unlimited",
    price: 199,
    companies: Infinity,
    blurb: "Every company you advise.",
    features: [
      "Everything in Advisor",
      "No limit on companies",
    ],
  },
];

export const advisorPlanById = (id) => ADVISOR_PLANS.find(p => p.id === id) || null;

/** What to say about an advisor's own plan. `used` and `allowed` come from `advisor_usage()`. */
export function advisorSummary({ plan, status, used = 0, allowed = 0, cancel_at_period_end } = {}) {
  if (!plan || status === "none") return { state: "none", text: "You do not have an advisor plan." };
  const name = advisorPlanById(plan)?.name || plan;
  const left = Math.max(0, allowed - used);
  if (used >= allowed) {
    return { state: "full", text: `${name}: ${used} of ${allowed} companies. ` +
      "You cannot join another until you upgrade or leave one." };
  }
  return {
    state: cancel_at_period_end ? "ending" : "active",
    text: `${name}: ${used} of ${allowed} companies, ${left} left.` +
          (cancel_at_period_end ? " Ends at the close of this period and will not renew." : ""),
  };
}
