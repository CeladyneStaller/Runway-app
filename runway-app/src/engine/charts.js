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

import { buildProjection, zeroInfo } from "./projection.js";
import { confidenceBand } from "./band.js";
import { buildModelFromDoc } from "./buildmodel.js";
import { monthTotal, monthRevenue, isCost, lineAmount, lineCode, resolveLine, OVERHEAD } from "./coding.js";
import { spentToDate } from "./summary.js";
import { saasSeries } from "./saas.js";
import { HORIZON, monthLabel } from "./time.js";

const MONTHS_SHOWN = 18;

const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
const clean = (n) => (Number.isFinite(n) ? n : 0);

/** How far through its period a project is, when it does not carry the figure itself. */
const elapsedShare = (p, doc) => {
  const start = clean(p.startM), end = clean(p.endM ?? p.months);
  if (!(end > start)) return 0;
  const now = clean(doc?.nowM ?? 0);
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
};

/** Month labels from the document's start, for the horizon a chart shows. */
const months = (doc, n = MONTHS_SHOWN) =>
  Array.from({ length: n }, (_, i) => monthLabel(doc.startY ?? new Date().getFullYear(),
                                                doc.startM ?? 0, i));

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
  const band = confidenceBand(doc, HORIZON);
  const take = (rows) => (rows || []).slice(0, MONTHS_SHOWN).map(r => clean(r.end));
  const mid = take(band.expected?.rows);
  if (!mid.length) return { empty: "No projection yet — add cash and a line or two." };

  // `zero` is a NUMBER of months, not an object. Assumed otherwise and every runway chart silently
  // fell back to its empty state — while the tests passed, because they accepted "said why not" as an
  // outcome without checking that the DEFAULT charts actually draw.
  const z = band.expected?.zero;
  return {
    kind: "lines",
    x: months(doc),
    band: { lo: take(band.floor?.rows), hi: take(band.ceiling?.rows) },
    series: [{ id: "balance", label: "Cash balance", values: mid, tone: "signal" }],
    refLine: { y: 0 },
    markers: Number.isFinite(z) && z < MONTHS_SHOWN
      ? [{ x: z, label: `${z.toFixed(1)} mo`, tone: "danger" }] : [],
    format: "money",
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

  const pay = rows.slice(0, MONTHS_SHOWN).map((_, i) =>
    sum((parts?.employeeLines || []).map(l => clean(l.amounts?.[i]))));
  const all = rows.slice(0, MONTHS_SHOWN).map(r => Math.max(0, -clean(r.net) + clean(r.in || 0)));
  const other = all.map((v, i) => Math.max(0, v - pay[i]));

  return {
    kind: "stack",
    x: months(doc),
    series: [
      { id: "payroll", label: "Payroll", values: pay, tone: "signal" },
      { id: "other", label: "Everything else", values: other, tone: "muted" },
    ],
    format: "money",
    note: payroll ? null : "No employees yet, so all of this is other spend.",
  };
};

