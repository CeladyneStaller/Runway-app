// Alerts and lenses. The interesting assertions are about restraint: an alert module that fires
// generously becomes wallpaper within a week, and a lens that invents a difference is worse than no
// lens at all.
import { describe, it, expect } from "vitest";
import { alertsFor, ALL_RULES } from "../../src/engine/alerts.js";
import { LENSES, lensFor, chartIdFor, applyLens } from "../../src/engine/lenses.js";
import { buildChart, defaultChartFor } from "../../src/engine/charts.js";
import { buildModelParts } from "../../src/engine/buildmodel.js";
import { canaryDoc as demoDoc, emptyDoc } from "../../src/state/document.js";

const TABS = ["flow", "pay", "proj", "sales", "inv", "hist"];
const parts = (doc) => buildModelParts(doc);

describe("alerts — restraint first", () => {
  it("never shows more than two on a tab", () => {
    // Four amber boxes on every screen becomes wallpaper within a week, and then the real one is
    // invisible. The cap is enforced in `alertsFor`, not left to judgement at each call site.
    const doc = demoDoc();
    for (const tab of [...TABS, "dash"]) {
      expect(alertsFor(tab, doc, parts(doc)).length, tab).toBeLessThanOrEqual(2);
    }
  });

  it("shows the worst first", () => {
    const doc = demoDoc();
    for (const tab of TABS) {
      const order = { bad: 0, warn: 1, info: 2 };
      const tones = alertsFor(tab, doc, parts(doc)).map(a => order[a.tone]);
      expect([...tones].sort((a, b) => a - b), tab).toEqual(tones);
    }
  });

  it("says nothing at all about an empty document", () => {
    // A new company should not open under a pile of warnings about things it has not done yet.
    const doc = emptyDoc();
    for (const tab of TABS) {
      expect(alertsFor(tab, doc, parts(doc)), tab).toEqual([]);
    }
  });

  it("gives every alert something to DO, and somewhere to do it", () => {
    // "Runway is short" is a fact and belongs on a tile. A rule that cannot finish the sentence
    // "so you should…" does not belong here.
    const doc = demoDoc();
    for (const tab of TABS) {
      for (const a of alertsFor(tab, doc, parts(doc))) {
        expect(a.text.length, `${tab}/${a.id}`).toBeGreaterThan(24);
        expect(a.action, `${tab}/${a.id} has no action`).toBeTruthy();
        expect(TABS, `${tab}/${a.id} points nowhere`).toContain(a.to);
      }
    }
  });

  it("does not repeat itself within a tab", () => {
    const doc = demoDoc();
    for (const tab of TABS) {
      const ids = alertsFor(tab, doc, parts(doc)).map(a => a.id);
      expect(new Set(ids).size, tab).toBe(ids.length);
    }
  });
});

describe("alerts — never throwing", () => {
  const wrecked = [
    {}, { history: [{}] }, { employees: [{}] }, { projects: [{ id: "p" }] },
    { rounds: [{ amount: 1 }] }, { history: null, codeMap: null },
    { startY: undefined, startM: undefined },
  ];

  it.each([...TABS, "dash"])("%s survives a malformed document", (tab) => {
    // These are documents somebody is midway through editing. A rule that throws would take a whole
    // tab down over an advisory message.
    for (const doc of wrecked) {
      expect(() => alertsFor(tab, doc, {})).not.toThrow();
      expect(Array.isArray(alertsFor(tab, doc, {}))).toBe(true);
    }
  });

  it("an unknown tab is empty, not an exception", () => {
    expect(alertsFor("nope", demoDoc(), {})).toEqual([]);
  });

  it("every tab in the registry is one the app actually has", () => {
    for (const tab of Object.keys(ALL_RULES)) {
      expect([...TABS, "dash"]).toContain(tab);
    }
  });
});

