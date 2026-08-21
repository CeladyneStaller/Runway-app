// What each tab's overview chart shows, as data.
//
// PURE, AND DERIVED FROM THE ENGINE. Every chart here is a function of the document and the model parts
// the app has already built — no new storage, no new collection, and nothing recomputed that the engine
// already knows. A chart that needed its own projection would be a second answer to "when do we run
// out", and this product exists to give one.
//
// ONE SPEC FORMAT, five shapes. Eighteen bespoke SVG components would be eighteen places for an axis to
// drift; a normalised spec means the renderer is small and the charts are mostly description.
//
//   { kind, x, series, band?, markers?, refLine?, format, note?, empty? }
//
// `empty` is a SENTENCE, not a flag. A chart with nothing to draw should say what is missing — "no
// spend history yet" — rather than render an empty box that looks like a bug.

import { buildProjection, zeroInfo, solvency, anchorToActuals, forecastFrom, balanceAtDate } from "./projection.js";
import { accruedCostShare, outstandingDebt, windDownCost } from "./commitments.js";
import { confidenceBand } from "./band.js";
import { buildModelFromDoc } from "./buildmodel.js";
import { monthTotal, monthRevenue, isCost, lineAmount, lineCode, resolveLine, OVERHEAD } from "./coding.js";
import { instConf, roundMS } from "./capital.js";
import { teamLoad } from "./projects.js";
import { HRS_YR } from "./payroll.js";
import { commitmentPressure } from "./commitments.js";
import { spentToDate } from "./summary.js";
import { saasSeries } from "./saas.js";
import { HORIZON, monthLabel } from "./time.js";

const MONTHS_SHOWN = 18;

/** How many months every chart draws.
 *
 *  ⚠️ THE SETTING PROPAGATES; THE FIT DOES NOT. `RunwayChart` has two different windows and only one of
 *  them is shareable:
 *
 *    - an explicit horizon from the dashboard options — "show me 24 months" — which is a statement
 *      about how far ahead somebody wants to look, and is just as true of the payroll chart;
 *    - an ADAPTIVE fit to the crossing and the last milestone, which is meaningful ONLY on a chart that
 *      draws a crossing. **Applying it elsewhere would size a headcount chart by when the money runs
 *      out**, which is a coincidence rather than a reason.
 *
 *  So this reads the setting and falls back to 18 — it never fits.
 */
/** The x-axis window, as ONE function.
 *
 *  ⚠️ `RunwayChart` HAD ITS OWN AND THE ENGINE HAD ANOTHER. The dashboard fitted its window to the
 *  crossing and the last milestone; every other chart used a flat 18. On the canary that is 12 months
 *  against 18 — so switching tabs changed the horizon under the reader, and two charts whose VALUES now
 *  agree at every shared month still disagreed about how much of the future they were showing.
 *
 *  The dashboard's rule wins because it is the one people check against, and because it is the better
 *  rule: a window that ends two months after the crossing shows the thing you opened the chart for.
 *
 *  Pure, and takes what it needs explicitly, so `RunwayChart` can call it with the values it already
 *  has in hand rather than rebuilding a projection to ask the engine.
 */
export const chartWindow = ({ rowCount, zeroUpT = 0, lastMilestoneT = 0, override = null }) => (
  Number.isFinite(override) && override >= 6
    ? Math.min(rowCount, Math.min(36, Math.round(override)))
    : Math.min(rowCount, Math.ceil(Math.max((zeroUpT || 0) + 2, (lastMilestoneT || 0) + 2, 12)))
);

// Deriving the window from a bare doc costs a projection, and `monthsShown` is called several times per
// chart build. Cached on the doc object itself: documents are replaced rather than mutated here, so a
// stale entry cannot outlive the doc it describes, and a doc that IS mutated in place simply misses the
// benefit rather than reading a wrong number... except for `chartHorizon`, which is part of the key.
const _winCache = new WeakMap();

/** The window for a document, matching what `RunwayChart` will draw. */
export const monthsShown = (doc) => {
  const override = Number(doc?.settings?.chartHorizon);
  if (!doc || typeof doc !== "object") return MONTHS_SHOWN;
  const key = Number.isFinite(override) ? `h${override}` : "fit";
  const hit = _winCache.get(doc);
  if (hit && hit.key === key) return hit.v;

  let v;
  try {
    const model = buildModelFromDoc(doc);
    const T = doc.settings?.toggles || {};
    // ⚠️ ANCHORED, BECAUSE THE DASHBOARD DRAWS ANCHORED CURVES. `RunwayChart` fits its window to the
    // UPSIDE crossing, and the rows it is handed have already been anchored to recorded cash. Deriving
    // the same window from the RAW projection gives a different crossing the moment a document has
    // actuals — and it did: adding four recorded months to the demos made this read 18 where the chart
    // drew 19. Invisible until then, because no fixture had a single recorded month.
    const anchor = (rs) => anchorToActuals(rs, doc.cashActuals || {}, doc.settings?.anchorActuals !== false);
    const rows = anchor(buildProjection(model, T));
    // The UPSIDE crossing, exactly as the dashboard uses: the window has to contain the date the
    // company is working toward, not just the one it is running from.
    const up = anchor(buildProjection(model, { ...T, speculative: true }));
    const zeroUp = zeroInfo(up, doc.startY, doc.startM, forecastFrom(doc));
    const ms = [...(doc.milestones || []), ...roundMS(doc.rounds, doc.startY, doc.startM)];
    const lastMsT = Math.max(0, ...ms.map((m) => {
      const b = balanceAtDate(rows, doc.startY, doc.startM, m.y, m.m, m.day);
      return b ? b.t : 0;
    }));
    v = chartWindow({ rowCount: up.length, zeroUpT: zeroUp?.t || 0, lastMilestoneT: lastMsT, override });
  } catch {
    // A window is not worth throwing over. Fall back to the flat default rather than taking a chart
    // down because a milestone had a bad date.
    v = Number.isFinite(override) && override >= 6 ? Math.min(36, Math.round(override)) : MONTHS_SHOWN;
  }
  _winCache.set(doc, { key, v });
  return v;
};

const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
const clean = (n) => (Number.isFinite(n) ? n : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** How far through its period a project is, when it does not carry the figure itself. */
const elapsedShare = (p, doc) => {
  const start = clean(p.startM), end = clean(p.endM ?? p.months);
  if (!(end > start)) return 0;
  const now = clean(doc?.nowM ?? 0);
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
};

/** Ticks for a month-indexed axis: one per month, LABELLED AT CALENDAR QUARTER STARTS.
 *
 *  Standard quarters — Jan, Apr, Jul, Oct — not quarters counted from whenever the model happens to
 *  begin. A company's own fiscal year may differ, but nobody reads "Q2" as "the second three months
 *  after my start date", and a chart that means something private by a public word is worse than one
 *  with no labels at all.
 *
 *  EVERY MONTH GETS A TICK, only quarters get a name. Twelve month names on a 670-pixel axis is a
 *  smear at any font size that fits; the ticks keep the resolution and lose the noise.
 */
export function axisTicks(doc, nIn = null) {
  const n = nIn ?? monthsShown(doc);
  const y0 = doc?.startY ?? new Date().getFullYear();
  const m0 = doc?.startM ?? 0;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y0, m0 + i, 1);
    const m = d.getMonth();
    const quarter = m % 3 === 0;
    return {
      i,
      quarter,
      label: quarter ? d.toLocaleString("en-US", { month: "short", year: "2-digit" }) : null,
      q: quarter ? `Q${Math.floor(m / 3) + 1}` : null,
    };
  });
}

/** A real date for a month offset, and the day within it. */
const dateAt = (doc, i, day = 1) =>
  new Date(doc?.startY ?? new Date().getFullYear(), (doc?.startM ?? 0) + i, day);

const shortDate = (d) =>
  d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "2-digit" })
    : "";

const DAY = 86400000;

