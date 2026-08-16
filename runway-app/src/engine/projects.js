// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { computeGrant } from "./grant.js";
import { HRS_YR, empCostAt, empHourlyAt } from "./payroll.js";
import { NOMINAL_RATE, poNeedsReview, poUnwon } from "./sales.js";
import { clampM, uid } from "./time.js";

// A personnel line linked to an employee derives its billing rate from that person's salary,
// unless the user has overridden it (rateAuto === false). Resolved in ONE place so every
// consumer — projection, rollups, cards, export — sees the same numbers and computeGrant stays pure.
export const resolveProjectRates = (projects, employees, fringePct = 0) => projects.map(p0 => {
  let p = p0;
  // Fulfillment / internal labour: priced from whoever is assigned to it, at their LOADED cost.
  // An engineer-hour costs salary + employer burden. empHourlyAt is salary-only because grants bill
  // fringe as its own SF-424A category — that convention is right there and wrong here, where the
  // question is simply what this order costs to build.
  if (p.lines?.some(l => l.isLabor)) {
    p = { ...p, lines: p.lines.map(l => {
      if (!l.isLabor) return l;
      const e = employees.find(x => x.id === l.employeeId);
      // Nobody assigned yet still costs the business something — fall back to the nominal rate,
      // loaded the same way, so unstaffed work never looks cheaper than staffed work.
      const rate = e ? empCostAt(e, l.start ?? 0, fringePct) * 12 / HRS_YR : NOMINAL_RATE * (1 + fringePct);
      const months = Math.max(1, (l.end ?? l.start ?? 0) - (l.start ?? 0) + 1);
      return { ...l, rate, amount: Math.round(((l.hours || 0) * rate) / months) };
    }) };
  }
  const pers = p.grant?.categories?.personnel;
  if (p.type !== "grant" || !pers?.length) return p;
  const P = p.grant.periods || [];
  const personnel = pers.map(l => {
    if (!l.employeeId || l.rateAuto === false) return l;
    const e = employees.find(x => x.id === l.employeeId);
    if (!e) return l;
    return { ...l, byPeriod: (l.byPeriod || []).map((b, i) => ({ ...b, rate: Math.round(empHourlyAt(e, P[i]?.start ?? 0) * 100) / 100 })) };
  });
  return { ...p, grant: { ...p.grant, categories: { ...p.grant.categories, personnel } } };
});

export const syncFulfilStage = (projects, pos) => projects.map(p => {
  if (p.type !== "fulfillment") return p;
  const po = pos.find(x => x.id === p.poId);
  if (!po) return p;
  const want = (poUnwon(po) || poNeedsReview(po)) ? "prospective" : "awarded";
  // Fulfillment cash and team time ride on the same confidence as the order they serve — you don't buy
  // the materials, or book the engineer, for a quote you haven't won.
  const conf = po.confidence || "committed";
  const lines = (p.lines || []).map(l => l.confidence === conf ? l : { ...l, confidence: conf });
  return { ...p, stage: want, lines };
});

// Who is committed to what, month by month, across grants and fulfillment work. This is the payoff of
// linking labour to people: capacity is finite, and two projects can quietly claim the same engineer.
export const teamLoad = (rProjects, toggles = { committed: true, expected: true, speculative: true }) => {
  const byEmp = {};
  const push = (id, project, label, hrs, s, e) => {
    if (!id || !hrs) return;
    const rec = byEmp[id] || (byEmp[id] = { months: {}, items: [] });
    const n = Math.max(1, e - s + 1), per = hrs / n;
    for (let m = s; m <= e; m++) rec.months[m] = (rec.months[m] || 0) + per;
    rec.items.push({ project, label, hours: hrs, start: s, end: e, load: Math.round((per / (HRS_YR / 12)) * 100) });
  };
  rProjects.forEach(p => {
    if (p.stage === "prospective" && !p.include) return; // proposals aren't real commitments yet
    if (p.type === "grant") {
      const P = p.grant?.periods || [];
      (p.grant?.categories?.personnel || []).forEach(l => (l.byPeriod || []).forEach((b, i) => {
        const pp = P[i]; if (pp && b?.hrs) push(l.employeeId, p.name, l.role, b.hrs, clampM(pp.start), clampM(pp.end));
      }));
    } else {
      (p.lines || []).filter(l => l.isLabor && !(l.confidence && !toggles[l.confidence]))
        .forEach(l => push(l.employeeId, p.name, l.label, l.hours || 0, clampM(l.start ?? 0), clampM(l.end ?? l.start ?? 0)));
    }
  });
  return byEmp;
};

