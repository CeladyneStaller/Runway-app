// What a collapsed project header needs to show, computed once, per type. Pure: a project (with its
// resolved rates) plus recorded actuals in, a plain summary out. The views render it; they never
// recompute it.
import { HORIZON, floorM } from "./time.js";
import { lineSpan } from "./projection.js";
import { computeGrant, isMsBilled, msPaid } from "./grant.js";
import { compileProject } from "./projects.js";
import { poDeposit, poPaidMonth } from "./sales.js";
import { effectiveActuals } from "./coding.js";

// Actuals mirror cashActuals exactly: { [month]: spend }. `spentToDate` is the sum of every recorded
// month — "to date" means "as far as the books go", which is however many months have been entered.
export const spentToDate = (actuals) =>
  Object.values(actuals || {}).reduce((a, v) => a + (Number(v) || 0), 0);
export const lastActualMonth = (actuals) => {
  const ms = Object.keys(actuals || {}).map(Number).filter(Number.isFinite);
  return ms.length ? Math.max(...ms) : null;
};

// The budget tag is the one subtle judgement here, and it has THREE states, not two:
//   over      — actual spend already exceeds the whole budget.
//   at-risk   — still under budget overall, but the cost lines scheduled through the last recorded
//               month say you should have spent LESS than you actually have. On budget today, on
//               track to blow it. This is the state the request specifically called out, and it's the
//               only one that needs the projection, not just the total.
//   on-budget — spending at or under the plan.
// No actuals yet => no judgement. A tag invented from no data is worse than no tag.
export function budgetTag(budget, actuals, plannedThrough) {
  const spent = spentToDate(actuals);
  const last = lastActualMonth(actuals);
  if (last == null || !(budget > 0)) return { tag: "none", spent, budget: budget || 0 };
  if (spent > budget) return { tag: "over", spent, budget, over: spent - budget };
  const planned = plannedThrough(last);   // what the cost lines say you'd have spent by `last`
  if (planned > 0 && spent > planned * 1.05) return { tag: "at-risk", spent, budget, planned, ahead: spent - planned };
  return { tag: "on-budget", spent, budget };
}

// Cost lines a project would have incurred through month m (inclusive). Drives the at-risk test and
// the "cost to date" figure when there are no actuals to show instead.
const plannedCostThrough = (p, m) =>
  compileProject(p).filter(l => l.kind === "cost")
    .reduce((a, l) => a + lineSpanThrough(l, m), 0);

// Like lineSpan, but clipped at month m — how much of a recurring line has landed so far.
const lineSpanThrough = (l, m) => {
  if (l.cadence === "onetime") return (l.start ?? 0) <= m ? (l.amount || 0) : 0;
  const s = l.start ?? 0, e = l.end == null ? HORIZON : l.end;
  const last = Math.min(e, m);
  return last < s ? 0 : (l.amount || 0) * (last - s + 1);
};

const money = (p) => compileProject(p).reduce((a, l) => a + lineSpan(l), 0);

// ---- per-type summaries. Each returns { type, name, who, tag, ...fields the header shows } ----

function internalSummary(p) {
  const budget = p.budget || 0;
  const t = budgetTag(budget, p.actuals, (m) => plannedCostThrough(p, m));
  return {
    type: "internal", name: p.name, who: null,
    budget, spent: t.spent, start: p.start ?? 0, end: p.end ?? HORIZON,
    costToDate: plannedCostThrough(p, lastActualMonth(p.actuals) ?? -1),
    ...t,
  };
}

function grantSummary(p) {
  const G = computeGrant(p.grant);
  const g = p.grant;
  const ms = g.milestones || [];
  const done = ms.filter(m => m.status === "accepted" || msPaid(m)).length;
  const nextDue = ms.filter(m => !(m.status === "accepted" || msPaid(m)))
    .sort((a, b) => (a.month ?? 0) - (b.month ?? 0))[0] || null;
  // cash actually in the door = milestones marked paid (they live in cashActuals, not the projection)
  const cashIn = ms.filter(msPaid).reduce((a, m) => a + (m.payment || 0), 0);
  const t = budgetTag(G.grand.total, p.actuals, (m) => plannedCostThrough(p, m));
  return {
    type: p.stage === "prospective" ? "proposal" : "grant",
    kind: "grant", name: p.name, who: g.funder || null,
    total: G.grand.total, federal: G.grand.federal, costShare: G.grand.costShare,
    billing: g.reimburseTiming || "arrears", isMilestone: isMsBilled(g),
    milestonesDone: done, milestonesTotal: ms.length, nextDue,
    cashIn, costToDate: t.spent, decisionMonth: p.decisionMonth ?? null,
    ...t,
  };
}

function fulfillmentSummary(p, pos) {
  const po = (pos || []).find(x => x.id === p.poId) || {};
  const orderValue = po.amount || 0;
  const costToFulfil = money(p);                 // cash cost only — labour is excluded in compileProject
  const t = budgetTag(costToFulfil, p.actuals, (m) => plannedCostThrough(p, m));
  return {
    type: "fulfillment", name: p.name, who: po.customer || null,
    orderValue, costToFulfil, margin: orderValue - costToFulfil,
    marginPct: orderValue > 0 ? (orderValue - costToFulfil) / orderValue : 0,
    costToDate: t.spent, ...t,
  };
}

export function projectSummary(p, pos, hist, codeMap) {
  // coded spend is the source of truth for a project's actuals; a manual override can redistribute
  // within it and is flagged upstream when it changes the total.
  const eff = (hist || codeMap) ? effectiveActuals(p, hist, codeMap) : { actuals: p.actuals || {}, flagged: false };
  const withActuals = { ...p, actuals: eff.actuals, _actualsFlagged: eff.flagged };
  const s = withActuals.type === "grant" ? grantSummary(withActuals)
    : withActuals.type === "fulfillment" ? fulfillmentSummary(withActuals, pos)
    : internalSummary(withActuals);
  return { ...s, actualsFlagged: eff.flagged };
}