/** Month labels from the document's start, for the horizon a chart shows. */
// EXPORTED for `buildcustom.js`, which must return the same x array every curated chart returns —
// a second implementation would be a second answer to where a month sits.
export const months = (doc, n = null) =>
  Array.from({ length: n ?? monthsShown(doc) },
             (_, i) => monthLabel(doc.startY ?? new Date().getFullYear(), doc.startM ?? 0, i));

/** The projected balance per month, which several charts need and none should recompute. */
function balances(doc, parts) {
  return projectionRows(doc, parts).map(r => clean(r.end));
}

/** The projection, from whatever the caller had.
 *
 *  `buildModelParts` does NOT return rows — it returns the compiled line sets and the model, and the
 *  app runs `buildProjection` separately. Assuming `parts.rows` made five charts fall back to "no
 *  projection yet" against a document with a perfectly good projection. */
function projectionRows(doc, parts) {
  if (Array.isArray(parts?.rows) && parts.rows.length) return parts.rows;
  try {
    return buildProjection(parts?.model || buildModelFromDoc(doc), doc.settings?.toggles || {}) || [];
  } catch { return []; }
}

// ================================================================== CASH FLOW ==

const flowRunway = (doc) => {
  // ⚠️ THIS CHART SHOWS KNOWN MONEY. THE DASHBOARD PREDICTS RUNWAY. They are different questions and
  // the split is deliberate.
  //
  // The line used to be `band.expected.rows` — the band's own expected TIER, always committed+expected
  // whatever the user had switched on, while the dashboard's line followed `doc.settings.toggles`.
  // Turn speculative on and the dashboard moved $214,000 and this chart did not. Worse, `solvency()`
  // below was handed a THIRD projection, so the hole was computed from one curve and drawn under
  // another: with speculative on the line dipped underwater and no hole was shaded at all.
  //
  // Now: ONE committed-only projection feeds the line, the marker and the hole.
  //
  // ⚠️ `financing: true`, ALWAYS. The financing gate is checked BEFORE the confidence tier, so with the
  // toggle off a CLOSED round vanishes — and closed money is banked money. Toggles are for scenarios;
  // a chart that means "known cash" is not a scenario. The tier does the filtering: `INST_CONF` already
  // maps closed -> committed and term-sheet -> expected, so a signed round is in and a term sheet is
  // not, with no extra rule here.
  const committedToggles = { committed: true, expected: false, speculative: false, financing: true };
  const model = buildModelFromDoc(doc);
  const from = forecastFrom(doc);
  const anchorRows = (rs) => anchorToActuals(rs, doc.cashActuals || {}, doc.settings?.anchorActuals !== false);
  const line = anchorRows(buildProjection(model, committedToggles));

  // The band's ceiling is "expected lands AND you underspend"; its floor is "committed only AND you
  // overspend". Speculative is excluded outright — it is not known money, and this chart is about
  // known money.
  const band = confidenceBand(doc, HORIZON,
    { committed: true, expected: true, speculative: false },
    { cashActuals: doc.cashActuals, anchorActuals: doc.settings?.anchorActuals !== false, from });

  // ⚠️ `r.start`, NOT `r.end`. Each row carries both, and **`end` of one month IS `start` of the
  // next** — so plotting `end` under a month's label shows that month's CLOSING balance where the
  // company view shows its opening one. Every value appeared one month early.
  //
  // `RunwayChart` plots `r.start` and is what the company dashboard uses, so this was the copy that
  // disagreed. **Two renderers of the same number is how they drift; the fix is to agree with the one
  // people check against.**
  const shown = monthsShown(doc);
  const take = (rows) => (rows || []).slice(0, shown).map(r => clean(r.start));
  const mid = take(line);
  if (!mid.length) return { empty: "No projection yet — add cash and a line or two." };

  // ⚠️ `zeroFromNow`, NOT `zero`. `zero` counts months from the MODEL START and the label said "mo" as
  // though it counted from today. On the canary those were 3.9 and 3.8 — near enough to look right,
  // which is exactly why it survived. The marker's X stays in model-start months because that is what
  // this axis is; only the LABEL changes.
  const zAt = zeroInfo(line, doc.startY, doc.startM, from);
  let solv = null;
  try {
    // ⚠️ BOUNDED AT BOTH ENDS. `from` — a hole already crossed is not a hole ahead. `shown - 1` — on a
    // committed-only line the deficit is unbounded, so `deepest` drifted to the horizon and reported a
    // bridge for a month this chart does not draw ($3,230,627 at month 36 against an 18-month plot).
    solv = solvency(line, doc.startY, doc.startM, from, Math.max(0, shown - 1));
  } catch { solv = null; }
  return {
    kind: "lines",
    x: months(doc), ticks: axisTicks(doc),
    band: { lo: take(band.floor?.rows), hi: take(band.ceiling?.rows) },
    series: [{ id: "balance", label: "Committed cash", values: mid, tone: "signal" }],
    refLine: { y: 0 },
    // ⚠️ NEVER THE WORD "RUNWAY". That word means the dashboard's number, which includes expected
    // revenue and is a LATER date. Two tabs showing two dates is the design; two tabs showing two
    // different numbers both called runway is the bug this replaced.
    basis: "Committed cash only — expected revenue is the upper band, not the line.",
    markers: zAt && zAt.t < shown
      ? [{ x: zAt.t, label: `committed cash out · ${zAt.fromNow.toFixed(1)} mo`, tone: "danger" }] : [],
    format: "money",
    // THE HOLE, so a recovery stops reading as good news. The line already dips; naming the gap is
    // what stops somebody seeing the far side and thinking the money is there.
    // COMMITMENTS AS A SECOND LINE. Dashed, because it is not a forecast of cash — it is cash less what
    // has already been promised, and the point is where it crosses zero BEFORE the solid line does.
    committed: (() => {
      try {
        const pr = commitmentPressure(doc, buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {}));
        if (!pr) return null;
        const byMonth = new Map();
        for (const c of pr.rows) byMonth.set(c.payMonth, (byMonth.get(c.payMonth) || 0) + c.amount);
        let owed = 0;
        // The chart's own rows, not `parts` — this builder does not take them, and reaching for a name
        // that is not in scope is how the first attempt failed to compile rather than failing quietly.
        const own = buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {});
        const values = own.map((r, m) => { owed += byMonth.get(m) || 0; return r.end - owed; });
        return values.length ? { values, coveredMonths: pr.coveredMonths, unpaid: pr.unpaid } : null;
      } catch { return null; }
    })(),
    underwater: solv ? {
      fromT: solv.zeroT, toT: solv.recoversT,
      deepest: solv.deepest, days: solv.daysUnderwater,
    } : null,
    // THE POINT OF THIS CHART. A single line says 5.6 months and invites a plan built on it; the band
    // says where the answer actually sits, using how wrong past forecasts have been.
    note: Number.isFinite(band.floor?.zero) && band.ceiling?.zeroNull
      ? `Between ${band.floor.zero.toFixed(1)} months and beyond the horizon.`
      : Number.isFinite(band.floor?.zero) && Number.isFinite(band.ceiling?.zero)
        ? `Between ${band.floor.zero.toFixed(1)} and ${band.ceiling.zero.toFixed(1)} months.`
        : null,
  };
};

const flowComposition = (doc, parts) => {
  const payroll = (parts?.employeeLines || []).length;
  const rows = projectionRows(doc, parts);
  if (!rows.length) return { empty: "No projection yet." };

  const pay = rows.slice(0, monthsShown(doc)).map((_, i) =>
    sum((parts?.employeeLines || []).map(l => clean(l.amounts?.[i]))));
  const all = rows.slice(0, monthsShown(doc)).map(r => Math.max(0, -clean(r.net) + clean(r.rev || 0)));
  const other = all.map((v, i) => Math.max(0, v - pay[i]));

  return {
    kind: "stack",
    x: months(doc), ticks: axisTicks(doc),
    series: [
      { id: "payroll", label: "Payroll", values: pay, tone: "signal" },
      { id: "other", label: "Everything else", values: other, tone: "muted" },
    ],
    format: "money",
    note: payroll ? null : "No employees yet, so all of this is other spend.",
  };
};

