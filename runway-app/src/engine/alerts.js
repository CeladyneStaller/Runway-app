// What needs somebody's attention on each tab.
//
// PURE, AND DERIVED FROM THE DOCUMENT. Same rule as the charts: no new storage, nothing recomputed that
// the engine already knows, and nothing that could disagree with the runway on the dashboard.
//
// TWO PER TAB, HARD. Four amber boxes on every screen becomes wallpaper within a week, and then the
// real one is invisible — which is the same argument the QuickBooks keep-alive rules were written
// around, arriving on a different surface. The cap is enforced in `alertsFor`, not left to judgement at
// each call site.
//
// EVERY ALERT NAMES SOMETHING TO DO TODAY. "Runway is short" is a fact and belongs on a tile; "two
// hires start in September and take the runway below six months" is a decision. A rule that cannot
// finish the sentence "so you should…" does not belong here.

import { buildProjection, zeroInfo } from "./projection.js";
import { buildModelFromDoc } from "./buildmodel.js";
import { monthTotal, isCost, lineAmount, unmappedCodes, unresolvedLines } from "./coding.js";
import { spentToDate } from "./summary.js";
import { covenantBreach } from "./capital.js";

const clean = (n) => (Number.isFinite(n) ? n : 0);
const sum = (xs) => xs.reduce((a, b) => a + clean(b), 0);
const pct = (n) => `${Math.round(n * 100)}%`;

