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
    const built = buildCustom({ measures: [{ id: "rev", shape: "bars" }, { id: "cost", shape: "bars" }] },
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
    const s = buildCustom({ measures: [{ id: "end", shape: "lines" }] }, d, parts, rows);
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

  it("⚠️ ALLOWS SEVERAL MEASURES WITH BREAKDOWNS — the refusal is gone, and that is the feature", () => {
    // It used to refuse: one breakdown applied to the whole chart, so a split measure and an unsplit
    // one could not coexist. **`by` is per dataset now**, which is what makes "spend split by project,
    // with cash over it" describable at all.
    const { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [
      { id: "projectSpend", by: "project", shape: "bars", stacked: true },
      { id: "end", shape: "lines" },
    ] }, d, parts, rows);
    expect(s.series.length).toBeGreaterThan(1);
    // the split measure's series carry its group; the balance stands alone as a line
    expect(s.series.some(x => x.group === "projectSpend" && x.stacked)).toBe(true);
    expect(s.series.find(x => x.id === "end").shape).toBe("lines");
    expect(s.series.find(x => x.id === "end").stacked).toBe(false);
  });

  it("⚠️ CAPS ON THE TOTAL, because two split datasets multiply", () => {
    // Two datasets each split eight ways is sixteen series from two reasonable choices — the same trap
    // as before, one level up.
    const { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [
      { id: "projectSpend", by: "project" }, { id: "cost", by: "project" },
      { id: "payroll", by: "project" }, { id: "opex", by: "project" },
    ] }, d, parts, rows);
    if (s.series.length === 0) expect(s.note).toMatch(/more than a chart can show/i);
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
    // ⚠️ BOTH MUST BE STACKED FOR THIS TO BE WRONG. Written with only `cost` stacked and payroll as a
    // line, nothing fires — and that is CORRECT under the narrowed rule: a line is not part of the sum,
    // so it cannot double-count a stack it does not join. The refusal is about same-stack containment.
    const s = buildCustom({ measures: [
      { id: "cost", shape: "bars", stacked: true },
      { id: "payroll", shape: "bars", stacked: true },
    ] }, d, parts, rows);
    expect(s.series.every(x => !x.stacked)).toBe(true);
    expect(s.note).toMatch(/would not add up/i);
  });
});

describe("⚠️ a stack and a line together", () => {
  it("KEEPS THE STACK when the overlapping measure is a LINE", () => {
    // In and out stacked against each other with net as a line over them — the most useful chart on
    // the tab, and the old rule refused it because `net contains rev, cost` put all three in the clash
    // set. **A line cannot double-count a stack it does not join.**
    const d = doc(), { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [
      { id: "rev", shape: "bars", stacked: true },
      { id: "cost", shape: "bars", stacked: true, negate: true },
      { id: "net", shape: "lines", signColor: true },
    ] }, d, parts, rows);
    expect(s.series.find(x => x.id === "rev").stacked).toBe(true);
    expect(s.series.find(x => x.id === "cost").stacked).toBe(true);
    expect(s.series.find(x => x.id === "net").stacked).toBe(false);
    expect(s.note).toBeNull();
  });

  it("and the negated member really is negative", () => {
    const d = doc(), { parts, rows } = ctx(d);
    const s = buildCustom({ measures: [{ id: "cost", negate: true }] }, d, parts, rows);
    expect(s.series[0].values.some(v => v < 0)).toBe(true);
  });
});