const flowInOut = (doc, parts) => {
  const rows = projectionRows(doc, parts).slice(0, monthsShown(doc));
  if (!rows.length) return { empty: "No projection yet." };
  return {
    kind: "bars",
    x: months(doc), ticks: axisTicks(doc),
    series: [
      // ⚠️ `r.rev` / `r.cost`, NOT `r.in` / `r.out`. `buildProjection` pushes
      // `{ m, start, rev, cost, net, end, inNonGrant }` — there has never been an `in` or an `out`, so
      // `clean(undefined)` returned 0 and BOTH SERIES of this chart drew a flat nothing.
      { id: "in", label: "Money in", values: rows.map(r => clean(r.rev)), tone: "signal" },
      { id: "out", label: "Money out", values: rows.map(r => -Math.abs(clean(r.cost))), tone: "danger" },
    ],
    format: "money",
    // Grant receipts are lumpy and a net line averages them away; this is where a month with nothing
    // coming in becomes visible.
    note: "Lumpy months show here that a net line would smooth away.",
  };
};

// ==================================================================== PAYROLL ==

const payTimeline = (doc, parts) => {
  const lines = parts?.employeeLines || [];
  if (!lines.length) return { empty: "No employees yet." };
  const values = Array.from({ length: monthsShown(doc) }, (_, i) =>
    sum(lines.map(l => clean(l.amounts?.[i]))));

  // Each step is somebody starting. Marked so a hire is visible before it lands rather than after it
  // shows up in the ledger.
  const markers = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1] * 1.04 && values[i] - values[i - 1] > 500) {
      markers.push({ x: i, label: "starts", tone: "caution" });
    }
  }

  return {
    kind: "stack",
    x: months(doc), ticks: axisTicks(doc),
    series: [{ id: "payroll", label: "Payroll", values, tone: "signal" }],
    markers: markers.slice(0, 4),
    format: "money",
  };
};

const payHeadcount = (doc, parts) => {
  const emp = doc.employees || [];
  if (!emp.length) return { empty: "No employees yet." };
  const lines = parts?.employeeLines || [];

  const heads = Array.from({ length: monthsShown(doc) }, (_, i) =>
    lines.filter(l => clean(l.amounts?.[i]) > 0).length);
  const each = Array.from({ length: monthsShown(doc) }, (_, i) => {
    const n = heads[i];
    return n ? sum(lines.map(l => clean(l.amounts?.[i]))) / n : 0;
  });

  return {
    kind: "lines",
    x: months(doc), ticks: axisTicks(doc),
    series: [
      { id: "heads", label: "People", values: heads, tone: "signal", axis: "right" },
      { id: "each", label: "Cost each", values: each, tone: "muted", dashed: true },
    ],
    format: "money",
    note: "Whether the team is getting cheaper or more expensive per person as it grows.",
  };
};

const payAllocation = (doc, parts) => {
  const emp = doc.employees || [];
  if (!emp.length) return { empty: "No employees yet." };
  const rProjects = parts?.rProjects || [];
  if (!rProjects.length) return { empty: "No projects yet, so nobody is charged anywhere." };

  // Each person's share of project effort, from the rates the engine already resolved. What is left is
  // time no project is paying for — which is the number worth seeing.
  // ⚠️ THIS READ `p.team[].fte`, A FIELD NOTHING HAS EVER WRITTEN. Only two files mention it and both
  // only READ it — so this chart has answered "No project allocations recorded yet" for every company
  // since it was built, no matter how much allocation existed.
  //
  // **A FOURTH allocation mechanism**, after `teamLoad` (hours), the `allocPct` measures (money) and
  // the `projectId` lines. `teamLoad` is the one the Allocation sub-tab uses and the one that now knows
  // about grants, internal labor and `p.lines` alike — so this chart uses it too, and the tab and its
  // chart can no longer disagree.
  const load = teamLoad(rProjects, doc?.settings?.toggles || undefined, doc);
  const cap = HRS_YR / 12;
  const rows = emp.map(e => {
    const rec = load[e.id];
    const byProject = new Map();
    for (const it of rec?.items || []) {
      const months = Math.max(1, (it.end ?? 0) - (it.start ?? 0) + 1);
      const perMonth = (it.hours || 0) / months;
      byProject.set(it.project, (byProject.get(it.project) || 0) + perMonth);
    }
    const per = [...byProject.entries()]
      .map(([label, hrs]) => ({ id: label, label, value: clean(hrs / cap) }))
      .filter(x => x.value > 0);
    const used = sum(per.map(x => x.value));
    return { id: e.id, label: e.name || e.role || "Unnamed", parts: per,
             // Somebody over 100% has no unfunded time — clamping at zero rather than going negative,
             // because the over-allocation is reported as its own number on the tab.
             unfunded: Math.max(0, 1 - used) };
  });

  if (!rows.some(r => r.parts.length)) {
    return { empty: "No project allocations recorded yet." };
  }

  return {
    kind: "hbars",
    rows: rows.map(r => ({
      label: r.label,
      segments: [...r.parts.map(p => ({ label: p.label, value: p.value, tone: "signal" })),
                 ...(r.unfunded > 0.01
                   ? [{ label: "Not charged", value: r.unfunded, tone: "danger" }] : [])],
    })),
    legend: [{ label: "Charged to a project", tone: "signal" },
             { label: "Not charged", tone: "danger" }],
    format: "percent",
    note: "Time in red is not charged to any project.",
  };
};

// =================================================================== PROJECTS ==

const projPace = (doc, parts) => {
  const rProjects = (parts?.rProjects || []).filter(p => p.stage !== "prospective");
  if (!rProjects.length) return { empty: "No active projects yet." };

  // Cumulative spend against the diagonal it would follow burning evenly. Above the line is ahead of
  // pace — the question a program officer asks first, and what `budgetTag` already knows in words.
  // `spentToDate` takes the project's ACTUALS map, not the project — and `budgetTag` takes
  // (budget, actuals, plannedThrough). Checked rather than assumed, because a chart quietly summing
  // the wrong object would produce a plausible line nobody could tell was wrong.
  const rows = rProjects.slice(0, 6).map(p => {
    const budget = clean(p.budget);
    const spent = clean(spentToDate(p.actuals));
    const elapsedPct = clean(p.elapsedPct ?? elapsedShare(p, doc));
    const spentPct = budget ? spent / budget : 0;
    return {
      id: p.id, label: p.name, spent: spentPct, elapsed: elapsedPct,
      tone: spentPct > elapsedPct + 0.12 ? "danger"
          : spentPct > elapsedPct + 0.04 ? "caution" : "signal",
    };
  });

  return {
    kind: "pace",
    rows,
    legend: [{ label: "On pace", tone: "signal" }, { label: "Slightly ahead", tone: "caution" },
             { label: "Ahead of pace", tone: "danger" }],
    format: "percent",
    note: "Above the diagonal is ahead of pace.",
  };
};

const projBudget = (doc, parts) => {
  const rProjects = parts?.rProjects || [];
  if (!rProjects.length) return { empty: "No projects yet." };
  return {
    kind: "hbars",
    rows: rProjects.slice(0, 8).map(p => {
      const budget = clean(p.budget);
      const spent = Math.min(budget, clean(spentToDate(p.actuals)));
      const share = budget ? spent / budget : 0;
      return {
        label: p.name,
        segments: [
          { label: "Spent", value: share,
            tone: share > 0.85 ? "danger" : share > 0.6 ? "caution" : "signal" },
          { label: "Left", value: Math.max(0, 1 - share), tone: "line" },
        ],
      };
    }),
    legend: [{ label: "Spent", tone: "signal" }, { label: "Unspent", tone: "line" }],
    format: "percent",
    note: "How much of each award is still unspent.",
  };
};

