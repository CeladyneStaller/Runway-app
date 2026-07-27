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

export const PLANS = [
  {
    id: "solo",
    name: "Solo",
    price: 40,
    companies: 1,
    blurb: "One company. Everything the app does.",
    features: [
      "Full projection, scenarios and confidence bands",
      "SF-424A import and export",
      "Ledger upload and reconciliation",
      "Export your model any time",
    ],
  },
  {
    id: "advisor",
    name: "Advisor",
    price: 99,
    companies: Infinity,
    blurb: "Every company you look after.",
    features: [
      "Everything in Solo",
      "Unlimited companies",
      "Invite colleagues to a company",
    ],
  },
  {
    id: "connected",
    name: "Connected",
    price: 149,
    companies: Infinity,
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
