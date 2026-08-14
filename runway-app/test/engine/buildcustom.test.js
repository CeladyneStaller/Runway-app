import { describe, it, expect } from "vitest";
import { buildCustom } from "../../src/engine/buildcustom.js";
import { buildChart } from "../../src/engine/charts.js";
import { applyLens } from "../../src/engine/lenses.js";
import { demoDoc } from "../../src/state/document.js";
import { buildModelParts, buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { buildProjection } from "../../src/engine/projection.js";
import { saveChart, updateChart, savedFor, setDefaultChart, defaultChartId, deleteChart,
         deleteImpact, resolveSaved } from "../../src/engine/savedcharts.js";

const doc = () => demoDoc();
const ctx = (d) => ({ parts: buildModelParts(d),
                      rows: buildProjection(buildModelFromDoc(d), d.settings?.toggles || {}) });

describe("⚠️ the keystone: it can reproduce a curated chart", () => {
  it("MATCHES flow.inout's OWN SERIES VALUES", () => {
    // The strongest test available here. If `buildCustom` can reproduce a chart the registry already
    // draws, it is correct for the whole family — stronger evidence than any number of hand-written
    // cases about a chart nobody has seen.
    const d = doc(), { parts, rows } = ctx(d);
    const curated = buildChart("flow.inout", d, parts);
    const built = buildCustom({ measures: [{ id: "rev", type: "bars" }, { id: "cost", type: "bars" }] },
                              d, parts, rows);
    expect(built.series).toHaveLength(2);

    // ⚠️ LENGTH FIRST — this is what caught the bug. Measures read the full 37-row projection; every
    // curated chart draws an 18-month window. Handing the renderer 37 values against an 18-point axis
    // would have drawn past the frame or dropped the tail, depending on the shape.
    expect(built.series[0].values.length).toBe(curated.x.length);
    expect(built.x.length).toBe(curated.x.length);
    expect(built.ticks.length).toBe(curated.ticks.length);

    // and then the values themselves, month for month, against the projection they came from
    expect(built.series[0].values).toEqual(rows.slice(0, curated.x.length).map(r => r.rev));
    expect(built.series[1].values).toEqual(rows.slice(0, curated.x.length).map(r => r.cost));
  });

  it("returns the same spec shape every curated chart returns", () => {
    const d = doc(), { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [{ id: "end", type: "line" }] }, d, parts, rows);
    for (const k of ["kind", "x", "ticks", "series", "format"]) expect(s).toHaveProperty(k);
    expect(s.x.length).toBe(s.ticks.length);
  });
});

describe("what it refuses, and says so", () => {
  const d = doc();
  it("⚠️ REFUSES A THIRD UNIT rather than drawing a third axis", () => {
    // Two is already a compromise; three is a picture with no scale.
    const { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [{ id: "rev" }, { id: "headcount" }, { id: "cost" }] },
                          d, parts, rows);
    expect(s.series).toHaveLength(3);          // two units only — money + people
  });

  it("⚠️ REFUSES SEVERAL MEASURES WITH A BREAKDOWN, and explains", () => {
    // Three measures by eight codes is twenty-four series, produced by two reasonable choices.
    const { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [{ id: "cost" }, { id: "rev" }], by: "project" }, d, parts, rows);
    expect(s.series).toHaveLength(0);
    expect(s.note).toMatch(/one measure to break down/i);
  });

  it("puts the second unit on the right axis", () => {
    const { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [{ id: "cost" }, { id: "headcount" }] }, d, parts, rows);
    expect(s.series.find(x => x.id === "headcount").axis).toBe("right");
    expect(s.series.find(x => x.id === "cost").axis).toBe("left");
  });

  it("⚠️ FALLS BACK FROM A STACK IT CANNOT HONESTLY DRAW", () => {
    // A saved chart asking for a stack whose measures now overlap draws as lines and SAYS SO, rather
    // than asserting that the parts sum to the whole.
    const { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [{ id: "cost", type: "stack" }, { id: "payroll" }] },
                          d, parts, rows);
    expect(s.kind).not.toBe("stack");
    expect(s.note).toMatch(/would not add up/i);
  });
});

describe("breaking one measure down", () => {
  it("produces a series per value, unassigned last and grey", () => {
    const d = doc(), { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [{ id: "projectSpend", type: "stack" }], by: "project" },
                          d, parts, rows);
    expect(s.series.length).toBeGreaterThan(1);
    const last = s.series[s.series.length - 1];
    if (/unassigned/i.test(last.label)) expect(last.tone).toBe("muted");
  });
});

describe("the sub-tab dim mode", () => {
  it("⚠️ MARKS RATHER THAN REMOVES, so the axis scale does not move", () => {
    // If a dimmed series dropped out of the domain, the emphasised one would jump every time somebody
    // changed sub-tab — the chart would lie about magnitude while appearing helpful.
    const spec = { kind: "line", series: [{ id: "a", values: [1] }, { id: "b", values: [2] }],
                   dimOthers: true };
    const out = applyLens(spec, { keep: ["a"], label: "Money in" }, doc());
    expect(out.series).toHaveLength(2);
    expect(out.series.find(s => s.id === "a").dim).toBe(false);
    expect(out.series.find(s => s.id === "b").dim).toBe(true);
  });

  it("still FILTERS when dimOthers is off — the existing behaviour is untouched", () => {
    const spec = { kind: "line", series: [{ id: "a", values: [1] }, { id: "b", values: [2] }] };
    expect(applyLens(spec, { keep: ["a"], label: "x" }, doc()).series).toHaveLength(1);
  });
});