export const compileProject = (p) => p.type === "grant" ? computeGrant(p.grant).lines : (p.lines || []).filter(l => !l.isLabor);

export const blankGrant = () => ({ funder: "Funder", assumeFunded: false, costShareType: "cash", costSharePct: 0.2,
  reimburseTiming: "arrears", reimburseLagMonths: 1, milestones: [], periods: [{ id: uid(), start: 0, end: 5 }],
  categories: { personnel: [], fringe: { byPeriod: [0] }, travel: [], equipment: [], supplies: [],
    contractual: [], construction: [], other: [], indirect: { base: "total_direct", rates: [] } } });

export const blankInternal = () => ({ budget: 50000, start: 0, end: 6,
  lines: [{ id: uid(), label: "Cost line", cadence: "recurring", kind: "cost", amount: 6000, start: 0, end: 5, growthPct: 0 }] });


// ── Labor on an internal project ─────────────────────────────────────────────────────────────────
//
// ⚠️ GRANT AND FULFILMENT PROJECTS ALLOCATE LABOR; INTERNAL ONES COULD NOT. `GrantCard` and
// `FulfillmentCard` both receive `employees`, `InternalCard` did not — so people cost on internal work
// landed in unallocated payroll with nothing to attribute it to. **The Payroll tab reports Allocated
// and Unallocated as percentages, so an organisation doing real internal R&D read a permanently high
// unallocated figure and concluded the model was wrong**, when the model had no way to be right.

/** ⚠️ NOBODY WORKS 260 DAYS. That is the naive answer — holidays and leave put most organisations near
 *  220, and using 260 understates every internal project by roughly 15%. A company setting with a
 *  stated default, not a constant buried in here. */
export const WORKING_DAYS_DEFAULT = 220;

export const workingDaysOf = (doc) => {
  const v = Number(doc?.settings?.workingDaysPerYear);
  return Number.isFinite(v) && v >= 120 && v <= 366 ? v : WORKING_DAYS_DEFAULT;
};

/**
 * Compile an internal project's labor into monthly employee lines.
 *
 * ⚠️ DAYS ARE THE INPUT AND THE PERCENTAGE IS DERIVED — Corey's call, and it holds up: "Dana for about
 * twenty-two days a quarter" is how internal work is discussed, and **a percentage entered by hand
 * silently becomes wrong at the next raise.** Days do not.
 *
 * ⚠️ AND THE LINES CARRY `projectId`, which is the same field the grant path emits — so the allocation
 * bar, `allocPct`, the `project` dimension and every payroll chart pick this up with NO change. This is
 * a missing input, not a missing feature.
 */
export function compileInternalLabor(p, employees = [], doc = null, horizon = 36) {
  const out = [];
  const wd = workingDaysOf(doc);
  for (const a of p?.labor || []) {
    const e = (employees || []).find(x => x.id === a.employeeId);
    if (!e || !(Number(a.days) > 0)) continue;

    // The span defaults to the project's own — most internal work runs its length, and making that the
    // default means the common case is two fields rather than four.
    const start = Number.isFinite(Number(a.start)) ? Number(a.start) : (Number(p.start) || 0);
    const end = Number.isFinite(Number(a.end)) ? Number(a.end) : (Number(p.end) || horizon - 1);
    const months = Math.max(1, Math.min(horizon, end - start + 1));

    // EVEN ACROSS THE SPAN. Anything cleverer is a guess about a schedule nobody has entered.
    const daysPerMonth = Number(a.days) / months;

    out.push({
      kind: "cost", cadence: "recurring", start, end,
      projectId: p.id, employeeId: e.id,
      label: `${e.name || "Someone"} · ${p.name || "Internal"}`,
      // ⚠️ THE AMOUNT IS RESOLVED PER MONTH BY THE PAYROLL COMPILER, not here — it owns raises, fringe
      // and basis, and duplicating any of that would give two answers for one salary.
      daysPerMonth, workingDays: wd,
    });
  }
  return out;
}

/** What one allocation costs, for display on the card. */
export function laborCost(a, e, doc, monthlyOf) {
  const wd = workingDaysOf(doc);
  const days = Number(a?.days) || 0;
  const annual = (monthlyOf?.(e) ?? 0) * 12;
  return wd > 0 ? (annual / wd) * days : 0;
}

/** Person-months, shown beside the days — this audience thinks in them for everything else. */
export const personMonths = (days, doc) => (days || 0) / (workingDaysOf(doc) / 12);