const projLoad = (doc, parts) => {
  const rProjects = parts?.rProjects || [];
  if (!rProjects.length) return { empty: "No projects yet." };

  // ⚠️ `p.team` AGAIN — THE FIELD NOTHING HAS EVER WRITTEN. `payAllocation` was moved off it and
  // `alerts.js` carries the same warning, but this chart was left reading it, so "Team load by project"
  // has drawn "No team allocated to any project yet" for every company since it was built, however much
  // allocation existed. Three readers of a field with no writer; two were fixed and one was missed.
  //
  // `teamLoad` is the mechanism that actually knows about allocation — hours, from
  // `grant.categories.personnel` for grants and `p.lines` with `isLabor` for everything else — and it is
  // what the Allocation sub-tab and `payAllocation` both use. Reading it here means the tab and its
  // chart can no longer disagree.
  //
  // Converted to FTE so the "team size" reference line means what it says: hours per month over a
  // full-time month.
  const load = teamLoad(rProjects, doc?.settings?.toggles || undefined, doc);
  const cap = HRS_YR / 12;
  const byProject = new Map();
  for (const rec of Object.values(load || {})) {
    for (const it of rec?.items || []) {
      const start = clean(it.start), end = clean(it.end ?? it.start);
      const months = Math.max(1, end - start + 1);
      const perMonth = clean(it.hours) / months;
      if (!byProject.has(it.project)) byProject.set(it.project, {});
      const bucket = byProject.get(it.project);
      for (let m = start; m <= end; m++) bucket[m] = (bucket[m] || 0) + perMonth;
    }
  }

  const perProject = [...byProject.entries()].slice(0, 6).map(([name, bucket], i) => ({
    id: `pl${i}`, label: name, tone: "signal",
    values: Array.from({ length: monthsShown(doc) }, (_, m) => clean(bucket[m]) / cap),
  }));

  if (!perProject.some(s => s.values.some(v => v > 0))) {
    return { empty: "No team allocated to any project yet." };
  }

  return {
    kind: "stack",
    x: months(doc), ticks: axisTicks(doc),
    series: perProject,
    refLine: { y: (doc.employees || []).length, label: "team size" },
    format: "count",
    // Catches the month three grants all want the same person — a scheduling problem that surfaces as
    // a spending problem six months later.
    note: "Above the line is more effort committed than people to do it.",
  };
};

// ====================================================================== SALES ==

const salesForecast = (doc, parts) => {
  const saas = doc.saas || [];
  const hist = doc.history || [];
  if (!saas.length) return { empty: "No revenue lines yet." };

  const forecast = (parts?.salesLines || []).length
    ? Array.from({ length: monthsShown(doc) }, (_, i) =>
        sum((parts.salesLines || []).map(l => clean(l.amounts?.[i]))))
    : [];
  const booked = hist.slice(-monthsShown(doc)).map(h => clean(monthRevenue(h)));
  if (!booked.length) return { empty: "No booked revenue recorded yet." };

  return {
    kind: "lines",
    x: months(doc), ticks: axisTicks(doc),
    series: [
      { id: "forecast", label: "Forecast", values: forecast, tone: "muted", dashed: true },
      { id: "booked", label: "Booked", values: booked, tone: "signal" },
    ],
    format: "money",
    note: "A forecast running ahead of bookings is a runway longer on screen than in the bank.",
  };
};

const salesMrr = (doc) => {
  const saas = doc.saas || [];
  if (!saas.length) return { empty: "No subscription revenue yet." };
  // `saasSeries` gives the per-month curve; `saasMRR` is today's figure only. Using the latter in a
  // loop would have drawn a flat line and called it growth.
  const values = Array.from({ length: monthsShown(doc) }, (_, i) =>
    sum(saas.map(x => clean(saasSeries(x, monthsShown(doc)).find(pt => pt.month === i)?.mrr))));
  if (!values.some(v => v > 0)) return { empty: "No subscription revenue yet." };
  return {
    kind: "stack",
    x: months(doc), ticks: axisTicks(doc),
    series: [{ id: "mrr", label: "MRR", values, tone: "signal" }],
    format: "money",
  };
};

const salesCover = (doc, parts) => {
  const rows = projectionRows(doc, parts).slice(0, monthsShown(doc));
  if (!rows.length) return { empty: "No projection yet." };
  const values = rows.map(r => {
    // ⚠️ `r.cost` / `r.rev`. This read `r.out` and `r.in`, which `buildProjection` has never produced —
    // so the denominator was 0, the guard returned 0, and "Revenue as a share of burn" was a flat line
    // at zero. It is the DEFAULT chart on the Sales tab, chosen precisely because it draws for
    // everybody, and it drew nothing for anybody.
    const out = Math.abs(clean(r.cost));
    return out ? Math.min(1.5, clean(r.rev) / out) : 0;
  });
  return {
    kind: "stack",
    x: months(doc), ticks: axisTicks(doc),
    series: [{ id: "cover", label: "Revenue ÷ burn", values, tone: "signal" }],
    refLine: { y: 1, label: "breakeven" },
    format: "ratio",
    note: "How close the business is to paying for itself.",
  };
};

// ================================================================= INVESTMENT ==

const invSlip = (doc) => {
  const rounds = (doc.rounds || []).filter(r => r.amount > 0);
  if (!rounds.length) return { empty: "No rounds modelled yet." };

  const onPlan = balances(doc).slice(0, monthsShown(doc));

  // The same model with every round three months later. Nobody builds this case deliberately, which is
  // exactly why it is worth drawing: the gap is the size of the bridge a late term sheet needs.
  const slipped = {
    ...doc,
    rounds: rounds.map(r => ({ ...r, closeM: clean(r.closeM) + 3 })),
  };
  const late = balances(slipped).slice(0, monthsShown(doc));

  const z = zeroInfo(buildProjection(buildModelFromDoc(slipped), doc.settings?.toggles || {}),
                     doc.startY, doc.startM);

  return {
    kind: "lines",
    x: months(doc), ticks: axisTicks(doc),
    series: [
      { id: "plan", label: "On plan", values: onPlan, tone: "signal" },
      { id: "late", label: "Three months late", values: late, tone: "danger", dashed: true },
    ],
    refLine: { y: 0 },
    markers: z ? [{ x: z.months, label: "out of cash", tone: "danger" }] : [],
    format: "money",
    note: "The gap is the bridge a late close would need.",
  };
};

const invOwnership = (doc) => {
  const rounds = (doc.rounds || []).filter(r => r.amount > 0);
  if (!rounds.length) return { empty: "No rounds modelled yet." };
  let held = 1;
  const rows = rounds.map(r => {
    const post = clean(r.post ?? r.valuation);
    const share = post ? clean(r.amount) / post : 0;
    held = held * (1 - share);
    return { label: r.name || "Round", segments: [
      { label: "Founders", value: held, tone: "signal" },
      { label: "Investors", value: 1 - held, tone: "muted" },
    ] };
  });
  return {
    kind: "hbars", rows, format: "percent",
    legend: [{ label: "Founders", tone: "signal" }, { label: "Investors", tone: "muted" }],
    note: "Founder share after each raise.",
  };
};

/** Goals against the runway that has to survive long enough to hit them.
 *
 *  THE QUESTION THIS SUB-TAB ACTUALLY ASKS. A round is not raised on a date, it is raised on evidence —
 *  "5 kW stack running", "$1m booked" — and the thing worth seeing is whether the money lasts until
 *  that evidence exists. `roundMS` already derives the close date from the round; the goals hang off it
 *  with `dueMonth`, and `Investment.jsx` already flags the ones due AFTER the close as late.
 *
 *  SPECULATIVE, DELIBERATELY. The committed projection assumes the round lands; the whole point here is
 *  the runway you have if it does not, so the toggles are forced to committed-only and the round's own
 *  inflow is excluded. Reading it against the optimistic line would answer a question nobody is asking.
 */