describe("breaking one measure down", () => {
  it("produces a series per value, unassigned last and grey", () => {
    const d = doc(), { parts, rows } = ctx(d);
    // `by` MOVED ONTO THE DATASET. Left at chart level it is simply not read, and the measure comes
    // back as one unsplit series — which is what this test caught.
    const s = buildCustom({ measures: [{ id: "projectSpend", by: "project", stacked: true }] },
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
  const cfg = { measures: [{ id: "cost", by: "project", shape: "bars" }], across: "month" };

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
  const cfg = { measures: [{ id: "cost", by: "project", shape: "bars" }], across: "month" };
  const seed = () => {
    const d = saveChart(demoDoc(), "flow", cfg, { name: "Spend by project", savedBy: "Corey" }).doc;
    return { d, id: savedFor(d, "flow")[0].id };
  };

  it("⚠️ UPDATES IN PLACE — it does not save a copy", () => {
    // An edit that saved a copy would leave the ORIGINAL as the company default while the person who
    // fixed it looked at their corrected version — two charts with almost the same name and no way to
    // tell which one everybody else lands on.
    const { d, id } = seed();
    // ⚠️ `by` MOVED ONTO THE DATASET, so a chart-level one is now `undefined` rather than null — which
    // is what this caught. The assertion's intent was that the breakdown CLEARS on update, and that
    // still holds; it just lives on the measure now.
    const r = updateChart(d, id, { measures: [{ id: "rev", shape: "lines" }], across: "month" });
    const back = savedFor(r.doc, "flow");
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(id);
    expect(back[0].measures[0].id).toBe("rev");
    expect(back[0].measures[0].by).toBeNull();          // the seed's "project" breakdown is gone
    expect(back[0].measures[0].shape).toBe("lines");
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

describe("⚠️ saving must not quietly drop what the builder set", () => {
  // This has now happened three times in one session with the same shape: a field is produced, and
  // some consumer along the way copies a hand-written subset that predates it. The renderer ignored
  // `color`; the legend dropped `color`; **saving kept only `{ id, type }` — and `type` was already
  // deleted.** The chart drew correctly right up until it was made permanent.
  const full = {
    across: "month", orient: "x",
    measures: [
      { id: "projectSpend", by: "project", shape: "bars", stacked: true, axis: "left",
        negate: false, signColor: false },
      { id: "net", by: null, shape: "lines", stacked: false, axis: "right",
        negate: true, signColor: true },
    ],
  };

  it("KEEPS EVERY PER-DATASET FIELD through a save", () => {
    const r = saveChart(demoDoc(), "flow", full, { name: "Everything" });
    const back = savedFor(r.doc, "flow")[0];
    for (const [i, m] of full.measures.entries()) {
      for (const k of ["id", "by", "shape", "stacked", "axis", "negate", "signColor"]) {
        expect(back.measures[i][k], `${m.id}.${k} was lost on save`).toEqual(m[k]);
      }
    }
    expect(back.across).toBe("month");
    expect(back.orient).toBe("x");
  });

  it("KEEPS THEM THROUGH AN EDIT TOO", () => {
    // `updateChart` had the same hand-written pick, copied from `saveChart`.
    let d = saveChart(demoDoc(), "flow", full, { name: "Everything" }).doc;
    const id = savedFor(d, "flow")[0].id;
    d = updateChart(d, id, full).doc;
    const back = savedFor(d, "flow")[0];
    expect(back.measures[1].negate).toBe(true);
    expect(back.measures[1].signColor).toBe(true);
    expect(back.measures[0].stacked).toBe(true);
  });

  it("⚠️ A SAVED CHART REBUILDS INTO THE SAME SPEC IT WAS SAVED FROM", () => {
    // The round trip is the real assertion: what was drawn before saving must be drawn after.
    const d = demoDoc();
    const parts = buildModelParts(d);
    const rows = buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
    const before = buildCustom(full, d, parts, rows);
    const saved = savedFor(saveChart(d, "flow", full, { name: "Round trip" }).doc, "flow")[0];
    const after = buildCustom(saved, d, parts, rows);
    expect(after.kind).toBe(before.kind);
    expect(after.series.map(s => [s.shape, s.stacked])).toEqual(
      before.series.map(s => [s.shape, s.stacked]));
  });
});

describe("⚠️ the company default must actually decide what is drawn", () => {
  const cfg = { measures: [{ id: "cost", shape: "bars" }], across: "month" };

  it("IS SETTABLE, STORED, AND RESOLVABLE TO A REAL CHART", () => {
    // It was settable, badged in the menu, and consulted by nothing when deciding what to draw. **A
    // preference that is stored, displayed, and ignored is the most convincing kind of broken**,
    // because every visible signal says it worked.
    let d = saveChart(demoDoc(), "flow", cfg, { name: "Ours" }).doc;
    const id = savedFor(d, "flow")[0].id;
    d = setDefaultChart(d, "flow", id, { isOwner: true }).doc;

    // the view resolves in this order: this device's pick, then the company default, then curated
    const chosen = null;                                   // nobody has picked on this device
    const effective = chosen ?? defaultChartId(d, "flow");
    expect(effective).toBe(id);
    expect(savedFor(d, "flow").find(c => c.id === effective)).toBeTruthy();
  });

  it("A DEVICE PICK WINS OVER IT — the default is where you land, not an override", () => {
    let d = saveChart(demoDoc(), "flow", cfg, { name: "Ours" }).doc;
    const id = savedFor(d, "flow")[0].id;
    d = setDefaultChart(d, "flow", id, { isOwner: true }).doc;
    const chosen = "flow.inout";                           // this person picked something else
    expect(chosen ?? defaultChartId(d, "flow")).toBe("flow.inout");
  });

  it("holds a CURATED id just as well, since it is one field", () => {
    const d = setDefaultChart(demoDoc(), "flow", "flow.runway", { isOwner: true }).doc;
    expect(defaultChartId(d, "flow")).toBe("flow.runway");
  });
});

describe("⚠️ across a category — the field that was stored and never read", () => {
  const d = demoDoc();
  const parts = buildModelParts(d);
  const rows = buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});

  it("PLOTS AGAINST THE CATEGORY, not against months", () => {
    // `buildCustom` had ZERO references to `across`. The control offered Month or any dimension, wrote
    // the field, and the engine built a monthly chart regardless — a control that records a choice and
    // changes nothing.
    const s = buildCustom({ across: "project", measures: [{ id: "projectSpend", shape: "bars" }] },
                          d, parts, rows);
    expect(s.series).toHaveLength(1);
    // one value per project, not one per month
    expect(s.series[0].values.length).toBeLessThan(rows.length);
    expect(s.x.length).toBe(s.series[0].values.length);
    expect(s.ticks.length).toBe(s.x.length);
    // and the ticks are names, not months
    expect(s.ticks.every(t => typeof t.label === "string")).toBe(true);
  });

  it("EACH VALUE IS THE TOTAL ACROSS THE WINDOW", () => {
    const monthly = buildCustom({ measures: [{ id: "projectSpend" }] }, d, parts, rows);
    const byCat = buildCustom({ across: "project", measures: [{ id: "projectSpend" }] }, d, parts, rows);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    expect(sum(byCat.series[0].values)).toBeCloseTo(sum(monthly.series[0].values), 0);
  });

  it("⚠️ Y ORIENTATION EMITS `rows`, WHICH IS WHAT HBars TAKES", () => {
    // The Y toggle drew a blank chart: it asked for `hbars` and handed it a monthly SERIES list.
    // `HBars` reads `spec.rows` — a different contract entirely.
    const s = buildCustom({ across: "project", orient: "y",
                            measures: [{ id: "projectSpend" }] }, d, parts, rows);
    expect(s.kind).toBe("hbars");
    expect(Array.isArray(s.rows)).toBe(true);
    expect(s.rows.length).toBeGreaterThan(0);
    // ⚠️ ROWS CARRY `segments`, A LIST — the renderer's own contract. `{ label, value }` was invented
    // and threw on `r.segments.reduce`.
    expect(s.rows[0]).toHaveProperty("label");
    expect(Array.isArray(s.rows[0].segments)).toBe(true);
    expect(s.rows[0].segments[0]).toHaveProperty("value");
  });

  it("⚠️ SHOWS EVERY MEASURE — the one-measure limit was mine, not the renderer's", () => {
    // A row carries `segments`, a LIST. I read that field, used one element, and wrote a note in the UI
    // explaining why more was impossible. Corey found it by trying the thing the note said not to.
    const s = buildCustom({ across: "project", orient: "y",
                            measures: [{ id: "projectSpend" }, { id: "drawdowns" }] }, d, parts, rows);
    expect(s.rows[0].segments).toHaveLength(2);
    expect(s.note).toBeNull();
  });

  it("says so when nothing is tagged with that dimension", () => {
    const bare = { ...demoDoc(), projects: [], lines: [] };
    const s = buildCustom({ across: "project", measures: [{ id: "projectSpend" }] },
                          bare, buildModelParts(bare), rows);
    if (!s.series.length) expect(s.note).toMatch(/nothing is tagged/i);
  });
});