const money = (n) => {
  const v = Math.abs(clean(n));
  const s = clean(n) < 0 ? "−" : "";
  if (v >= 1e6) return `${s}$${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `${s}$${Math.round(v / 1e3)}k`;
  return `${s}$${Math.round(v)}`;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The projection, from whatever the caller had. `buildModelParts` does not return rows. */
function rowsOf(doc, parts) {
  if (Array.isArray(parts?.rows) && parts.rows.length) return parts.rows;
  try {
    return buildProjection(parts?.model || buildModelFromDoc(doc), doc.settings?.toggles || {}) || [];
  } catch { return []; }
}

// ---- the rules ---------------------------------------------------------------
// Each returns an alert or null. `tone` is what it looks like; `to` is where the action goes, and a
// rule with nowhere to send somebody is a rule that has not finished thinking.

const unmapped = (doc) => {
  const codes = unmappedCodes(doc.history || [], doc.codeMap || {});
  if (!codes.length) return null;
  return {
    id: "unmapped", tone: "warn",
    text: `${plural(codes.length, "code", "codes")} in the ledger are not mapped to anything, so their ` +
          "spend sits in the baseline rather than against a project.",
    action: "Map them", to: "hist",
  };
};

const unresolved = (doc) => {
  const lines = unresolvedLines(doc.history || [],
                                { codeMap: doc.codeMap || {}, customerMap: doc.customerMap || {} });
  if (!lines?.length) return null;
  const amount = sum(lines.filter(isCost).map(lineAmount));
  if (amount < 1) return null;
  return {
    id: "unresolved", tone: "info",
    text: `${money(amount)} of recorded spend is not attributed to any project.`,
    action: "Attribute it", to: "hist",
  };
};

const overPlan = (doc, parts) => {
  const hist = (doc.history || []).slice(-6);
  if (hist.length < 3) return null;
  const rows = rowsOf(doc, parts);
  let run = 0;
  hist.forEach((h, i) => {
    const planned = Math.abs(clean(rows[i]?.cost));   // `out` never existed — the row has `cost`
    run = planned > 0 && clean(monthTotal(h)) > planned * 1.05 ? run + 1 : 0;
  });
  if (run < 3) return null;
  return {
    id: "over-plan", tone: "bad",
    text: `Spend has been over plan for ${plural(run, "month", "consecutive months")}. ` +
          "The runway on the dashboard is optimistic.",
    action: "Re-base the model", to: "hist",
  };
};

const hiresAhead = (doc, parts) => {
  const lines = parts?.employeeLines || [];
  if (!lines.length) return null;
  const starting = (doc.employees || []).filter(e => clean(e.startM) > 0 && clean(e.startM) <= 3);
  if (!starting.length) return null;

  const z = zeroInfo(rowsOf(doc, parts), doc.startY, doc.startM);
  if (!z || z.months > 9) return null;
  const cost = sum(starting.map(e => clean(e.salary) / 12));
  return {
    id: "hires", tone: "bad",
    text: `${plural(starting.length, "hire", "hires")} start within three months, adding about ` +
          `${money(cost)} a month with ${z.months.toFixed(1)} months of runway left.`,
    action: "See the dates", to: "pay",
  };
};

const unallocated = (doc, parts) => {
  const emp = doc.employees || [];
  const rProjects = parts?.rProjects || [];
  if (!emp.length || !rProjects.length) return null;
  // ⚠️ `p.team` IS THE FIELD NOTHING HAS EVER WRITTEN — the same one that made `pay.allocation` draw
  // an empty chart for every company. Read alone it means **every employee is uncharged**, so this
  // alert has been firing "N people are not charged to any project" at companies whose people are
  // fully allocated.
  //
  // The real sources are the ones the allocation view uses: grant personnel, `isLabor` lines, and
  // internal `p.labor`.
  const charged = new Set(rProjects.flatMap(p => [
    ...(p.team || []).map(t => t.employeeId || t.id),
    ...(p.labor || []).map(l => l.employeeId),
    ...(p.lines || []).filter(l => l.isLabor).map(l => l.employeeId),
    ...((p.grant?.categories?.personnel) || []).map(l => l.employeeId),
  ].filter(Boolean)));
  const idle = emp.filter(e => !charged.has(e.id));
  if (!idle.length) return null;
  return {
    id: "unallocated", tone: "info",
    text: `${plural(idle.length, "person is", "people are")} not charged to any project.`,
    action: "Allocate", to: "pay",
  };
};

/** ⚠️ LABOUR HOURS THAT NAME NOBODY, WHICH RECORD NOTHING.
 *
 *  `teamLoad`'s accumulator starts `if (!id || !hrs) return`, so an `isLabor` line with a null
 *  `employeeId` is dropped in silence — it draws no load, charges no capacity, and appears on no
 *  allocation view. Capacity is a question about PEOPLE; a line naming no one cannot answer it.
 *
 *  ⚠️ AND THE DEFAULT IS THE NULL. `laborLine()` in sales.js creates `employeeId: null`, so EVERY line
 *  added through the Projects tab starts invisible and stays that way until somebody picks a name. The
 *  hours are entered, saved, and quietly ignored — the worst shape of all, because the work looks
 *  recorded.
 *
 *  Nothing in the app said so. This is the smallest honest fix: name the hours, say where they went.
 */
const unnamedLabour = (doc, parts) => {
  const rProjects = parts?.rProjects || [];
  if (!rProjects.length) return null;
  let hours = 0, lines = 0;
  for (const p of rProjects) {
    if (p.stage === "prospective" && !p.include) continue;   // proposals aren't commitments yet
    for (const l of (p.lines || [])) {
      if (!l.isLabor || l.employeeId || !clean(l.hours)) continue;
      hours += clean(l.hours); lines += 1;
    }
    for (const l of ((p.grant?.categories?.personnel) || [])) {
      if (l.employeeId) continue;
      const h = sum((l.byPeriod || []).map(b => clean(b?.hrs)));
      if (h > 0) { hours += h; lines += 1; }
    }
  }
  if (!lines) return null;
  return {
    id: "unnamed-labour", tone: "warn",
    text: `${plural(lines, "labour line", "labour lines")} totalling ${Math.round(hours).toLocaleString()} hours ${lines === 1 ? "names" : "name"} nobody, so ${lines === 1 ? "it charges" : "they charge"} no capacity.`,
    action: "Assign", to: "proj",
  };
};

const aheadOfPace = (doc, parts) => {
  const worst = (parts?.rProjects || [])
    .filter(p => p.stage !== "prospective" && clean(p.budget) > 0)
    .map(p => {
      const spent = clean(spentToDate(p.actuals)) / clean(p.budget);
      const elapsed = clean(p.elapsedPct);
      return { name: p.name, spent, elapsed, gap: spent - elapsed };
    })
    .filter(p => p.gap > 0.15)
    .sort((a, b) => b.gap - a.gap)[0];
  if (!worst) return null;
  return {
    id: "pace", tone: "bad",
    text: `${worst.name} is ${pct(worst.spent)} spent with ${pct(worst.elapsed)} of its period elapsed.`,
    action: "Open it", to: "proj",
  };
};

const overspent = (doc, parts) => {
  const over = (parts?.rProjects || [])
    .filter(p => clean(p.budget) > 0 && clean(spentToDate(p.actuals)) > clean(p.budget));
  if (!over.length) return null;
  return {
    id: "overspent", tone: "bad",
    text: `${plural(over.length, "project has", "projects have")} spent more than their budget.`,
    action: "Review", to: "proj",
  };
};

const forecastHot = (doc, parts) => {
  const hist = (doc.history || []).slice(-3);
  if (hist.length < 3) return null;
  const forecast = sum((parts?.salesLines || []).flatMap(l => (l.amounts || []).slice(0, 3)));
  if (forecast < 1) return null;
  const booked = sum(hist.map(h => sum((h.lines || []).filter(l => !isCost(l)).map(lineAmount))));
  const gap = (booked - forecast) / forecast;
  if (gap > -0.15) return null;
  return {
    id: "forecast", tone: "warn",
    text: `Bookings have run ${pct(Math.abs(gap))} below forecast for three months. ` +
          "The runway above is longer than the bank.",
    action: "Re-base the forecast", to: "sales",
  };
};

const slipRisk = (doc, parts) => {
  const rounds = (doc.rounds || []).filter(r => clean(r.amount) > 0 && r.status !== "closed");
  if (!rounds.length) return null;
  const z = zeroInfo(rowsOf(doc, parts), doc.startY, doc.startM);
  // ⚠️ `closeMonth`, NOT `closeM`. `capital.js` uses `closeMonth` fourteen times and every document in
  // this codebase writes it — **this line read a field no round has ever had.** `clean(undefined)` is
  // 0, `Math.min` over zeros is 0, so the guard below compared against the wrong number rather than
  // failing loudly.
  //
  // I chased this from the other end first and renamed the field in four demo companies to match the
  // reader. **That made the reader work and broke the cash injection**, because `capital.js` then saw
  // no close month at all — the round money landed at a clamped month instead of before the model
  // started, and two companies went cash-positive. **The single outlier was the thing to fix.**
  const soonest = Math.min(...rounds.map(r => clean(r.closeMonth)));
  if (!z || z.months > soonest + 3) return null;
  return {
    id: "slip", tone: "bad",
    text: `A three-month slip on the round would put you out of cash before it closes.`,
    action: "Model a bridge", to: "inv",
  };
};

const preRaiseUnreachable = (doc) => {
  const equity = (doc.rounds || []).filter(r => r.kind === "equity" && r.status !== "closed");
  const pre = equity.flatMap(r => (r.goals || []).filter(g => g.phase !== "post"));
  if (!pre.length) return null;

  // Against the money already in hand: the round cannot fund the proof the round depends on.
  const bare = { ...doc, rounds: [] };
  const toggles = { committed: true, expected: false, speculative: false, financing: false };
  let z = null;
  try {
    z = zeroInfo(buildProjection(buildModelFromDoc({ ...bare, settings: { ...(doc.settings || {}), toggles } }),
                                 toggles), doc.startY, doc.startM);
  } catch { return null; }
  if (!z) return null;

  const past = pre.filter(g => clean(g.dueMonth) > z.months).length;
  if (!past) return null;
  return {
    id: "pre-raise", tone: "bad",
    text: `${past} of ${plural(pre.length, "pre-raise goal", "pre-raise goals")} fall after the cash ` +
          "runs out. The round cannot fund the evidence the round depends on.",
    action: "Re-plan", to: "inv",
  };
};

const misfiledGoal = (doc) => {
  const equity = (doc.rounds || []).filter(r => r.kind === "equity" && r.status !== "closed");
  for (const r of equity) {
    // A pre-raise goal after the close cannot gate a round that will already have happened. Until the
    // phase existed this looked identical to a post-raise goal.
    const bad = (r.goals || []).filter(g => g.phase !== "post" && clean(g.dueMonth) > clean(r.closeMonth));
    if (bad.length) {
      return {
        id: "misfiled", tone: "warn",
        text: `${plural(bad.length, "pre-raise goal is", "pre-raise goals are")} due after ` +
              `${r.name || "the round"} closes, so ${bad.length === 1 ? "it cannot" : "they cannot"} ` +
              "gate it.",
        action: "Move to post-raise", to: "inv",
      };
    }
  }
  return null;
};

const covenant = (doc, parts) => {
  try {
    const breach = covenantBreach(doc, rowsOf(doc, parts));
    if (!breach || breach.monthsAway == null || breach.monthsAway > 12) return null;
    return {
      id: "covenant", tone: "warn",
      text: `A covenant breaches in about ${plural(Math.round(breach.monthsAway), "month", "months")}.`,
      action: "See covenants", to: "inv",
    };
  } catch { return null; }
};

const staleLedger = (doc) => {
  const hist = doc.history || [];
  if (!hist.length) return null;
  const last = doc.lastImportAt || doc.updatedAt;
  if (!last) return null;
  const days = (Date.now() - new Date(last).getTime()) / 86400000;
  if (!Number.isFinite(days) || days < 45) return null;
  return {
    id: "stale", tone: "warn",
    text: `The ledger has not been updated in ${Math.round(days)} days, so recent months are forecast ` +
          "rather than recorded.",
    action: "Import", to: "hist",
  };
};

const noHistory = (doc) => {
  if ((doc.history || []).length) return null;
  if (!(doc.employees || []).length && !(doc.lines || []).length) return null;
  return {
    id: "no-history", tone: "info",
    text: "No spend history yet, so the model has nothing to check itself against.",
    action: "Import", to: "hist",
  };
};

// ---- which rules run on which tab ---------------------------------------------
// A rule appears where somebody can DO the thing. `unmapped` is a history problem and shows on
// History; it also shows on Cash flow, because that is where its effect is felt.

const RULES = {
  flow: [overPlan, unmapped, noHistory],
  pay: [hiresAhead, unallocated, unnamedLabour],
  proj: [aheadOfPace, overspent, unallocated, unnamedLabour],
  sales: [forecastHot, noHistory],
  inv: [preRaiseUnreachable, slipRisk, misfiledGoal, covenant],
  hist: [overPlan, staleLedger, unmapped, unresolved],
  dash: [overPlan, hiresAhead, slipRisk],
};

const ORDER = { bad: 0, warn: 1, info: 2 };

/** Up to two, worst first, never throwing.
 *
 *  Never throwing matters as much here as it does for the charts: these read optional fields off a
 *  document somebody is midway through editing, and a rule that throws would take its whole tab down
 *  over an advisory message.
 */
export function alertsFor(tab, doc, parts, limit = 2) {
  const rules = RULES[tab] || [];
  const out = [];
  for (const rule of rules) {
    try {
      const a = rule(doc || {}, parts || {});
      if (a && !out.some(x => x.id === a.id)) out.push(a);
    } catch { /* an advisory that cannot be computed is simply not shown */ }
  }
  return out.sort((a, b) => (ORDER[a.tone] ?? 3) - (ORDER[b.tone] ?? 3)).slice(0, limit);
}

/** Everything, for a test or a diagnostic. Not for a screen. */
export const ALL_RULES = Object.freeze(RULES);