/** Goals against the runway, split by which money pays for them.
 *
 *  A ROUND HAS GOALS POINTING IN BOTH DIRECTIONS and the model treated them as one list, which is why
 *  this chart read oddly before: it measured both against the same runway and flagged the wrong half
 *  as late.
 *
 *    PRE-RAISE   the evidence investors need before they wire — 5 kW stack, $1m booked. Must land
 *                before the close, on the money you ALREADY HAVE. The round cannot fund the proof the
 *                round depends on, so these are measured against the runway with rounds removed.
 *
 *    POST-RAISE  what the money is for — scale to 50 kW, hire twelve. After the close by definition,
 *                and measured against the runway the round CREATES.
 *
 *  So `lateGoals` in the Investment view was exactly backwards for half of them: a post-raise goal
 *  SHOULD be after the close. What is actually wrong is a PRE-RAISE goal filed after it — it cannot
 *  gate a round that will already have happened, and until the phase existed it looked identical to a
 *  post-raise goal.
 */
const invGoals = (doc) => {
  const equity = (doc.rounds || []).filter(r => r.kind === "equity" && r.status !== "closed");
  const goals = equity.flatMap(r => (r.goals || []).map(g => ({ ...g, round: r })));
  if (!goals.length) return { empty: "No goals set against a round yet." };

  // TWO RUNWAYS, and the difference between them is the ROUND — so `financing` has to be ON for the
  // second one. Forcing it off for both produced two identical dates and a chart that silently said
  // the round changes nothing, which is the opposite of what it exists to show.
  // BOTH RUNWAYS GET A FULL SOLVENCY READING, not just a zero date. A goal on the far side of a hole
  // is unreachable however healthy the balance looks on its own day — the same rule the milestones
  // chart follows — and each phase needs the bridge that would close ITS hole.
  const readOf = (d, toggles) => {
    try {
      const doc2 = { ...d, settings: { ...(d.settings || {}), toggles } };
      const rows = buildProjection(buildModelFromDoc(doc2), toggles);
      return {
        zero: zeroInfo(rows, doc2.startY, doc2.startM),
        solv: solvency(rows, doc2.startY, doc2.startM),
      };
    } catch { return { zero: null, solv: null }; }
  };

  // THE ROUND'S OWN CONFIDENCE TIER DECIDES WHICH TOGGLES SHOW IT. A round at `planning` is
  // SPECULATIVE (`INST_CONF`), so a committed-only projection excludes it — and computing the
  // post-close runway that way produced two identical dates and a chart quietly claiming the round
  // changes nothing. The tier the round actually sits in has to be switched on, or this measures the
  // wrong thing and looks like it measured something.
  const tiers = new Set(equity.map(instConf));
  const withRoundToggles = {
    committed: true,
    expected: tiers.has("expected") || tiers.has("speculative"),
    speculative: tiers.has("speculative"),
    financing: true,
  };

  // Pre-raise is always committed-only with the rounds removed: the round cannot fund the proof the
  // round depends on, whatever tier it sits in.
  const preRead = readOf({ ...doc, rounds: [] },
                         { committed: true, expected: false, speculative: false, financing: false });
  // POST-RAISE GOALS ARE MEASURED AGAINST THE FINANCING-INCLUDED SPECULATIVE RUNWAY — the money the
  // round creates is what pays for them, so excluding it would judge them against a runway that was
  // never the plan.
  const postRead = readOf(doc, withRoundToggles);
  const withoutRound = preRead.zero;
  const withRound = postRead.zero;

  const cashOutAt = withoutRound?.date instanceof Date ? withoutRound.date : null;
  const afterRoundAt = withRound?.date instanceof Date ? withRound.date : null;

  const row = (g) => {
    const due = clean(g.dueMonth);
    const closeM = clean(g.round.closeMonth);
    const dueAt = dateAt(doc, due);
    // The close is the END of its month, matching `roundMS` — a round does not close on the 1st.
    const closeAt = dateAt(doc, closeM + 1, 0);
    const phase = g.phase === "post" ? "post" : "pre";
    // EACH PHASE AGAINST ITS OWN PROJECTION. Pre-raise against the money already in hand; post-raise
    // against the financing-included speculative runway, because that is what pays for them.
    const read = phase === "pre" ? preRead : postRead;

    // A NULL DATE MEANS THE CASH NEVER RUNS OUT inside the horizon, which is the opposite of a
    // problem — so nothing is late against it. Treating null as "no answer" and colouring the goal red
    // would report a healthy round as a failing one.
    const against = phase === "pre" ? cashOutAt : afterRoundAt;
    const lateBy = against ? Math.round((dueAt - against) / DAY) : null;

    // STRANDED IS THE REAL TEST, not the date arithmetic. A goal after a hole is unreachable even if
    // its own day looks solvent, and the bridge is the deficit standing between now and it.
    const stranded = !!read.solv?.strandedAt(due);
    const bridge = stranded ? clean(read.solv.bridgeTo(due)) : 0;
    // A POST-RAISE GOAL CAN BE STRANDED BY A PRE-ROUND HOLE, which is a different sentence: the money
    // that pays for it never arrives because the company does not reach the close.
    const beforeClose = dueAt <= closeAt;
    const strandedBeforeRound = stranded && phase === "post" &&
      Number.isFinite(read.solv?.zeroT) && read.solv.zeroT <= clean(g.round.closeMonth);

    return {
      id: g.id, label: g.label || "Goal", kind: g.kind, status: g.status, phase,
      due, close: closeM, round: g.round.name,
      dueAt, dueLabel: shortDate(dueAt), closeAt, closeLabel: shortDate(closeAt),
      beyondCash: stranded || (lateBy != null && lateBy > 0),
      stranded, strandedBeforeRound,
      bridge: bridge > 0 ? bridge : null,
      lateBy: lateBy != null && lateBy > 0 ? lateBy : null,
      // FILED IN THE WRONG PHASE, and the two errors are opposites. A pre-raise goal after the close
      // cannot gate the round; a post-raise goal before it is spending money that has not arrived.
      misfiled: phase === "pre" ? !beforeClose : beforeClose,
    };
  };

  const pre = goals.filter(g => g.phase !== "post").map(row).sort((a, b) => a.due - b.due);
  const post = goals.filter(g => g.phase === "post").map(row).sort((a, b) => a.due - b.due);

  const lastDue = Math.max(0, ...[...pre, ...post].map(r => r.due));
  const span = Math.max(monthsShown(doc), lastDue + 3,
                        Number.isFinite(withRound?.months) ? Math.ceil(withRound.months) + 2 : 0);

  const unreachable = pre.filter(r => r.beyondCash).length;

  return {
    kind: "goals",
    pre, post,
    rows: [...pre, ...post],                       // for anything that wants a flat list
    ticks: axisTicks(doc, span),
    span,
    closeM: pre[0]?.close ?? post[0]?.close ?? null,
    closeLabel: pre[0]?.closeLabel ?? post[0]?.closeLabel ?? "",
    cashOut: withoutRound?.months ?? null,
    cashOutLabel: shortDate(cashOutAt),
    afterRound: withRound?.months ?? null,
    // Said in words rather than left blank: "beyond the horizon" is an answer, an empty date is a bug.
    afterRoundLabel: afterRoundAt ? shortDate(afterRoundAt) : `beyond ${HORIZON} months`,
    afterRoundEndless: !afterRoundAt,
    // MONEY, NOT COUNT. The bridges and balances are currency; `count` would have printed them as
    // `123456.0`. It never showed because the renderer called `money()` directly — a declared field
    // that lies and is ignored is worse than one that is missing, because something will eventually
    // believe it.
    legend: [
      { label: "Within its runway", tone: "signal" },
      { label: "Unreachable without bridging", tone: "danger", ring: true },
      { label: "Filed in the wrong phase", tone: "caution", ring: true },
    ],
    format: "money",
    note: !pre.length
      ? "No pre-raise goals set, so nothing is gating this round."
      : unreachable
        ? `${unreachable} of ${pre.length} pre-raise goals fall after the cash runs out on ` +
          `${shortDate(cashOutAt)}. The round cannot fund the evidence the round depends on.`
        : `All ${pre.length} pre-raise goals land before the cash runs out.`,
    // A round with no post-raise goals is a use of funds nobody has written down. Worth saying, and
    // not the same as having none to show.
    postNote: post.length ? null : "No post-raise goals yet — nothing says what the round buys.",
  };
};