describe("lenses", () => {
  it("declares nothing for most sub-tabs", () => {
    // Fourteen of twenty-four are absent, and that is the design working. A lens should exist only
    // where a sub-tab genuinely means something different for the picture.
    const declared = Object.values(LENSES).reduce((n, t) => n + Object.keys(t).length, 0);
    expect(declared).toBeLessThan(16);
  });

  it("only names charts that exist", () => {
    for (const [tab, subs] of Object.entries(LENSES)) {
      for (const [sub, lens] of Object.entries(subs)) {
        if (lens?.chart) {
          expect(buildChart(lens.chart, demoDoc(), {}), `${tab}/${sub}`).toBeTruthy();
          expect(chartIdFor(tab, sub, null, defaultChartFor(tab))).toBe(lens.chart);
        }
      }
    }
  });

  it("lets an explicit choice beat the sub-tab", () => {
    // Picking a chart is a decision; clicking a sub-tab is navigation. Letting navigation override a
    // decision would make the picker appear broken the moment somebody browsed.
    expect(chartIdFor("proj", "proposals", "proj.pace", "proj.pace")).toBe("proj.pace");
    expect(chartIdFor("proj", "proposals", null, "proj.pace")).toBe("proj.budget");
  });

  it("ignores a saved choice that no longer exists", () => {
    expect(chartIdFor("flow", "net", "flow.deleted", "flow.runway")).toBe("flow.runway");
  });
});

describe("applying a lens", () => {
  const doc = demoDoc();
  const p = parts(doc);

  it("keeps only the named series", () => {
    const spec = buildChart("flow.composition", doc, p);
    const out = applyLens(spec, lensFor("flow", "costs"), doc);
    expect(out.series.map(s => s.id).sort()).toEqual(["other", "payroll"]);
  });

  it("DROPS THE BAND when it filters, because the band is not filterable", () => {
    // It is computed for the whole projection. Keeping it beside one filtered series would be drawing
    // a confidence interval around something nobody computed one for.
    const spec = buildChart("flow.runway", doc, p);
    expect(spec.band).toBeTruthy();
    expect(applyLens(spec, lensFor("flow", "revenue"), doc).band).toBeUndefined();
  });

  it("keeps the band when the lens does not filter", () => {
    const spec = buildChart("flow.runway", doc, p);
    expect(applyLens(spec, null, doc).band).toBeTruthy();
  });

  it("says WHICH lens emptied it, rather than drawing an empty axis", () => {
    const spec = { kind: "lines", series: [{ id: "x", values: [1] }] };
    const out = applyLens(spec, { label: "Grants", keep: ["nothing"] }, doc);
    expect(out.empty).toMatch(/Nothing under Grants/);
  });

  it("leaves an already-empty spec alone", () => {
    const out = applyLens({ empty: "No projection yet." }, lensFor("flow", "costs"), doc);
    expect(out.empty).toBe("No projection yet.");
  });

  it("filters rows as well as series", () => {
    const spec = { kind: "pace", rows: [{ id: "a" }, { id: "b" }] };
    const out = applyLens(spec, { label: "Half", rows: (r) => r.id === "a" }, doc);
    expect(out.rows).toHaveLength(1);
  });
});

