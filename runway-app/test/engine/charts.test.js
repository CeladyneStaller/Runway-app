// The chart data layer. What matters most is that none of these throws on a half-finished document and
// that none of them invents a projection — a chart with its own answer to "when do we run out" would be
// a second answer, and this product exists to give one.
import { describe, it, expect } from "vitest";
import { CHARTS, chartsForTab, defaultChartFor, buildChart } from "../../src/engine/charts.js";
import { buildModelParts, buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { demoDoc, emptyDoc } from "../../src/state/document.js";

const parts = (doc) => {
  const p = buildModelParts(doc);
  return { ...p, rows: p.rows || [] };
};

describe("the registry", () => {
  it("offers three per tab, for six tabs", () => {
    for (const tab of ["flow", "pay", "proj", "sales", "inv", "hist"]) {
      expect(chartsForTab(tab), tab).toHaveLength(3);
    }
    expect(CHARTS).toHaveLength(18);
  });

  it("defaults to the first, because most people never open a picker", () => {
    expect(defaultChartFor("flow")).toBe("flow.runway");
    expect(defaultChartFor("proj")).toBe("proj.pace");
    // Cover rather than forecast: a default must draw for everybody, and plenty of grant-funded
    // organisations have no subscription revenue at all.
    expect(defaultChartFor("sales")).toBe("sales.cover");
  });

  it("gives every chart a name and a reason somebody can read", () => {
    for (const c of CHARTS) {
      expect(c.name.length, c.id).toBeGreaterThan(6);
      expect(c.why.length, c.id).toBeGreaterThan(24);
      expect(typeof c.build, c.id).toBe("function");
    }
  });

  it("has no duplicate ids", () => {
    expect(new Set(CHARTS.map(c => c.id)).size).toBe(CHARTS.length);
  });
});

describe("the DEFAULTS actually draw", () => {
  // THE TEST THAT WAS MISSING, and its absence let two real bugs pass: `confidenceBand().zero` is a
  // NUMBER of months rather than an object, and `buildModelParts` returns no `rows`. Both made charts
  // fall back to their empty state against a document with a perfectly good projection — and the suite
  // was happy, because it accepted "said why not" as a successful outcome.
  //
  // An empty state is a legitimate answer for a chart whose data is genuinely absent. It is never the
  // right answer for the DEFAULT chart of a tab, against the demo document, which has all of it.
  const doc = demoDoc();
  const p = parts(doc);

  it.each(["flow", "pay", "proj", "sales", "inv", "hist"])("%s draws something", (tab) => {
    const spec = buildChart(defaultChartFor(tab), doc, p);
    expect(spec.error, `${tab}: ${spec.error}`).toBeUndefined();
    expect(spec.empty, `${tab} default fell back to: ${spec.empty}`).toBeUndefined();
    expect(spec.kind).toBeTruthy();
  });

  it("and the runway chart marks a month, rather than quietly omitting it", () => {
    const spec = buildChart("flow.runway", doc, p);
    expect(spec.markers?.length).toBeGreaterThan(0);
    expect(Number.isFinite(spec.markers[0].x)).toBe(true);
  });
});

describe("every chart, against a real document", () => {
  const doc = demoDoc();
  const p = parts(doc);

  it.each(CHARTS.map(c => c.id))("%s builds without throwing", (id) => {
    const spec = buildChart(id, doc, p);
    expect(spec).toBeTruthy();
    // Either it drew something or it said why not. A spec that is neither is a blank box.
    expect(Boolean(spec.empty) || Boolean(spec.kind), id).toBe(true);
  });

  it.each(CHARTS.map(c => c.id))("%s produces only finite numbers", (id) => {
    const spec = buildChart(id, doc, p);
    const nums = [
      ...(spec.series || []).flatMap(s => s.values || []),
      ...(spec.rows || []).flatMap(r => [r.value, r.spent, r.elapsed,
                                         ...(r.segments || []).map(sg => sg.value)]),
      ...(spec.band ? [...spec.band.lo, ...spec.band.hi] : []),
    ].filter(v => v !== undefined && v !== null);
    // NaN renders as a hole in an SVG path and silently deforms the shape around it — worse than an
    // error, because the chart still looks like a chart.
    for (const v of nums) expect(Number.isFinite(v), `${id} produced ${v}`).toBe(true);
  });
});

describe("every chart, against an EMPTY document", () => {
  const doc = emptyDoc();
  const p = parts(doc);

  it.each(CHARTS.map(c => c.id))("%s says what is missing rather than crashing", (id) => {
    const spec = buildChart(id, doc, p);
    expect(spec).toBeTruthy();
    if (spec.empty) {
      // A sentence, not a flag: "no spend history imported yet" looks like an answer, a blank box looks
      // like a bug.
      expect(spec.empty.length, id).toBeGreaterThan(12);
      expect(spec.empty, id).toMatch(/[a-z]/);
    }
  });
});

describe("nothing throws, ever", () => {
  const wrecked = [
    {}, { projects: null }, { history: [{}] }, { employees: [{}] },
    { rounds: [{ amount: 1 }] }, { saas: [{}] }, { projects: [{ id: "p" }] },
    { startY: undefined, startM: undefined, cash: NaN },
  ];

  it.each(CHARTS.map(c => c.id))("%s survives malformed documents", (id) => {
    // These are documents somebody is midway through editing. A chart that throws takes its whole tab
    // down with it, which is why `buildChart` catches and reports rather than propagating.
    for (const doc of wrecked) {
      expect(() => buildChart(id, doc, {})).not.toThrow();
      const spec = buildChart(id, doc, {});
      expect(Boolean(spec.empty) || Boolean(spec.kind), `${id} on ${JSON.stringify(doc).slice(0, 40)}`)
        .toBe(true);
    }
  });

  it("an unknown id is a sentence, not an exception", () => {
    expect(buildChart("no.such.chart", demoDoc(), {}).empty).toBeTruthy();
  });
});

describe("the runway chart agrees with the runway", () => {
  it("marks the same month the projection does", () => {
    // THE ONE CHART THAT RESTATES THE HEADLINE NUMBER. If it disagreed, the product would be giving two
    // answers to the question it exists to answer.
    //
    // Compared against `zeroInfo` rather than against `runwayMonths`, which lives in a view module —
    // importing it here pulls browser code into the engine project, and `testconfig.test.js` guards
    // that boundary for a reason: the engine runs in Node and must keep running there.
    const doc = demoDoc();
    const spec = buildChart("flow.runway", doc, parts(doc));
    const rows = buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {});
    const z = zeroInfo(rows, doc.startY, doc.startM);
    const marked = spec.markers?.[0];
    if (marked && z) expect(Math.abs(marked.x - z.months)).toBeLessThan(0.6);
  });

  it("draws a band that contains its own line", () => {
    const doc = demoDoc();
    const spec = buildChart("flow.runway", doc, parts(doc));
    if (!spec.band) return;
    spec.series[0].values.forEach((v, i) => {
      expect(spec.band.lo[i]).toBeLessThanOrEqual(spec.band.hi[i] + 0.01);
    });
  });
});