/** Milestones on a calendar, against the cash on the day and the target set for it.
 *
 *  SAME SHAPE AS THE GOALS CHART, DIFFERENT FAILURE MODES. A goal can only be past the cash; a
 *  MILESTONE CARRIES A TARGET, so it can be reached and still fail — the date arrives, the balance is
 *  positive, and it is below what was set for it. The bar chart this replaces could show the balance
 *  and not the shortfall, because the target was not a quantity it knew about.
 *
 *  TWO BANDS, because one half you can move and the other you cannot: dates you set, and dates derived
 *  from the capital stack. `Milestones.jsx` already refuses to edit the second kind, so the split
 *  reflects a rule that exists rather than inventing one.
 *
 *  NOTHING NEW IS COMPUTED. `bal`, `target`, `pass`, `gap` and `date` all arrive in `msWithBal`, which
 *  App assembles because that is where the balances and the round-derived dates are both in hand. A
 *  second definition of a milestone's balance is exactly what moving `msPass`/`msGap` into the engine
 *  was meant to prevent.
 */
const invMilestones = (doc, parts) => {
  const ms = parts?.msWithBal || [];
  if (!ms.length) return { empty: "No critical dates set yet." };

  const rows = parts?.rows || [];
  let zero = null, solv = null;
  try {
    zero = zeroInfo(rows, doc.startY, doc.startM);
    solv = solvency(rows, doc.startY, doc.startM);
  } catch { zero = null; solv = null; }
  const cashOutAt = zero?.date instanceof Date ? zero.date : null;

  const row = (m) => {
    const at = m.date instanceof Date ? m.date : dateAt(doc, clean(m.t));
    // TWO FACTS, KEPT SEPARATE, because collapsing them is what got this wrong twice. The balance on
    // the day says whether there is money; `stranded` says whether the company survives to see it.
    // A date can be solvent on its own and unreachable — +$16,080 in the bank, and insolvent since
    // December — and a single boolean cannot hold that.
    //
    // Judging on the balance alone was a FALSE GREEN; judging on the cliff alone printed "29 days past
    // the cash" beside a positive balance. Both facts, both shown.
    const stranded = !!m.stranded;
    const negative = clean(m.bal) < 0;
    const beyondCash = stranded || negative;
    const bridge = clean(m.bridge);
    const lateBy = stranded && cashOutAt ? Math.round((at - cashOutAt) / DAY) : null;
    const target = clean(m.target);
    const gap = clean(m.gap);
    return {
      id: m.id || m.label, label: m.label || "Milestone",
      due: clean(m.t), dueAt: at, dueLabel: shortDate(at),
      bal: clean(m.bal), target, pass: !!m.pass, gap,
      fromRound: !!m.fromRound,
      beyondCash, stranded, negative,
      // THE BRIDGE IS THE DEEPEST DEFICIT BEFORE THIS DATE, not the worst overall — otherwise every
      // date after the first crossing looks equally doomed and the chart stops discriminating between
      // a $200 dip and a $188k hole.
      bridge: bridge > 0 ? bridge : null,
      lateBy: lateBy && lateBy > 0 ? lateBy : null,
      // REACHED BUT SHORT — the case only milestones have. Only meaningful when the date is actually
      // reachable: a milestone past the cash is not "short of target", it is not happening.
      // "Short of target" is a shortfall to close. A date the company never reaches is not short, it
      // is not happening — and saying both would be two verdicts on one row.
      short: !beyondCash && target > 0 && gap < 0,
      shortBy: !beyondCash && target > 0 && gap < 0 ? Math.abs(gap) : null,
    };
  };

  const mine = ms.filter(m => !m.fromRound).map(row).sort((a, b) => a.due - b.due);
  const fromRound = ms.filter(m => m.fromRound).map(row).sort((a, b) => a.due - b.due);

  const last = Math.max(0, ...[...mine, ...fromRound].map(r => r.due));
  const span = Math.max(monthsShown(doc), Math.ceil(last) + 3);

  const missed = [...mine, ...fromRound].filter(r => r.beyondCash).length;
  const biggestBridge = Math.max(0, ...[...mine, ...fromRound].map(r => clean(r.bridge)));
  const shortOf = [...mine, ...fromRound].filter(r => r.short).length;

  return {
    kind: "milestones",
    mine, fromRound,
    rows: [...mine, ...fromRound],
    ticks: axisTicks(doc, span),
    span,
    cashOut: zero?.months ?? null,
    cashOutLabel: cashOutAt ? shortDate(cashOutAt) : `beyond ${HORIZON} months`,
    cashOutEndless: !cashOutAt,
    // The hole is BOUNDED where cash recovers. Shading to the edge would make a 61-day gap and a
    // permanent one look identical, and they are different conversations.
    recoversT: solv?.recoversT ?? null,
    recoversLabel: solv?.recoversAt ? shortDate(solv.recoversAt) : null,
    deepest: solv?.deepest ?? null,
    deepestAt: solv?.deepestAt ?? null,
    deepestLabel: solv?.deepestAt ? shortDate(solv.deepestAt) : null,
    daysUnderwater: solv?.daysUnderwater ?? null,
    biggestBridge: biggestBridge > 0 ? biggestBridge : null,
    legend: [
      { label: "Reachable", tone: "signal" },
      { label: "Negative on the day", tone: "danger" },
      { label: "Unreachable without bridging", tone: "danger", ring: true },
      { label: "Reached but short of target", tone: "caution", ring: true },
    ],
    format: "money",
    note: missed
      ? `${plural(missed, "date is", "dates are")} unreachable without bridging` +
        (cashOutAt ? `; cash runs out on ${shortDate(cashOutAt)}` : "") +
        // NO CURRENCY FORMATTING IN THE ENGINE. `money` is a view concern and importing it here would
        // put a locale decision in a pure module. The renderer formats `biggestBridge`.
        "."
      : shortOf
        ? `${plural(shortOf, "date is", "dates are")} reached but short of the target set for it.`
        : "Every date is reached with its target met.",
  };
};

// ============================================================== SPEND HISTORY ==

const histPlanVsActual = (doc, parts) => {
  const hist = (doc.history || []).slice(-12);
  if (!hist.length) return { empty: "No spend history imported yet." };
  const rows = projectionRows(doc, parts);
  // ⚠️ `r.rev` / `r.cost`, NOT `r.in` / `r.out`. `buildProjection` pushes
  // `{ m, start, rev, cost, net, end, inNonGrant }` — there has never been an `in` or an `out`, so
  // `clean(undefined)` returned 0 and these drew a flat nothing. Seven readers of two fields no writer
  // has ever produced.
  //
  // ⚠️ INDEXED BY `h.month`, NOT BY POSITION IN THE SLICE. `hist` is `.slice(-12)`, so on a document
  // with more than a year of history position 0 is month 12 and every planned figure was read a year
  // early. Invisible at six months of ledger and wrong the moment somebody imports two years.
  const plannedAt = (h) => Math.abs(clean(rows[clean(h.month)]?.cost));
  const planned = hist.map(plannedAt);
  const actual = hist.map(h => clean(monthTotal(h)));
  // ⚠️ A REAL CALENDAR LABEL, AND `h.month || ""` MADE MONTH ZERO BLANK. `0` is falsy, so the first
  // recorded month — the one every reader looks at first — rendered as an empty string while the rest
  // showed raw index numbers: "", 1, 2, 3, 4, 5.
  const label = (h) => h.period || monthLabel(doc.startY ?? new Date().getFullYear(), doc.startM ?? 0, clean(h.month));
  return {
    kind: "bars",
    x: hist.map(label),
    // ⚠️ WITHOUT TICKS THIS AXIS FELL TO THE "ends only" FALLBACK, which places the first and last
    // labels at the PLOT EDGES — and bars are centred in bands, so neither label sat over the bar it
    // named. `CategoryAxis` positions at `i * groupW + groupW / 2`, the same band model `Bars` lays out
    // with, so a tick lands on its bar for every count of bars.
    ticks: hist.map((h, i) => ({ i, label: label(h), categorical: true })),
    series: [
      { id: "plan", label: "Planned", values: planned, tone: "muted" },
      { id: "actual", label: "Actual", values: actual,
        tones: actual.map((v, i) => (v > planned[i] * 1.05 ? "danger" : "signal")), tone: "signal" },
    ],
    format: "money",
    // Six bars leaning the same way is not noise; it is a model that needs re-basing, and it is the
    // earliest warning this product can give.
    note: "Bars leaning the same way for months mean the model needs re-basing.",
  };
};