describe("the goals chart — what the Investment goals sub-tab actually asks", () => {
  const doc = demoDoc();
  const p = parts(doc);

  it("draws goals rather than milestone balances", () => {
    // "Runway at each milestone" answered a milestones question on an investment tab. The question
    // this sub-tab asks is whether the money lasts long enough to reach the EVIDENCE the round is
    // being raised on — 5 kW stack, $1m booked — which is what the goals are.
    const spec = buildChart("inv.goals", doc, p);
    expect(spec.kind).toBe("goals");
    expect(spec.rows.length).toBeGreaterThan(0);
    expect(spec.rows[0].label).toBeTruthy();
  });

  it("measures against the runway WITHOUT the round", () => {
    // The committed projection assumes the round lands; the point here is the runway if it does not.
    // Reading goals against the optimistic line would answer a question nobody is asking.
    const spec = buildChart("inv.goals", doc, p);
    expect(spec.runsOut == null || Number.isFinite(spec.runsOut)).toBe(true);
    if (spec.runsOut != null) {
      for (const r of spec.rows) {
        expect(r.beyondCash).toBe(r.due > spec.runsOut);
      }
    }
  });

  it("tells two different problems apart", () => {
    // A goal past the cash cannot be reached at all. A goal on the wrong side of the CLOSE is filed in
    // the wrong phase. Different fixes, so different flags — and `afterClose` became `misfiled` when
    // the phase split arrived, because "after the close" is only an error for a PRE-raise goal.
    const spec = buildChart("inv.goals", doc, p);
    for (const r of spec.rows) {
      expect(typeof r.beyondCash).toBe("boolean");
      expect(typeof r.misfiled).toBe("boolean");
    }
  });

  it("orders them by when they are due", () => {
    const dues = buildChart("inv.goals", doc, p).rows.map(r => r.due);
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);
  });

  it("says so when no goals are set", () => {
    expect(buildChart("inv.goals", { rounds: [{ kind: "equity", status: "planning" }] }, {}).empty)
      .toMatch(/No goals/);
  });
});

describe("the milestone chart moved to the milestones tab", () => {
  it("is registered under ms, not inv", async () => {
    const { chartsForTab } = await import("../../src/engine/charts.js");
    expect(chartsForTab("ms").map(c => c.id)).toContain("ms.runway");
    expect(chartsForTab("inv").map(c => c.id)).not.toContain("inv.milestones");
  });

  it("draws when the app supplies the milestone balances", () => {
    // `msWithBal` is assembled in App, where the balances and the round-derived dates are both in
    // hand. Recomputing it here would be a second definition of a milestone's balance.
    //
    // It became a TIMELINE rather than bars, so the shape assertion moved with it: bars could show the
    // balance and not the target, which is the thing a milestone exists to carry.
    const spec = buildChart("ms.runway", demoDoc(), {
      msWithBal: [{ id: "a", label: "Series A close", bal: 250000, pass: true, t: 8, fromRound: true },
                  { id: "b", label: "Board meeting", bal: -12000, pass: false, t: 2 }],
    });
    expect(spec.kind).toBe("milestones");
    expect(spec.mine.map(r => r.id)).toEqual(["b"]);
    expect(spec.fromRound.map(r => r.id)).toEqual(["a"]);
  });
});

describe("the calendar axis", () => {
  it("labels STANDARD quarters — Jan, Apr, Jul, Oct", async () => {
    // Not quarters counted from whenever the model happens to begin. Nobody reads "Q2" as "the second
    // three months after my start date", and a chart that means something private by a public word is
    // worse than one with no labels at all.
    const { axisTicks } = await import("../../src/engine/charts.js");
    const ticks = axisTicks({ startY: 2026, startM: 7 }, 12);   // starts in August
    const quarters = ticks.filter(t => t.quarter);
    expect(quarters.map(t => t.q)).toEqual(["Q4", "Q1", "Q2", "Q3"]);
    expect(quarters[0].label).toMatch(/Oct 26/);
    expect(quarters[1].label).toMatch(/Jan 27/);
  });

  it("gives every month a tick and only quarters a name", async () => {
    const { axisTicks } = await import("../../src/engine/charts.js");
    const ticks = axisTicks({ startY: 2026, startM: 0 }, 12);
    expect(ticks).toHaveLength(12);
    expect(ticks.filter(t => t.quarter)).toHaveLength(4);
    expect(ticks.filter(t => t.label)).toHaveLength(4);
  });

  it("is carried by every month-indexed chart", async () => {
    const { CHARTS, buildChart } = await import("../../src/engine/charts.js");
    const doc = demoDoc(), p = parts(doc);
    for (const c of CHARTS) {
      const spec = buildChart(c.id, doc, p);
      if (spec.empty || !spec.x) continue;
      // A chart with month labels must carry ticks too, or its axis silently falls back to labelling
      // only the ends and the reader is left interpolating.
      const monthly = /\w{3} \d{2}/.test(String(spec.x[0] ?? ""));
      if (monthly) expect(spec.ticks, `${c.id} has month labels but no ticks`).toBeTruthy();
    }
  });

  it("survives a document with no start date", async () => {
    const { axisTicks } = await import("../../src/engine/charts.js");
    expect(() => axisTicks({}, 6)).not.toThrow();
    expect(axisTicks(undefined, 6)).toHaveLength(6);
  });
});

