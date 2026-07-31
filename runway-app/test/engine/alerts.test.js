// Alerts and lenses. The interesting assertions are about restraint: an alert module that fires
// generously becomes wallpaper within a week, and a lens that invents a difference is worse than no
// lens at all.
import { describe, it, expect } from "vitest";
import { alertsFor, ALL_RULES } from "../../src/engine/alerts.js";
import { LENSES, lensFor, chartIdFor, applyLens } from "../../src/engine/lenses.js";
import { buildChart, defaultChartFor } from "../../src/engine/charts.js";
import { buildModelParts } from "../../src/engine/buildmodel.js";
import { demoDoc, emptyDoc } from "../../src/state/document.js";

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
    // A goal past the cash cannot be reached at all. A goal past the CLOSE was meant to justify a
    // round that will already have happened. Different fixes, so different flags.
    const spec = buildChart("inv.goals", doc, p);
    for (const r of spec.rows) {
      expect(typeof r.beyondCash).toBe("boolean");
      expect(r.afterClose).toBe(r.due > r.close);
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
    const spec = buildChart("ms.runway", demoDoc(), {
      msWithBal: [{ label: "Series A close", bal: 250000, pass: true },
                  { label: "Board meeting", bal: -12000, pass: false }],
    });
    expect(spec.kind).toBe("bars");
    expect(spec.series[0].tones).toEqual(["signal", "danger"]);
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