const histVariance = (doc, parts) => {
  const hist = doc.history || [];
  if (!hist.length) return { empty: "No spend history imported yet." };
  const maps = { codeMap: doc.codeMap || {}, customerMap: doc.customerMap || {} };
  const rows = projectionRows(doc, parts);

  const byCode = new Map();
  hist.forEach((h, i) => {
    // `out` never existed — see histPlanVsActual. `h.month` rather than the loop index for the same
    // reason: a history array is not guaranteed to start at month zero.
    const plannedMonth = Math.abs(clean(rows[clean(h.month)]?.cost));
    const actualMonth = clean(monthTotal(h));
    const share = actualMonth ? (actualMonth - plannedMonth) / actualMonth : 0;
    for (const l of h.lines || []) {
      if (!isCost(l)) continue;
      const code = lineCode(l) || resolveLine(l, maps) || OVERHEAD;
      byCode.set(code, clean(byCode.get(code)) + clean(lineAmount(l)) * share);
    }
  });

  const top = [...byCode.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
  if (!top.length) return { empty: "Nothing coded yet." };

  return {
    kind: "diverging",
    rows: top.map(([code, v]) => ({ label: String(code), value: v })),
    legend: [{ label: "Over plan", tone: "danger" }, { label: "Under plan", tone: "signal" }],
    format: "money",
    note: "Right of centre is over plan. Turns a number into somewhere to look.",
  };
};

const histRolling = (doc) => {
  const hist = doc.history || [];
  if (hist.length < 3) return { empty: "Three months of history needed to smooth a trend." };
  const totals = hist.map(h => clean(monthTotal(h)));
  const rolling = totals.map((_, i) =>
    i < 2 ? null : sum(totals.slice(i - 2, i + 1)) / 3).filter(v => v != null);
  const avg = sum(totals) / totals.length;
  return {
    kind: "lines",
    x: hist.slice(2).map(h => h.period || h.month || ""),
    series: [
      { id: "rolling", label: "3-month burn", values: rolling, tone: "signal" },
      { id: "avg", label: "Average", values: rolling.map(() => avg), tone: "muted", dashed: true },
    ],
    format: "money",
    note: "Smooths lumpy months so a genuine climb is distinguishable from one big invoice.",
  };
};

// ==================================================================== REGISTRY ==

/** Three per tab, the first being what somebody sees who never opens the picker.
 *
 *  The default matters more than the tuning: most people never open a picker, so most people get the
 *  default. The other two are for the person whose question is different. */
export const CHARTS = Object.freeze([
  // ⚠️ FIRST, AND THEREFORE THE DEFAULT — `defaultChartFor` takes the first chart registered for a
  // tab. The Cash flow tab led with the runway line inside its band, which is the DASHBOARD's question
  // asked twice: somebody who has opened Cash flow has already seen the runway and wants to know what
  // is moving it. Net flow by month answers that, and the sub-tab lenses then narrow it to money in or
  // money out without changing chart.
  { id: "flow.inout", tab: "flow", name: "In and out, by month",
    why: "Inflow above the line, outflow below. Makes lumpy grant receipts visible.", build: flowInOut },

  { id: "flow.runway", tab: "flow", name: "Runway, with its range",
    why: "The balance line inside its confidence band. Says where the answer sits, not a date that sounds certain.",
    build: flowRunway },
  { id: "flow.composition", tab: "flow", name: "What the burn is made of",
    why: "Payroll against everything else. Shows which half you could actually change.", build: flowComposition },

  { id: "pay.timeline", tab: "pay", name: "Payroll, with starts marked",
    why: "Each step is a hire landing, visible before it happens.", build: payTimeline },
  { id: "pay.headcount", tab: "pay", name: "Headcount against cost per head",
    why: "Whether the team is getting cheaper or dearer per person as it grows.", build: payHeadcount },
  { id: "pay.allocation", tab: "pay", name: "Who is charged where",
    why: "Each person's time across projects, with unfunded time in red.", build: payAllocation },

  { id: "proj.pace", tab: "proj", name: "Spend against the clock",
    why: "Above the diagonal is ahead of pace — what a program officer asks first.", build: projPace },
  { id: "proj.budget", tab: "proj", name: "Budget left, per project",
    why: "How much of each award is still unspent, side by side.", build: projBudget },
  { id: "proj.load", tab: "proj", name: "Team load by project",
    why: "Catches the month three grants all want the same person.", build: projLoad },

  // COVER IS THE DEFAULT, not forecast-vs-booked. A default has to draw for everybody, and the other
  // two need subscription lines or booked revenue that plenty of grant-funded organisations do not
  // have — leaving the tab's headline chart as an apology. Cover is derivable from any projection.
  { id: "sales.cover", tab: "sales", name: "Revenue as a share of burn",
    why: "How close the business is to paying for itself, with breakeven as the line to reach.",
    build: salesCover },
  { id: "sales.forecast", tab: "sales", name: "Forecast against booked",
    why: "Two lines diverging. A forecast running hot is a runway longer on screen than in the bank.",
    build: salesForecast },
  {
    id: "sales.recurring", tab: "sales", name: "Revenue and subscribers",
    why: "Order revenue and subscription revenue stacked, with the subscriber count over them. Revenue rising while subscribers are flat is a price rise; revenue flat while subscribers rise is churn eating the growth.",
    build: (doc, parts) => {
      // ⚠️ `parts.rows` DOES NOT EXIST. I wrote this chart against a field I assumed was there — every
      // other chart calls `projectionRows(doc, parts)` — so `sales.recurring` has emitted empty series
      // since the day it was added, and the "no chart" Corey would have seen on that entry was this.
      const rows = projectionRows(doc, parts);
      // ⚠️ A LITERAL 18, WHICH A SEARCH FOR `MONTHS_SHOWN` DOES NOT FIND. I wrote these three windows
      // by hand, so they ignored the horizon setting AND could disagree with `months(doc)` beside them.
      // **A magic number is not just unclear — it is invisible to the audit that would have caught it.**
      const n = Math.min(rows.length, monthsShown(doc));
      const sum = (lines) => {
        const out = Array.from({ length: n }, () => 0);
        for (const l of lines || []) {
          const a = Number(l?.amount) || 0;
          const st = Math.max(0, Number(l?.start) || 0);
          const en = l?.end == null ? n - 1 : Number(l.end);
          if (l?.cadence === "onetime") { if (st < n) out[st] += a; continue; }
          for (let m = st; m <= Math.min(en, n - 1); m++) out[m] += a;
        }
        return out;
      };
      const per = (doc?.saas || []).map(sp => saasSeries(sp, n));
      return {
        // ⚠️ COMPOSITE, because the two revenues STACK and the count does not. A subscriber count is a
        // different unit on the right axis — the shape this chart needs is exactly what the composite
        // renderer and the two-domain axis work landed for.
        kind: "composite", x: months(doc), ticks: axisTicks(doc),
        series: [
          { id: "orders", label: "Order revenue", values: sum(parts?.salesLines),
            tone: "signal", shape: "bars", stacked: true },
          { id: "subs", label: "Subscription revenue", values: sum(parts?.saasLines),
            tone: "gate", shape: "bars", stacked: true },
          { id: "count", label: "Subscribers",
            values: Array.from({ length: n }, (_, m) =>
              per.reduce((a, ser) => a + (ser?.[m]?.customers || 0), 0)),
            // ⚠️ DECLARED, NOT INFERRED. Without it the axis fell back to `count` BY LUCK and the
            // tooltip fell back to money — two consumers guessing differently about the same series.
            tone: "thrust", shape: "lines", axis: "right", unit: "count" },
        ],
        format: "money",
      };
    },
  },
  { id: "sales.mrr", tab: "sales", name: "Recurring revenue",
    why: "What subscription revenue is doing on its own.", build: salesMrr },

  { id: "inv.slip", tab: "inv", name: "What a slipped close costs",
    why: "The round on plan against the round three months late. The gap is the bridge you need.",
    build: invSlip },
  { id: "inv.ownership", tab: "inv", name: "Ownership across rounds",
    why: "Founder share after each raise — the number people discover too late.", build: invOwnership },
  { id: "inv.goals", tab: "inv", name: "Goals against the runway",
    why: "Whether the money lasts long enough to reach the evidence the round is being raised on.",
    build: invGoals },

  // MOVED OFF INVESTMENT. Cash at each critical date is a milestones question, and it was the third
  // Investment chart mostly because milestones had no chart of its own — which is a reason to give
  // milestones one, not a reason to leave it on the wrong tab.
  { id: "ms.runway", tab: "ms", name: "Runway at each milestone",
    why: "Cash left when each critical date arrives, against the target set for it.",
    build: invMilestones },

  { id: "hist.planvsactual", tab: "hist", name: "Planned against actual",
    why: "Bars leaning the same way for months mean the model needs re-basing.", build: histPlanVsActual },
  { id: "hist.variance", tab: "hist", name: "Variance by code",
    why: "Which categories drove the gap. Turns a number into somewhere to look.", build: histVariance },
  { id: "hist.rolling", tab: "hist", name: "Rolling three-month burn",
    why: "Smooths lumpy months so a real climb is distinguishable from one big invoice.", build: histRolling },
  // ── Commitments ──────────────────────────────────────────────────────────────────────────────
  {
    id: "cmt.closure", tab: "cmt", name: "What you would owe if you stopped",
    why: "Obligations stacked, cash over them. Where the line enters the stack is the clean-exit date — not the runway date.",
    build: (doc, parts) => {
      // ⚠️ `parts.rows` DOES NOT EXIST. I wrote this chart against a field I assumed was there — every
      // other chart calls `projectionRows(doc, parts)` — so `sales.recurring` has emitted empty series
      // since the day it was added, and the "no chart" Corey would have seen on that entry was this.
      const rows = projectionRows(doc, parts);
      // ⚠️ A LITERAL 18, WHICH A SEARCH FOR `MONTHS_SHOWN` DOES NOT FIND. I wrote these three windows
      // by hand, so they ignored the horizon setting AND could disagree with `months(doc)` beside them.
      // **A magic number is not just unclear — it is invisible to the audit that would have caught it.**
      const n = Math.min(rows.length, monthsShown(doc));
      const at = (f) => Array.from({ length: n }, (_, m) => f(m));
      const wd = windDownCost(doc);
      // ⚠️ COMPOSITE — THE ONE CURATED CHART THAT DESCRIBED SOMETHING UNDRAWABLE. It said `kind:
      // "stack"` and gave cash `shape: "lines"`, and nothing read that: every renderer drew the whole
      // spec in one shape, so cash came out as a fourth stacked band. **The spec was right and the
      // renderer could not honour it** until `Composite` existed.
      return {
        kind: "composite", x: months(doc), ticks: axisTicks(doc),
        series: [
          // THESE THREE GENUINELY SUM — none contains another, which is unusual among this tab's
          // neighbours and is what makes stacking honest here.
          { id: "wind", label: "Wind-down payroll", values: at(() => wd), tone: "brown", stacked: true },
          { id: "cs", label: "Accrued cost share", values: at(m => accruedCostShare(doc, m)),
            tone: "gate", stacked: true },
          { id: "debt", label: "Debt and notes", values: at(m => outstandingDebt(doc, m)),
            tone: "clay", stacked: true },
          // CASH RIDES OVER AS A LINE. A position, not a fourth component of the same total — and the
          // crossing where the line enters the stack is the clean-exit date, which is the whole point.
          // ⚠️ `r.start` — "cash on hand" in a month is what you HAVE that month, not what is left
          // after it. Same fault as `flow.runway`, same field, and it would have shifted this series
          // by a month too.
          { id: "cash", label: "Cash on hand", values: rows.slice(0, n).map(r => r.start),
            tone: "signal", shape: "lines" },
        ],
        format: "money",
      };
    },
  },
  {
    id: "cmt.costshare", tab: "cmt", name: "Cost share, accrued against matched",
    why: "The gap is the shortfall — you cannot match federal money with federal money.",
    build: (doc, parts) => {
      // ⚠️ `parts.rows` DOES NOT EXIST. I wrote this chart against a field I assumed was there — every
      // other chart calls `projectionRows(doc, parts)` — so `sales.recurring` has emitted empty series
      // since the day it was added, and the "no chart" Corey would have seen on that entry was this.
      const rows = projectionRows(doc, parts);
      // ⚠️ A LITERAL 18, WHICH A SEARCH FOR `MONTHS_SHOWN` DOES NOT FIND. I wrote these three windows
      // by hand, so they ignored the horizon setting AND could disagree with `months(doc)` beside them.
      // **A magic number is not just unclear — it is invisible to the audit that would have caught it.**
      const n = Math.min(rows.length, monthsShown(doc));
      let run = 0;
      const matched = rows.slice(0, n).map(r => { run += r.inNonGrant || 0; return run; });
      return {
        kind: "lines", x: months(doc), ticks: axisTicks(doc),
        series: [
          { id: "accrued", label: "Cost share accrued",
            values: Array.from({ length: n }, (_, m) => accruedCostShare(doc, m)), tone: "gate" },
          { id: "matched", label: "Non-grant funds available to match it",
            values: matched, tone: "signal" },
        ],
        format: "money",
      };
    },
  },

]);

export const chartsForTab = (tab) => CHARTS.filter(c => c.tab === tab);
export const defaultChartFor = (tab) => chartsForTab(tab)[0]?.id ?? null;
export const chartById = (id) => CHARTS.find(c => c.id === id) || null;

/** Build one, never throwing.
 *
 *  A chart that throws takes its whole tab down with it. Every one of these reads optional fields off a
 *  document somebody is midway through editing, so the failure is not hypothetical — and an empty box
 *  with a sentence is a far better outcome than a blank screen. */
export function buildChart(id, doc, parts) {
  const spec = chartById(id);
  if (!spec) return { empty: "No chart selected." };
  try {
    const built = spec.build(doc || {}, parts || {}) || { empty: "Nothing to show yet." };
    // ⚠️ STAMPED IN ONE PLACE, NOT IN TWENTY-ONE BUILDERS. Every spec passes through here, and the
    // divide between recorded and modelled is the same question on all of them — asking each chart to
    // remember it is asking twenty-one chances to forget.
    //
    // `history.length` is how many months are recorded, so it is the index of the first PROJECTED
    // month minus one. Absent history means no divide is known, and `valueAt` then claims nothing
    // rather than calling everything recorded.
    const hist = (doc?.history || []).length;
    return hist > 0 ? { ...built, todayIndex: hist - 1 } : built;
  } catch (e) {
    return { empty: "This chart could not be drawn from the current model.", error: String(e?.message || e) };
  }
}