describe("the goals chart — two kinds of goal", () => {
  const doc = demoDoc();
  const p = parts(doc);

  it("splits pre-raise from post-raise", () => {
    // A round has goals pointing in both directions and the model treated them as one list, which is
    // why the chart read oddly: it measured both against the same runway and flagged the wrong half
    // as late.
    const spec = buildChart("inv.goals", doc, p);
    expect(Array.isArray(spec.pre)).toBe(true);
    expect(Array.isArray(spec.post)).toBe(true);
    expect(spec.pre.every(r => r.phase === "pre")).toBe(true);
    expect(spec.post.every(r => r.phase === "post")).toBe(true);
  });

  it("measures each phase against ITS OWN runway", () => {
    // Pre-raise against the money you already have — the round cannot fund the proof the round
    // depends on. Post-raise against the runway the round creates.
    const spec = buildChart("inv.goals", doc, p);
    expect(spec.cashOutLabel).toBeTruthy();
    expect(spec.afterRoundLabel).toBeTruthy();
    // A $6m round should not leave the two runways identical; that was the bug where `financing` was
    // forced off for both and the chart quietly said the round changes nothing.
    if (spec.cashOut != null && spec.afterRound != null) {
      expect(spec.afterRound).toBeGreaterThan(spec.cashOut);
    } else {
      expect(spec.afterRoundEndless).toBe(true);
    }
  });

  it("says 'beyond the horizon' rather than leaving a date blank", () => {
    const spec = buildChart("inv.goals", doc, p);
    if (spec.afterRoundEndless) expect(spec.afterRoundLabel).toMatch(/beyond/i);
  });

  it("flags the two OPPOSITE filing mistakes", () => {
    // A pre-raise goal after the close cannot gate a round that already happened. A post-raise goal
    // before the close spends money that has not arrived. Same field, opposite tests.
    const spec = buildChart("inv.goals", doc, p);
    for (const r of spec.pre) expect(r.misfiled).toBe(r.dueAt > r.closeAt);
    for (const r of spec.post) expect(r.misfiled).toBe(r.dueAt <= r.closeAt);
  });

  it("does not call a goal late when the cash never runs out", () => {
    // A null date means the runway outlasts the horizon, which is the opposite of a problem —
    // colouring those goals red would report a healthy round as a failing one.
    const rich = { ...demoDoc(), cash: 500_000_000 };
    const spec = buildChart("inv.goals", rich, buildModelParts(rich));
    for (const r of spec.post) expect(r.lateBy).toBeNull();
  });

  it("says when nobody has written down what the round buys", () => {
    const spec = buildChart("inv.goals", doc, p);
    if (!spec.post.length) expect(spec.postNote).toMatch(/what the round buys/i);
  });
});