const flowInOut = (doc, parts) => {
  const rows = projectionRows(doc, parts).slice(0, MONTHS_SHOWN);
  if (!rows.length) return { empty: "No projection yet." };
  return {
    kind: "bars",
    x: months(doc),
    series: [
      { id: "in", label: "Money in", values: rows.map(r => clean(r.in)), tone: "signal" },
      { id: "out", label: "Money out", values: rows.map(r => -Math.abs(clean(r.out))), tone: "danger" },
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
  const values = Array.from({ length: MONTHS_SHOWN }, (_, i) =>
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
    x: months(doc),
    series: [{ id: "payroll", label: "Payroll", values, tone: "signal" }],
    markers: markers.slice(0, 4),
    format: "money",
  };
};

const payHeadcount = (doc, parts) => {
  const emp = doc.employees || [];
  if (!emp.length) return { empty: "No employees yet." };
  const lines = parts?.employeeLines || [];

  const heads = Array.from({ length: MONTHS_SHOWN }, (_, i) =>
    lines.filter(l => clean(l.amounts?.[i]) > 0).length);
  const each = Array.from({ length: MONTHS_SHOWN }, (_, i) => {
    const n = heads[i];
    return n ? sum(lines.map(l => clean(l.amounts?.[i]))) / n : 0;
  });

  return {
    kind: "lines",
    x: months(doc),
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
  const rows = emp.map(e => {
    const per = rProjects.map(p => {
      const alloc = (p.team || []).find(t => t.employeeId === e.id || t.id === e.id);
      return { id: p.id, label: p.name, value: clean(alloc?.fte ?? alloc?.pct ?? 0) };
    }).filter(x => x.value > 0);
    const used = sum(per.map(x => x.value));
    return { id: e.id, label: e.name || e.role || "Unnamed", parts: per, unfunded: Math.max(0, 1 - used) };
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
    format: "percent",
    note: "How much of each award is still unspent.",
  };
};

const projLoad = (doc, parts) => {
  const rProjects = parts?.rProjects || [];
  if (!rProjects.length) return { empty: "No projects yet." };

  const perProject = rProjects.slice(0, 6).map(p => ({
    id: p.id, label: p.name, tone: "signal",
    values: Array.from({ length: MONTHS_SHOWN }, (_, i) =>
      sum((p.team || []).map(t => (i >= clean(t.startM) && i <= clean(t.endM ?? MONTHS_SHOWN)
        ? clean(t.fte ?? t.pct ?? 0) : 0)))),
  }));

  if (!perProject.some(s => s.values.some(v => v > 0))) {
    return { empty: "No team allocated to any project yet." };
  }

  return {
    kind: "stack",
    x: months(doc),
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
    ? Array.from({ length: MONTHS_SHOWN }, (_, i) =>
        sum((parts.salesLines || []).map(l => clean(l.amounts?.[i]))))
    : [];
  const booked = hist.slice(-MONTHS_SHOWN).map(h => clean(monthRevenue(h)));
  if (!booked.length) return { empty: "No booked revenue recorded yet." };

  return {
    kind: "lines",
    x: months(doc),
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
  const values = Array.from({ length: MONTHS_SHOWN }, (_, i) =>
    sum(saas.map(x => clean(saasSeries(x, MONTHS_SHOWN).find(pt => pt.month === i)?.mrr))));
  if (!values.some(v => v > 0)) return { empty: "No subscription revenue yet." };
  return {
    kind: "stack",
    x: months(doc),
    series: [{ id: "mrr", label: "MRR", values, tone: "signal" }],
    format: "money",
  };
};

const salesCover = (doc, parts) => {
  const rows = projectionRows(doc, parts).slice(0, MONTHS_SHOWN);
  if (!rows.length) return { empty: "No projection yet." };
  const values = rows.map(r => {
    const out = Math.abs(clean(r.out));
    return out ? Math.min(1.5, clean(r.in) / out) : 0;
  });
  return {
    kind: "stack",
    x: months(doc),
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

  const onPlan = balances(doc).slice(0, MONTHS_SHOWN);

  // The same model with every round three months later. Nobody builds this case deliberately, which is
  // exactly why it is worth drawing: the gap is the size of the bridge a late term sheet needs.
  const slipped = {
    ...doc,
    rounds: rounds.map(r => ({ ...r, closeM: clean(r.closeM) + 3 })),
  };
  const late = balances(slipped).slice(0, MONTHS_SHOWN);

  const z = zeroInfo(buildProjection(buildModelFromDoc(slipped), doc.settings?.toggles || {}),
                     doc.startY, doc.startM);

  return {
    kind: "lines",
    x: months(doc),
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
  return { kind: "hbars", rows, format: "percent", note: "Founder share after each raise." };
};

const invMilestones = (doc, parts) => {
  const ms = parts?.msWithBal || [];
  if (!ms.length) return { empty: "No critical dates set yet." };
  return {
    kind: "bars",
    x: ms.map(m => m.label),
    series: [{
      id: "bal", label: "Cash at that date",
      values: ms.map(m => clean(m.bal)),
      tones: ms.map(m => (m.pass ? "signal" : "danger")),
      tone: "signal",
    }],
    refLine: { y: 0 },
    format: "money",
    note: "Cash left when each critical date arrives.",
  };
};

// ============================================================== SPEND HISTORY ==

const histPlanVsActual = (doc, parts) => {
  const hist = (doc.history || []).slice(-12);
  if (!hist.length) return { empty: "No spend history imported yet." };
  const rows = projectionRows(doc, parts);
  const planned = hist.map((_, i) => Math.abs(clean(rows[i]?.out)));
  const actual = hist.map(h => clean(monthTotal(h)));
  return {
    kind: "bars",
    x: hist.map(h => h.period || h.month || ""),
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
    const plannedMonth = Math.abs(clean(rows[i]?.out));
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
  { id: "flow.runway", tab: "flow", name: "Runway, with its range",
    why: "The balance line inside its confidence band. Says where the answer sits, not a date that sounds certain.",
    build: flowRunway },
  { id: "flow.composition", tab: "flow", name: "What the burn is made of",
    why: "Payroll against everything else. Shows which half you could actually change.", build: flowComposition },
  { id: "flow.inout", tab: "flow", name: "In and out, by month",
    why: "Inflow above the line, outflow below. Makes lumpy grant receipts visible.", build: flowInOut },

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
  { id: "sales.mrr", tab: "sales", name: "Recurring revenue",
    why: "What subscription revenue is doing on its own.", build: salesMrr },

  { id: "inv.slip", tab: "inv", name: "What a slipped close costs",
    why: "The round on plan against the round three months late. The gap is the bridge you need.",
    build: invSlip },
  { id: "inv.ownership", tab: "inv", name: "Ownership across rounds",
    why: "Founder share after each raise — the number people discover too late.", build: invOwnership },
  { id: "inv.milestones", tab: "inv", name: "Runway at each milestone",
    why: "Cash left when each critical date arrives.", build: invMilestones },

  { id: "hist.planvsactual", tab: "hist", name: "Planned against actual",
    why: "Bars leaning the same way for months mean the model needs re-basing.", build: histPlanVsActual },
  { id: "hist.variance", tab: "hist", name: "Variance by code",
    why: "Which categories drove the gap. Turns a number into somewhere to look.", build: histVariance },
  { id: "hist.rolling", tab: "hist", name: "Rolling three-month burn",
    why: "Smooths lumpy months so a real climb is distinguishable from one big invoice.", build: histRolling },
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
    return spec.build(doc || {}, parts || {}) || { empty: "Nothing to show yet." };
  } catch (e) {
    return { empty: "This chart could not be drawn from the current model.", error: String(e?.message || e) };
  }
}