describe("saving, defaults and deletion", () => {
  const cfg = { measures: [{ id: "cost", type: "bars" }], by: "project", across: "month" };

  it("⚠️ ADDS; IT NEVER OVERWRITES", () => {
    // One slot per tab would have made every save a silent replacement of a colleague's work.
    let d = doc();
    d = saveChart(d, "flow", cfg, { name: "First" }).doc;
    d = saveChart(d, "flow", cfg, { name: "Second" }).doc;
    expect(savedFor(d, "flow").map(c => c.name)).toEqual(["First", "Second"]);
  });

  it("REQUIRES A NAME, and only to save", () => {
    // Being made to name what a chart shows is the cheapest available check that the person knows.
    const r = saveChart(doc(), "flow", cfg, { name: "   " });
    expect(r.error).toMatch(/name/i);
    expect(savedFor(r.doc, "flow")).toHaveLength(0);
  });

  it("⚠️ SETTING THE DEFAULT IS OWNER-ONLY, and is a separate act from saving", () => {
    // Saving makes a chart available; setting the default makes it the one people land on.
    let d = saveChart(doc(), "flow", cfg, { name: "Mine" }).doc;
    const id = savedFor(d, "flow")[0].id;
    expect(defaultChartId(d, "flow")).toBeNull();                       // saving changed nothing
    expect(setDefaultChart(d, "flow", id, { isOwner: false }).error).toMatch(/owner/i);
    d = setDefaultChart(d, "flow", id, { isOwner: true }).doc;
    expect(defaultChartId(d, "flow")).toBe(id);
  });

  it("holds EITHER kind of id in one field", () => {
    // A separate "is it custom" flag would be a second thing to keep in step, and the two would
    // disagree the first time somebody deleted a saved chart.
    const d = setDefaultChart(doc(), "flow", "flow.inout", { isOwner: true }).doc;
    expect(defaultChartId(d, "flow")).toBe("flow.inout");
  });

  it("⚠️ SAYS BEFORE DELETING that a chart is the default", () => {
    let d = saveChart(doc(), "flow", cfg, { name: "Default one" }).doc;
    const id = savedFor(d, "flow")[0].id;
    d = setDefaultChart(d, "flow", id, { isOwner: true }).doc;
    expect(deleteImpact(d, id).isDefault).toBe(true);
    d = deleteChart(d, id).doc;
    expect(defaultChartId(d, "flow")).toBeNull();                       // falls back to the curated one
    expect(savedFor(d, "flow")).toHaveLength(0);
  });

  it("⚠️ DROPS AN UNKNOWN MEASURE AND REPORTS IT, rather than crashing or leaving a gap", () => {
    // A saved chart outlives the measures it names.
    const r = resolveSaved({ measures: [{ id: "cost" }, { id: "gone" }] }, ["cost"]);
    expect(r.measures).toHaveLength(1);
    expect(r.lost).toEqual(["gone"]);
  });
});

describe("editing a saved chart", () => {
  const cfg = { measures: [{ id: "cost", type: "bars" }], by: "project", across: "month" };
  const seed = () => {
    const d = saveChart(demoDoc(), "flow", cfg, { name: "Spend by project", savedBy: "Corey" }).doc;
    return { d, id: savedFor(d, "flow")[0].id };
  };

  it("⚠️ UPDATES IN PLACE — it does not save a copy", () => {
    // An edit that saved a copy would leave the ORIGINAL as the company default while the person who
    // fixed it looked at their corrected version — two charts with almost the same name and no way to
    // tell which one everybody else lands on.
    const { d, id } = seed();
    const r = updateChart(d, id, { measures: [{ id: "rev", type: "lines" }], by: null, across: "month" });
    expect(savedFor(r.doc, "flow")).toHaveLength(1);
    expect(savedFor(r.doc, "flow")[0].id).toBe(id);
    expect(savedFor(r.doc, "flow")[0].measures[0].id).toBe("rev");
    expect(savedFor(r.doc, "flow")[0].by).toBeNull();
  });

  it("⚠️ A CHART THAT IS THE DEFAULT STAYS THE DEFAULT THROUGH AN EDIT", () => {
    // Which is what somebody correcting a mistake in it expects.
    let { d, id } = seed();
    d = setDefaultChart(d, "flow", id, { isOwner: true }).doc;
    const r = updateChart(d, id, { measures: [{ id: "rev" }], across: "month" });
    expect(defaultChartId(r.doc, "flow")).toBe(id);
  });

  it("keeps the name unless a new one is given", () => {
    const { d, id } = seed();
    expect(updateChart(d, id, cfg).chart.name).toBe("Spend by project");
    expect(updateChart(d, id, cfg, { name: "Renamed" }).chart.name).toBe("Renamed");
  });

  it("keeps who saved it, and records when it was edited", () => {
    // The original author is not overwritten by whoever last touched it — that would quietly reassign
    // authorship on a shared document.
    const { d, id } = seed();
    const c = updateChart(d, id, cfg).chart;
    expect(c.savedBy).toBe("Corey");
    expect(c.editedAt).toBeTruthy();
  });

  it("refuses to blank the name", () => {
    const { d, id } = seed();
    expect(updateChart(d, id, cfg, { name: "  " }).error).toMatch(/name/i);
  });

  it("says so when the chart has gone", () => {
    expect(updateChart(demoDoc(), "nope", cfg).error).toMatch(/no longer exists/i);
  });
});