describe("the goals chart, on real dates", () => {
  const doc = demoDoc();
  const p = parts(doc);

  it("states a day for the cash running out, not a month", () => {
    // `zeroInfo` interpolates within the crossing month — that is where "5.6 months" comes from — so
    // rounding to a month boundary here would lose precision the model already has.
    const spec = buildChart("inv.goals", doc, p);
    if (spec.runsOutAt) {
      expect(spec.runsOutLabel).toMatch(/\w{3} \d+, \d{2}/);
      expect(spec.runsOutAt.getDate()).toBeGreaterThan(0);
    }
  });

  it("gives every goal a date and, when late, a number of days", () => {
    const spec = buildChart("inv.goals", doc, p);
    for (const r of spec.rows) {
      expect(r.dueLabel, r.label).toMatch(/\w{3} \d+, \d{2}/);
      if (r.beyondCash) expect(r.lateBy, r.label).toBeGreaterThan(0);
      else expect(r.lateBy).toBeNull();
    }
  });

  it("counts days from the cash-out DATE, not from a month index", () => {
    const spec = buildChart("inv.goals", doc, p);
    const late = spec.rows.filter(r => r.lateBy);
    if (late.length > 1) {
      // Consecutive monthly goals are ~28-31 days apart, which a month-index subtraction could not
      // produce.
      const gaps = late.slice(1).map((r, i) => r.lateBy - late[i].lateBy);
      for (const g of gaps) expect(g).toBeGreaterThan(20);
    }
  });

  it("ends a quarter past the last goal, so nothing is pinned to the edge", () => {
    const spec = buildChart("inv.goals", doc, p);
    const last = Math.max(...spec.rows.map(r => r.due));
    expect(spec.span).toBeGreaterThanOrEqual(last + 3);
  });
});

describe("the milestones chart", () => {
  const doc = demoDoc();
  const ms = (over = {}) => ({
    id: "m1", label: "Board review", t: 2, date: new Date(2026, 8, 30),
    bal: 250000, target: 0, pass: true, gap: 250000, ...over,
  });
  const spec = (rows, extra = {}) =>
    buildChart("ms.runway", doc, { ...parts(doc), msWithBal: rows, ...extra });

  it("splits dates you set from dates derived from rounds", () => {
    // `Milestones.jsx` already refuses to edit `fromRound` milestones, so the split reflects a rule
    // that exists rather than inventing one.
    const s = spec([ms(), ms({ id: "m2", label: "Series A close", fromRound: true, t: 8 })]);
    expect(s.mine.map(r => r.id)).toEqual(["m1"]);
    expect(s.fromRound.map(r => r.id)).toEqual(["m2"]);
  });

  it("JUDGES EACH DATE ON ITS OWN BALANCE, not on the cliff", () => {
    // THE BUG THIS CAUGHT. `zeroInfo` reports the FIRST crossing, and cash can dip below zero and
    // recover when a receipt lands — so a date after the cliff can still have money in the bank.
    // Reading it off the cliff produced "29 days past the cash" beside a balance of +$16,080.
    const s = spec([ms({ t: 14, bal: 16080, date: new Date(2027, 0, 15) })]);
    expect(s.rows[0].beyondCash).toBe(false);
    expect(s.rows[0].lateBy).toBeNull();
  });

  it("flags a date that genuinely has no money", () => {
    const s = spec([ms({ t: 12, bal: -104494 })]);
    expect(s.rows[0].beyondCash).toBe(true);
  });

  it("flags REACHED BUT SHORT — the case only milestones have", () => {
    // A goal can only be past the cash. A milestone carries a target, so the date can arrive with
    // money in the bank and still fail. The bar chart this replaces showed the balance and not the
    // shortfall, because the target was not a quantity it knew about.
    const s = spec([ms({ bal: 186000, target: 250000, pass: false, gap: -64000 })]);
    expect(s.rows[0].short).toBe(true);
    expect(s.rows[0].shortBy).toBe(64000);
  });

  it("does not call a date short when it has no target", () => {
    // Round-derived dates mostly carry none, and marking them amber would report every capital event
    // as a miss.
    const s = spec([ms({ fromRound: true, target: 0, bal: 400000 })]);
    expect(s.fromRound[0].short).toBe(false);
  });

  it("does not call a date short when it is not reachable at all", () => {
    // "Short of target" is a shortfall to close. A date with no money behind it is not short, it is
    // not happening, and saying both would be two verdicts on one row.
    const s = spec([ms({ bal: -5000, target: 250000, pass: false, gap: -255000 })]);
    expect(s.rows[0].beyondCash).toBe(true);
    expect(s.rows[0].short).toBe(false);
  });

  it("says so when everything lands", () => {
    expect(spec([ms()]).note).toMatch(/Every date is reached/);
  });

  it("still reports no dates at all", () => {
    expect(spec([]).empty).toMatch(/No critical dates/);
  });
});

