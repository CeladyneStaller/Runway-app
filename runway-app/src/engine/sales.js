// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { HORIZON, clampM, floorM, uid } from "./time";

// Labour on a fulfillment project is your own team's time. It belongs in the project — you need to see
// who is committed to what — but it never draws cash, because payroll already paid for it.
// A fulfillment project whose scope is still under review is a proposal, not a plan. The stage is
// DERIVED from the PO rather than stored, so editing a target re-opens the question automatically.
// Two independent questions gate a fulfillment project: have you WON the order, and have you SETTLED
// the scope? Either one open makes it a proposal. Stage is derived from the PO rather than stored, so
// editing a target or signing a quote re-answers it automatically. `include` stays the user's call —
// it's the "model the win" toggle.
export const poUnwon = (po) => po.confidence === "speculative";

// internal project or grant -> master-projection line items
// ---- purchase orders -> revenue lines ----
// Conservative by construction: a customer may pay late, never early. round() let net-40 land at 30
// days; ceil() means the model never books money before the terms allow it.
export const poLag = (po) => Math.ceil((po.termsDays || 0) / 30);

export const poDeposit = (po) => (po.amount || 0) * (po.depositPct || 0);

// clampM does two jobs: floor at 0, and ceiling at HORIZON. The floor is right — nothing in the model
// happens before the projection starts. The ceiling is right for select values and array indices, and
// WRONG for placing money in time: buildProjection already ignores a month past the horizon, so a
// ceiling here doesn't drop the money, it DRAGS IT BACKWARDS onto the last visible month. A delivery
// at the horizon edge on net-90 terms is paid three months later; clamped, that revenue would land
// three months early at full value, right at the edge of the chart where it flatters the ending balance.
export const poPaidMonth = (po) => floorM((po.deliveryMonth || 0) + poLag(po));

export const poBeyondHorizon = (po) => poPaidMonth(po) > HORIZON;

// Deposit lands when the order is booked; the balance lands on delivery plus payment terms.
export const compilePO = (po) => {
  const lines = [], dep = poDeposit(po), bal = (po.amount || 0) - dep, conf = po.confidence || "expected";
  if (dep > 0.01) lines.push({ cadence: "onetime", kind: "revenue", amount: dep, start: floorM(po.bookedMonth || 0), label: "Deposit", confidence: conf });
  // Left unclamped on purpose: past the horizon this line simply never fires, which is the truth.
  if (bal > 0.01) lines.push({ cadence: "onetime", kind: "revenue", amount: bal, start: poPaidMonth(po), label: "Balance on delivery", confidence: conf });
  return lines;
};

export const PHASES = [["development", "Development / NRE"], ["production", "Production"], ["qualification", "Qualification & test"], ["logistics", "Logistics"]];

// How much a miss actually matters. Only binding misses force development — you don't spin up an
// engineering programme because a nice-to-have came in low.
export const FLEX = [["showstopper", "Showstopper"], ["soft", "Soft"], ["nice", "Nice to have"], ["assumed", "Assumed"]];

export const FLEX_LABEL = Object.fromEntries(FLEX);

export const BINDING = ["showstopper", "soft"];

// Status is measured, not asserted: compare the current value against the committed target.
// No current value yet means untested, not passing.
export const targetStatus = (t) => {
  const cur = t.current, tgt = t.target;
  if (cur == null || cur === "" || tgt == null || tgt === "") return "pending";
  const c = +cur, g = +tgt;
  if (!isFinite(c) || !isFinite(g)) return "pending";
  return (t.dir === "below" ? c <= g : c >= g) ? "met" : "missed";
};

export const targetText = (t) => `${t.dir === "below" ? "\u2264" : "\u2265"} ${t.target}${t.units ? " " + t.units : ""}`;

// A binding target you cannot currently hit is unbuilt engineering — so targets drive dev, not a hand-set flag.
export const poAtRisk = (po) => (po.targets || []).some(t => targetStatus(t) === "missed" && BINDING.includes(t.flex || "showstopper"));

// The executive gets the last word: kick the dev off, or circumvent the gap some other way.
export const poDevNeeded = (po) => po.devDecision === "circumvent" ? false : (poAtRisk(po) || po.devDecision === "kickoff");

export const poNeedsReview = (po) => poAtRisk(po) && !po.devDecision;

// Rough hours estimate from order value, at a nominal blended engineering rate. Who actually does
// the work is assigned per line — the cost then follows that person's real salary.
export const NOMINAL_RATE = 65;

export const laborLine = (label, phase, v, pct, s, e) => ({ id: uid(), label, phase, kind: "cost", isLabor: true, employeeId: null,
  hours: Math.round(v * pct / NOMINAL_RATE), cadence: "recurring", amount: 0, start: s, end: e, growthPct: 0 });

// Development spend is what you BUY to close a target gap — prototype hardware, outside test time.
// The engineering hours sit alongside as labour lines: visible, assignable, and never charged to cash.
export const devLines = (po) => {
  const del = po.deliveryMonth ?? 6, booked = po.bookedMonth ?? 0, v = po.amount || 0;
  const s = clampM(booked), e = clampM(Math.max(booked, del - 2));
  return [
    laborLine("Development engineering", "development", v, 0.15, s, e),
    { id: uid(), label: "Prototype materials & test articles", phase: "development", cadence: "recurring", kind: "cost", amount: Math.round(v * 0.06 / Math.max(1, e - s + 1)), start: s, end: e, growthPct: 0 },
    { id: uid(), label: "External test & characterization", phase: "development", cadence: "onetime", kind: "cost", amount: Math.round(v * 0.04), start: e },
  ];
};

// A fulfillment project seeded from the PO. The splits are starting estimates, not gospel — the point is
// that shipping a PO costs real money on a deadline, and that cash-out belongs in the runway.
export const blankFulfillment = (po) => {
  const del = po.deliveryMonth ?? 6, booked = po.bookedMonth ?? 0, v = po.amount || 0, lines = [];
  if (poDevNeeded(po)) lines.push(...devLines(po));
  lines.push(laborLine("Production engineering", "production", v, 0.05, clampM(Math.max(booked, del - 2)), clampM(del)));
  lines.push({ id: uid(), label: "Materials & BOM", phase: "production", cadence: "onetime", kind: "cost", amount: Math.round(v * 0.32), start: clampM(del - 2) });
  lines.push({ id: uid(), label: "Contract manufacturing", phase: "production", cadence: "onetime", kind: "cost", amount: Math.round(v * 0.12), start: clampM(del - 1) });
  lines.push(laborLine("Test & qualification engineering", "qualification", v, 0.04, clampM(del - 1), clampM(del)));
  lines.push({ id: uid(), label: "Outside qualification & test", phase: "qualification", cadence: "onetime", kind: "cost", amount: Math.round(v * 0.05), start: clampM(del - 1) });
  lines.push({ id: uid(), label: "Shipping & install", phase: "logistics", cadence: "onetime", kind: "cost", amount: Math.round(v * 0.03), start: clampM(del) });
  return { id: uid(), type: "fulfillment", poId: po.id, stage: (poUnwon(po) || poNeedsReview(po)) ? "prospective" : "awarded", include: true,
    decisionMonth: clampM(po.bookedMonth ?? 0), name: `${po.customer} — ${po.po}`, lines };
};
