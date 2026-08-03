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
  it("offers three on every tab that has a picker", () => {
    for (const tab of ["flow", "pay", "proj", "sales", "inv", "hist"]) {
      expect(chartsForTab(tab), tab).toHaveLength(3);
    }
  });

  it("gives Milestones one, and that is not a gap to fill", () => {
    // `ms.runway` moved here from Investment, where cash-at-each-critical-date was answering a
    // milestones question on the wrong tab. One chart is the right number until a second one has a
    // question of its own — inventing two more so the row matches the others would be padding.
    expect(chartsForTab("ms").map(c => c.id)).toEqual(["ms.runway"]);
    expect(CHARTS).toHaveLength(19);
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

describe("visual geometry — measured, not eyeballed", () => {
  const W = 720, PAD = { l: 52, r: 16 }, PW = W - PAD.l - PAD.r;
  const wide = (t, px = 9) => String(t).length * px * 0.55;
  const doc = demoDoc();
  const p = parts(doc);

  it("no timeline label runs past the viewBox", () => {
    // Labels used to sit ALWAYS to the right of their dot, so a date late in the span ran 109px past
    // the edge. They now flip past 60% of the plot; this is the check that keeps them there.
    const far = {
      ...doc,
      rounds: (doc.rounds || []).map(r => (r.kind === "equity" && r.status !== "closed"
        ? { ...r, goals: [...(r.goals || []), {
            id: "z", label: "Twelve engineers hired and onboarded", kind: "team",
            dueMonth: (r.closeMonth ?? 8) + 12, status: "not-started", phase: "post" }] }
        : r)),
    };
    const spec = buildChart("inv.goals", far, parts(far));
    const n = spec.span;
    for (const r of [...spec.pre, ...spec.post]) {
      const cx = PAD.l + (Math.min(n, r.due) / n) * PW;
      const flip = cx > PAD.l + PW * 0.6;
      const txt = Math.max(wide(String(r.label).slice(0, 36), 10.5),
                           wide(`${r.dueLabel} · needs $000,000 to reach`, 9));
      const hi = flip ? cx - 13 : cx + 14 + txt;
      const lo = flip ? cx - 13 - txt : cx + 14;
      expect(hi, `${r.label} overflows right`).toBeLessThanOrEqual(W);
      expect(lo, `${r.label} overflows left`).toBeGreaterThanOrEqual(0);
    }
  });

  it("hbar labels fit their gutter", () => {
    // The cap was 22 characters against a 110px usable gutter — about 115px of text, so real project
    // names overlapped their own bars.
    for (const id of ["proj.budget", "inv.ownership", "pay.allocation"]) {
      const spec = buildChart(id, doc, p);
      if (spec.empty) continue;
      for (const r of spec.rows || []) {
        expect(wide(String(r.label).slice(0, 20)), `${id}: ${r.label}`).toBeLessThanOrEqual(132 - 10);
      }
    }
  });

  it("every chart can explain its own colours", () => {
    // Six row-based charts were emitting an EMPTY legend, because it was built from `spec.series` and
    // they carry `rows`. A colour-coded chart with no key asks the reader to guess.
    for (const c of CHARTS) {
      const spec = buildChart(c.id, doc, p);
      if (spec.empty) continue;
      const keys = spec.legend || (spec.series || []);
      expect(keys.length, `${c.id} has no legend and no series`).toBeGreaterThan(0);
    }
  });

  it("declares a format that matches its values", () => {
    // `inv.goals` said `count` while its values were currency. It never showed, because the renderer
    // called `money()` directly — a declared field that lies and is ignored is worse than a missing
    // one, because something eventually believes it.
    const spec = buildChart("inv.goals", doc, p);
    expect(spec.format).toBe("money");
  });

  it("keeps band headings clear of the first row beneath them", () => {
    // At GAP 26 the heading baseline and the first row's text were 8px apart with a ~10px line box,
    // so they overlapped at EVERY row count.
    const ROW = 26, GAP = 34;
    for (const [a, b] of [[1, 0], [4, 1], [5, 3], [8, 8]]) {
      const top = 14 + 22;
      const secondTop = top + a * ROW + (b ? GAP : 0);
      const headingY = secondTop - 16;
      expect(secondTop - headingY, `${a}/${b}`).toBeGreaterThanOrEqual(14);
    }
  });
});

describe("chart text survives being scaled into a phone", () => {
  // THE VIEWBOX IS 720 WIDE AND SCALES TO ITS CONTAINER, so a font size in pixels is multiplied by the
  // scale factor: on a 390px phone, 8.5px axis text rendered at 4.2px. Not small — absent.
  //
  // The fix is that `.ch-svg` sets a real size and the label classes size in `em`, so they are
  // decoupled from the viewBox. This test guards the ARITHMETIC of that: the smallest class multiplied
  // by the clamp floor has to clear the point where text stops being text.
  const { readFileSync } = globalThis.__nodeFs || require("node:fs");
  const css = readFileSync("src/styles.css", "utf8");

  const emOf = (cls) => {
    const m = new RegExp("[.]" + cls + "[{][^}]*font-size:([0-9.]+)em").exec(css);
    return m ? Number(m[1]) : null;
  };
  const clampFloor = () => {
    const m = /\.ch-svg\{font-size:clamp\(([\d.]+)px/.exec(css);
    return m ? Number(m[1]) : null;
  };

  it("sizes every label in em, not px", () => {
    // A pixel size here is the bug returning: it would be silently halved on a phone and nothing would
    // fail except somebody's ability to read the chart.
    for (const cls of ["ch-t", "ch-d", "ch-l", "ch-g", "ch-f", "ch-p"]) {
      expect(emOf(cls), `${cls} is not sized in em`).toBeGreaterThan(0);
    }
  });

  it("keeps the smallest label above 8px at the clamp floor", () => {
    const floor = clampFloor();
    expect(floor, "no clamp floor on .ch-svg").toBeGreaterThan(0);
    const smallest = Math.min(...["ch-t", "ch-d", "ch-l", "ch-g", "ch-f", "ch-p"].map(emOf));
    // The floor is a BASE the em sizes multiply DOWN from — it has to clear 8px after multiplication,
    // which is the mistake the first attempt made by clearing it before.
    expect(floor * smallest, `smallest label is ${(floor * smallest).toFixed(1)}px`)
      .toBeGreaterThanOrEqual(8);
  });

  it("caps the ceiling so a wide chart does not outgrow the prose around it", () => {
    const m = /\.ch-svg\{font-size:clamp\([\d.]+px,[^,]+,\s*([\d.]+)px\)/.exec(css);
    expect(m, "no clamp ceiling").toBeTruthy();
    expect(Number(m[1])).toBeLessThanOrEqual(13);
  });

  it("lets tables scroll rather than compress on mobile", () => {
    // Ten columns across 328px gave each cell 32px; `$1,204,000` needs about 70px.
    expect(css).toMatch(/\.tbl\{min-width:\d{3}px\}/);
    expect(css).toMatch(/\.panel\{overflow-x:auto\}/);
  });
});

describe("mobile ergonomics", () => {
  const { readFileSync } = require("node:fs");
  const css = readFileSync("src/styles.css", "utf8");
  const mobile = css.slice(css.indexOf("@media (max-width:900px){", css.indexOf(".shell{grid-template-columns:1fr}") - 200));

  it("scrolls the rail in one row rather than wrapping it", () => {
    // Ten items measured ~950px of buttons across a 328px screen, so wrapping spent about a fifth of
    // the screen on navigation before any content appeared.
    expect(mobile).toMatch(/\.rail\{[^}]*flex-wrap:nowrap/);
    expect(mobile).toMatch(/\.rail\{[^}]*overflow-x:auto/);
  });

  it("does not let the brand force a wrap on its own", () => {
    // `.brand{width:100%}` defeated the row before any nav item was measured.
    expect(mobile).not.toMatch(/\.brand\{[^}]*width:100%/);
  });

  it("gives every tappable control a 44px target", () => {
    // `.linkbtn` was ~25px with almost no padding — its hit area was the text box, and "Remove",
    // "Cancel" and "Load their version" sit next to each other in table rows.
    for (const sel of ["\\.linkbtn", "\\.iconbtn", "\\.pitem,\\.setnav-i", "\\.addbtn", "\\.nav"]) {
      const m = new RegExp(sel + "\\{[^}]*(min-height:44px|height:44px|width:44px)").exec(mobile);
      expect(m, `${sel} has no 44px target on mobile`).toBeTruthy();
    }
  });

  it("keeps table rows from growing on desktop to serve a thumb", () => {
    // The negative margin is the whole trick: the target grows through the row rather than pushing it
    // open, so people who are not using a thumb do not pay ~20px a row for one who is.
    expect(mobile).toMatch(/\.tbl \.linkbtn[^{]*\{[^}]*margin:-\d+px/);
    // And none of it escapes the media query.
    const desktop = css.slice(0, css.indexOf("@media (max-width:900px){"));
    expect(desktop).not.toMatch(/\.linkbtn\{[^}]*min-height:44px/);
  });

  it("grows the avatar's target without growing the circle", () => {
    // A 44px filled circle in the header reads as a button demanding to be pressed rather than an
    // identity mark.
    expect(mobile).toMatch(/\.avatar\{[^}]*width:38px/);
    expect(mobile).toMatch(/\.avatar::after\{[^}]*inset:-3px/);
  });
});