describe("⚠️ labour hours that name nobody", () => {
  const withLabour = (employeeId) => ({
    rProjects: [{
      id: "p1", name: "Build", type: "fulfillment",
      lines: [{ id: "l1", isLabor: true, employeeId, hours: 640, start: 0, end: 5 }],
    }],
  });

  it("fires when an isLabor line has no employee", async () => {
    // `teamLoad`'s accumulator starts `if (!id || !hrs) return`, so these hours are dropped in silence:
    // no load, no capacity charged, no allocation view. The work LOOKS recorded, which is worse than an
    // obvious blank.
    const { alertsFor } = await import("../../src/engine/alerts.js");
    const hit = alertsFor("proj", {}, withLabour(null)).find(a => a.id === "unnamed-labour");
    expect(hit, "expected the unnamed-labour alert").toBeTruthy();
    expect(hit.text).toMatch(/640/);
  });

  it("goes quiet once the hours belong to somebody", async () => {
    const { alertsFor } = await import("../../src/engine/alerts.js");
    expect(alertsFor("proj", {}, withLabour("e1")).find(a => a.id === "unnamed-labour")).toBeFalsy();
  });

  it("⚠️ AND NO SHIPPED ARCHETYPE TRIPS IT", async () => {
    // The guard that keeps demo data honest. Every labour line in every demo names a real person, so
    // "Team load by project" and the Allocation view both draw what the project actually represents.
    const { alertsFor } = await import("../../src/engine/alerts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      const doc = demoDoc(a.id);
      const hit = alertsFor("proj", doc, buildModelParts(doc)).find(x => x.id === "unnamed-labour");
      expect(hit?.text, `${a.id}: ${hit?.text || ""}`).toBeUndefined();
    }
  });
});

describe("solvency — cash crosses zero and comes back", () => {
  const rowsOf = (ends) => ends.map((end, m) => ({
    m, start: m === 0 ? 100 : ends[m - 1], end, net: 0, in: 0, out: 0, cost: 0,
  }));

  it("⚠️ IGNORES A HOLE THE COMPANY ALREADY CROSSED", async () => {
    // Without a window this scanned from month 0, so a dip four months back that the company SURVIVED
    // came back as the upcoming crossing — and every milestone got judged `stranded` against a date
    // already behind it. It also let the dashboard print TWO zero dates from ONE row set: the headline
    // passed a window to `zeroInfo`, this did not.
    //
    // Recorded cash already reflects the survival. Counting the hole here counts it twice.
    const { solvency } = await import("../../src/engine/projection.js");
    const rows = rowsOf([-40, -20, 60, 50, 40, 30]);      // underwater early, recovered by month 2
    expect(solvency(rows, 2026, 0)).not.toBeNull();        // default: still sees it, unchanged
    expect(solvency(rows, 2026, 0, 3)).toBeNull();         // windowed past it: nothing ahead
  });

  it("⚠️ BOUNDS THE BRIDGE TO WHAT THE CHART ACTUALLY DRAWS", async () => {
    // `deepest` is the number someone reads as "what I need to raise". On a committed-only line the
    // deficit grows without bound, so the deepest point drifts to the horizon and describes a month no
    // chart draws — $3,230,627 at month 36 on the canary, against an 18-month plot. A figure nobody can
    // see on the screen that produced it is not a figure to raise against.
    const { solvency } = await import("../../src/engine/projection.js");
    const rows = rowsOf([-10, -50, -90, -400]);
    expect(solvency(rows, 2026, 0).deepest).toBe(400);           // unbounded: the off-screen trough
    expect(solvency(rows, 2026, 0, 0, 2).deepest).toBe(90);      // bounded: the worst you can see
  });

  it("returns null when the balance never goes negative", async () => {
    // The common case, and the one where this must cost nothing and change nothing.
    const { solvency } = await import("../../src/engine/projection.js");
    expect(solvency(rowsOf([100, 90, 80, 70]), 2026, 0)).toBeNull();
  });

  it("names the hole, its depth and when it recovers", async () => {
    const { solvency } = await import("../../src/engine/projection.js");
    const s = solvency(rowsOf([100, -50, -80, -20, 40, 60]), 2026, 0);
    expect(s).toBeTruthy();
    expect(s.deepest).toBe(80);
    expect(s.recoversT).not.toBeNull();
    expect(s.daysUnderwater).toBeGreaterThan(0);
  });

  it("says recoversAt is NULL when it never comes back", async () => {
    // A different statement from a long hole, and it must not render as one.
    const { solvency } = await import("../../src/engine/projection.js");
    const s = solvency(rowsOf([100, -50, -80, -120]), 2026, 0);
    expect(s.recoversAt).toBeNull();
    expect(s.daysUnderwater).toBeNull();
  });

  it("handles TWO holes, taking the worst as `deepest`", async () => {
    const { solvency } = await import("../../src/engine/projection.js");
    const s = solvency(rowsOf([100, -30, 20, 50, -90, -60, 10]), 2026, 0);
    expect(s.holes).toHaveLength(2);
    expect(s.deepest).toBe(90);
  });

  it("bridges to a DATE, not to the worst hole overall", async () => {
    // The reason this is per-date: with one global number every date after the first crossing looks
    // equally doomed and the chart stops discriminating between a $200 dip and a $188k hole.
    const { solvency } = await import("../../src/engine/projection.js");
    const s = solvency(rowsOf([100, -30, 20, 50, -90, -60, 10]), 2026, 0);
    expect(s.bridgeTo(2)).toBe(30);      // only the first hole is behind us
    expect(s.bridgeTo(6)).toBe(90);      // both
    expect(s.bridgeTo(6)).toBeGreaterThan(s.bridgeTo(2));
  });

  it("marks anything past the FIRST crossing as stranded, however healthy its own balance", async () => {
    // THE WHOLE POINT. A company with no cash in January does not reach March, and the arithmetic does
    // not know that. Judging a date on its own balance was a false green.
    const { solvency } = await import("../../src/engine/projection.js");
    const s = solvency(rowsOf([100, -50, -80, -20, 40, 60]), 2026, 0);
    expect(s.strandedAt(5)).toBe(true);   // positive balance, still stranded
    expect(s.strandedAt(0)).toBe(false);
  });

  it("flags a shallow brief dip too, but the NUMBER carries the severity", async () => {
    // Zero is zero, so it is flagged — but $200 for four days and $188k for four months must be
    // distinguishable, and the colour cannot do that. The number can.
    const { solvency } = await import("../../src/engine/projection.js");
    const s = solvency(rowsOf([1000, -200, 800, 900]), 2026, 0);
    expect(s).toBeTruthy();
    expect(s.deepest).toBe(200);
  });

  it("survives empty and malformed input", async () => {
    const { solvency } = await import("../../src/engine/projection.js");
    expect(solvency([], 2026, 0)).toBeNull();
    expect(solvency(null, 2026, 0)).toBeNull();
  });
});

describe("the milestones chart, with solvency", () => {
  const doc = demoDoc();
  const base = (over = {}) => ({
    id: "m1", label: "Product launch", t: 14, date: new Date(2027, 0, 15),
    bal: 16080, target: 0, pass: true, gap: 16080, ...over,
  });
  const spec = (rows) => buildChart("ms.runway", doc, { ...parts(doc), msWithBal: rows });

  it("rings a date that is SOLVENT on the day but stranded before it", () => {
    // The case that started all of this: $16,080 in the bank, and the company does not get there.
    const s = spec([base({ stranded: true, bridge: 37851 })]);
    expect(s.rows[0].stranded).toBe(true);
    expect(s.rows[0].negative).toBe(false);
    expect(s.rows[0].bridge).toBe(37851);
  });

  it("keeps the dot green while the ring is red", () => {
    // Two facts, two marks. `negative` drives the fill; `stranded` drives the ring.
    const s = spec([base({ stranded: true, bridge: 1000 })]);
    expect(s.rows[0].negative).toBe(false);
  });

  it("does not call a stranded date 'short of target'", () => {
    // Two verdicts on one row. A date the company never reaches is not short, it is not happening.
    const s = spec([base({ stranded: true, bridge: 500, target: 250000, gap: -233920 })]);
    expect(s.rows[0].short).toBe(false);
  });

  it("leaves everything alone when nothing is stranded", () => {
    const s = spec([base({ stranded: false, bridge: 0 })]);
    expect(s.rows[0].stranded).toBe(false);
    expect(s.rows[0].bridge).toBeNull();
    expect(s.note).toMatch(/Every date is reached|short of the target/);
  });
});

describe("goals — each phase against its own solvency", () => {
  const doc = demoDoc();
  const withPost = (over = {}) => ({
    ...doc,
    rounds: (doc.rounds || []).map(r => (r.kind === "equity" && r.status !== "closed"
      ? { ...r, goals: [...(r.goals || []), {
          id: "pg1", label: "Scale to 50 kW", kind: "technical",
          dueMonth: (r.closeMonth ?? 8) + 6, status: "not-started", phase: "post", ...over,
        }] }
      : r)),
  });

  it("measures post-raise goals against the FINANCING-INCLUDED speculative runway", () => {
    // The money the round creates is what pays for them, so excluding it would judge them against a
    // runway that was never the plan. With a $6m round the financed runway outlasts the horizon, so a
    // post-raise goal well after the close is not stranded.
    const d = withPost();
    const s = buildChart("inv.goals", d, parts(d));
    expect(s.post).toHaveLength(1);
    expect(s.post[0].stranded).toBe(false);
    expect(s.afterRoundEndless || s.afterRound > s.cashOut).toBe(true);
  });

  it("still strands PRE-raise goals against the unfinanced runway", () => {
    const d = withPost();
    const s = buildChart("inv.goals", d, parts(d));
    const stranded = s.pre.filter(r => r.stranded);
    expect(stranded.length).toBeGreaterThan(0);
    for (const r of stranded) expect(r.bridge).toBeGreaterThan(0);
  });

  it("grows the bridge with distance, so goals are not all equally doomed", () => {
    // One global number would make every goal after the crossing look the same. Per-goal, a goal two
    // months out and one six months out are different problems.
    const d = withPost();
    const s = buildChart("inv.goals", d, parts(d));
    const bridges = s.pre.filter(r => r.bridge).map(r => r.bridge);
    if (bridges.length > 1) {
      expect(bridges[bridges.length - 1]).toBeGreaterThanOrEqual(bridges[0]);
    }
  });

  it("says when a post-raise goal is stranded by a PRE-ROUND hole", () => {
    // A different sentence: the money that pays for it never arrives, because the company does not
    // reach the close. Same flag would have read as "the round was not enough".
    const d = withPost();
    const s = buildChart("inv.goals", d, parts(d));
    for (const r of s.post) {
      if (r.strandedBeforeRound) expect(r.stranded).toBe(true);
      expect(typeof r.strandedBeforeRound).toBe("boolean");
    }
  });

  it("keeps misfiling separate from stranding", () => {
    // A goal can be filed in the wrong phase AND unreachable; they are different fixes and must not
    // collapse into one mark.
    const d = withPost();
    const s = buildChart("inv.goals", d, parts(d));
    for (const r of s.rows) {
      expect(typeof r.misfiled).toBe("boolean");
      expect(typeof r.stranded).toBe("boolean");
    }
  });
});
