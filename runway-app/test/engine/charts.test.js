// The chart data layer. What matters most is that none of these throws on a half-finished document and
// that none of them invents a projection — a chart with its own answer to "when do we run out" would be
// a second answer, and this product exists to give one.
import { describe, it, expect } from "vitest";
import { CHARTS, chartsForTab, defaultChartFor, buildChart } from "../../src/engine/charts.js";
import { buildModelParts } from "../../src/engine/buildmodel.js";
import { canaryDoc as demoDoc, emptyDoc } from "../../src/state/document.js";

const parts = (doc) => {
  const p = buildModelParts(doc);
  return { ...p, rows: p.rows || [] };
};

describe("⚠️ flow.runway — known money, not predicted runway", () => {
  const ALL_ON = { committed: true, expected: true, speculative: true, financing: true };

  it("draws a committed-only line that stays inside its own band", async () => {
    // The line is committed with BASE costs; the floor is committed with costs x(1+cv); the ceiling is
    // committed+expected with costs x(1-cv). The line is therefore bracketed by construction — and this
    // is the property that breaks first if the band definition ever drifts from the line's.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { canaryDoc, demoDoc } = await import("../../src/state/document.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    for (const doc of [canaryDoc(), ...ARCHETYPES.map(a => demoDoc(a.id))]) {
      const sp = buildChart("flow.runway", doc);
      if (!sp?.series) continue;
      sp.series[0].values.forEach((v, i) => {
        if (v == null) return;
        expect(v, `${doc.demoId || "canary"} month ${i} above floor`).toBeGreaterThanOrEqual(sp.band.lo[i] - 0.5);
        expect(v, `${doc.demoId || "canary"} month ${i} below ceiling`).toBeLessThanOrEqual(sp.band.hi[i] + 0.5);
      });
    }
  });

  it("⚠️ NEVER SAYS THE WORD RUNWAY", async () => {
    // Two tabs showing two dates is the design. Two tabs showing two different numbers BOTH called
    // runway is the bug that design replaced. This chart says "committed cash out"; the dashboard owns
    // the word runway. If this fails, the split has stopped being legible and is just a discrepancy.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { canaryDoc, demoDoc } = await import("../../src/state/document.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    for (const doc of [canaryDoc(), ...ARCHETYPES.map(a => demoDoc(a.id))]) {
      const sp = buildChart("flow.runway", doc);
      if (!sp?.series) continue;
      const text = JSON.stringify([sp.basis, sp.markers, sp.series.map(x => x.label)]);
      expect(text, doc.demoId || "canary").not.toMatch(/runway/i);
    }
  });

  it("⚠️ IGNORES THE TIER TOGGLES — it is a definition, not a scenario", async () => {
    // The line used to be `band.expected.rows`, always committed+expected whatever the user had on,
    // while the dashboard followed `doc.settings.toggles`. Turning speculative on moved the dashboard
    // $214,000 and this chart not at all — a divergence with no stated reason. Now the divergence is
    // the point, so it must hold in BOTH directions: switching tiers cannot move this line at all.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { canaryDoc } = await import("../../src/state/document.js");
    const base = canaryDoc();
    const withSpec = { ...base, settings: { ...base.settings, toggles: ALL_ON } };
    const noExp = { ...base, settings: { ...base.settings,
      toggles: { committed: true, expected: false, speculative: false, financing: true } } };
    const a = buildChart("flow.runway", withSpec).series[0].values;
    const b = buildChart("flow.runway", noExp).series[0].values;
    expect(a).toEqual(b);
  });

  it("⚠️ SHOWS A CLOSED ROUND EVEN WITH FINANCING OFF, and never a term sheet", async () => {
    const { buildModelFromDoc } = await import("../../src/engine/buildmodel.js");
    // The financing gate is checked BEFORE the confidence tier, so with the toggle off a CLOSED round
    // vanished — and closed money is banked money. This chart forces `financing: true` and lets the
    // tier filter: `INST_CONF` maps closed -> committed, term sheet -> expected.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { canaryDoc } = await import("../../src/state/document.js");
    const base = canaryDoc();
    const rounds = [
      { id: "closed", name: "Seed", kind: "safe", status: "closed", amount: 500000, closeMonth: 6 },
      { id: "sheet", name: "Bridge", kind: "equity", status: "committed", amount: 400000, closeMonth: 7 },
    ];
    const settings = { ...base.settings, toggles: { ...base.settings.toggles, financing: false } };
    const val = (rs) => buildChart("flow.runway", { ...base, rounds: rs, settings }).series[0].values;
    const none = val([]);
    const closedOnly = val([rounds[0]]);
    const both_ = rounds;
    // the closed SAFE must land despite financing being off — it is banked money
    expect(closedOnly[8]).toBeGreaterThan(none[8]);
    // ⚠️ AND THE TERM SHEET'S MONEY MUST NOT LAND. Asserted at the model, not on the drawn values,
    // because of a SEPARATE leak this chart is the first surface to expose (see NOTES):
    // `indexedLines` sums its basis over EVERY revenue line regardless of tier, then tags the cost
    // `committed` — so a royalty indexed on revenue charges $8,460 instead of $460 once a term sheet
    // exists, and that cost reaches a committed-only view whose revenue excluded it. `both` and
    // `closedOnly` therefore differ by the royalty, not by the round.
    //
    // ⚠️ AND THAT ROYALTY IS ALSO WHY THE CLOSED SAFE MOVES THE LINE $490,000 RATHER THAN $500,000 —
    // 2% of the draw, nothing to do with cost-share matching, which an earlier draft of this comment
    // wrongly blamed. `costSharePct` is 0 on two of the canary's three grants and does not enter here.
    const revLines = (rs) => buildModelFromDoc({ ...base, rounds: rs, settings })
      .lineItems.filter((l) => l.kind === "revenue" && l.confidence === "committed");
    expect(revLines(both_).map((l) => l.label).sort()).toEqual(revLines([rounds[0]]).map((l) => l.label).sort());
    expect(revLines(rounds).some((l) => /Bridge/.test(l.label))).toBe(false);
  });

  it("⚠️ BOUNDS THE BRIDGE TO THE MONTHS IT DRAWS", async () => {
    // On a committed-only line the deficit is unbounded, so `deepest` drifted to the horizon and
    // reported a bridge for a month no chart shows — $3,348,438 at month 36 against an 18-month plot.
    const { solvency, buildProjection, anchorToActuals, forecastFrom } = await import("../../src/engine/projection.js");
    const { buildModelFromDoc } = await import("../../src/engine/buildmodel.js");
    const { buildChart } = await import("../../src/engine/charts.js");
    const { canaryDoc } = await import("../../src/state/document.js");
    const doc = canaryDoc();
    const line = anchorToActuals(
      buildProjection(buildModelFromDoc(doc),
        { committed: true, expected: false, speculative: false, financing: true }),
      doc.cashActuals, true);
    const shown = buildChart("flow.runway", doc).series[0].values.length;
    const from = forecastFrom(doc);
    expect(solvency(line, doc.startY, doc.startM, from, shown - 1).deepest)
      .toBeLessThan(solvency(line, doc.startY, doc.startM, from).deepest);
  });
});

describe("the registry", () => {
  it("offers three on every tab that has a picker", () => {
    // ⚠️ AT LEAST THREE, NOT EXACTLY THREE. A hard count has to be edited every time a tab gains a
    // chart — friction that buys nothing, since what it guards is "every tab with a picker has enough
    // to pick from". Sales now has four; Commitments has two by design.
    for (const tab of ["flow", "pay", "proj", "sales", "inv", "hist"]) {
      expect(chartsForTab(tab).length, tab).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives Milestones one, and that is not a gap to fill", () => {
    // `ms.runway` moved here from Investment, where cash-at-each-critical-date was answering a
    // milestones question on the wrong tab. One chart is the right number until a second one has a
    // question of its own — inventing two more so the row matches the others would be padding.
    expect(chartsForTab("ms").map(c => c.id)).toEqual(["ms.runway"]);
    // ⚠️ NO HARDCODED TOTAL. It has to be bumped every time a chart is added — friction that buys
    // nothing, since what it was really guarding against is a DUPLICATE ID, which this checks directly.
    expect(new Set(CHARTS.map(c => c.id)).size).toBe(CHARTS.length);
  });

  it("defaults to the first, because most people never open a picker", () => {
    // NET FLOW, not the runway line. Cash flow led with the dashboard's question asked twice —
    // somebody who opened this tab has already seen the runway and wants to know what moves it.
    expect(defaultChartFor("flow")).toBe("flow.inout");
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

describe("⚠️ one x-axis window, shared by every forward-looking chart", () => {
  it("the engine's window is the one RunwayChart draws", async () => {
    // `RunwayChart` fitted its window to the crossing and the last milestone; `charts.js` used a flat
    // 18. On the canary that is 12 against 18, so switching tabs changed the horizon under the reader —
    // two charts whose VALUES now agree at every shared month still disagreed about how much future
    // they showed. `chartWindow` is the single copy of the rule; this asserts both callers land on it.
    const { chartWindow, monthsShown } = await import("../../src/engine/charts.js");
    const { buildProjection, zeroInfo, anchorToActuals, forecastFrom, balanceAtDate } =
      await import("../../src/engine/projection.js");
    const { buildModelFromDoc } = await import("../../src/engine/buildmodel.js");
    const { roundMS } = await import("../../src/engine/capital.js");
    const { demoDoc: realDemo } = await import("../../src/state/document.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    for (const doc of [demoDoc(), ...ARCHETYPES.map(a => realDemo(a.id))]) {
      const T = doc.settings?.toggles || {};
      const model = buildModelFromDoc(doc);
      const ca = doc.cashActuals || {};
      const rows = anchorToActuals(buildProjection(model, T), ca, true);
      const up = anchorToActuals(buildProjection(model, { ...T, speculative: true }), ca, true);
      const zeroUp = zeroInfo(up, doc.startY, doc.startM, forecastFrom(doc));
      const ms = [...(doc.milestones || []), ...roundMS(doc.rounds, doc.startY, doc.startM)];
      const lastMsT = Math.max(0, ...ms.map((m) => {
        const b = balanceAtDate(rows, doc.startY, doc.startM, m.y, m.m, m.day);
        return b ? b.t : 0;
      }));
      // what the dashboard computes, from the values it has in hand
      const drawn = chartWindow({
        rowCount: rows.length, zeroUpT: zeroUp?.t || 0, lastMilestoneT: lastMsT, override: null,
      });
      expect(monthsShown(doc), doc.demoId || "canary").toBe(drawn);
    }
  });

  it("every forward-looking month axis is that wide", async () => {
    // ⚠️ HISTORY CHARTS ARE EXCLUDED, AND THAT IS NOT AN EXEMPTION — they are bounded by how many
    // months are RECORDED, which on the canary is 6 (and 4 for the rolling window, which needs three
    // months to produce its first point). A backward-looking chart cannot show 12 months of a past that
    // has 6. The rule is "one window for the future", not "one width for everything".
    const { CHARTS, buildChart, monthsShown } = await import("../../src/engine/charts.js");
    const { demoDoc: realDemo } = await import("../../src/state/document.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    for (const doc of [demoDoc(), ...ARCHETYPES.map(a => realDemo(a.id))]) {
      const w = monthsShown(doc);
      for (const { id } of CHARTS) {
        if (id.startsWith("hist.")) continue;
        let spec;
        try { spec = buildChart(id, doc); } catch { continue; }
        if (!spec || spec.empty || !Array.isArray(spec.x)) continue;
        expect(spec.x.length, `${doc.demoId || "canary"} · ${id}`).toBe(w);
      }
    }
  });

  it("an explicit chartHorizon still overrides the fit", async () => {
    // "Show the full horizon" does not widen a fixed window — it REMOVES the fit, which is a different
    // thing, and the option's wording says so. Clamped to 6..36 exactly as before.
    const { monthsShown } = await import("../../src/engine/charts.js");
    const base = demoDoc();
    const withH = (v) => monthsShown({ ...base, settings: { ...base.settings, chartHorizon: v } });
    expect(withH(24)).toBe(24);
    expect(withH(99)).toBe(36);
    expect(withH(3)).toBe(monthsShown(base));   // below the floor: ignored, fit applies
  });
});

describe("the cash flow chart marks its own line", () => {
  it("⚠️ PUTS THE MARKER WHERE THE DRAWN LINE CROSSES, not where the headline does", () => {
    // ⚠️ THIS TEST ASSERTED THE OPPOSITE, and its comment said so: "the one chart that restates the
    // headline number. If it disagreed, the product would be giving two answers to the question it
    // exists to answer." It now disagrees ON PURPOSE. `RunwayChart` PREDICTS runway from the tiers the
    // user has switched on; this chart shows KNOWN money — a committed-only line whose crossing is a
    // different, usually earlier date. On the canary the marker moved 3.895 -> 5.159: anchoring pushed
    // it later, dropping expected revenue pulled it earlier, and the old assertion measured the sum.
    //
    // Two tabs showing two dates is the design. Two tabs showing two numbers BOTH CALLED RUNWAY was the
    // bug it replaced, which is why `basis` states the difference and a sibling test forbids the word.
    //
    // WHAT MUST STILL HOLD is the property a reader actually checks: the marker sits where the line
    // they can SEE goes under. That is implementation-independent, and it is the thing that was broken
    // — the hole came from one projection while the line came from another, so with speculative on the
    // line dipped underwater and nothing was shaded at all.
    const doc = demoDoc();
    const spec = buildChart("flow.runway", doc, parts(doc));
    const marked = spec.markers?.[0];
    if (!marked) return;
    const v = spec.series[0].values;
    const i = Math.floor(marked.x);
    // A marker in the final drawn month has no next point to interpolate toward. Assert what can be
    // asserted there rather than reading `undefined` and comparing NaN, which passes silently.
    if (v[i + 1] == null) { expect(Math.sign(v[i])).toBeGreaterThanOrEqual(0); return; }
    const at = v[i] + (v[i + 1] - v[i]) * (marked.x - i);
    expect(Math.abs(at), `line at marker x=${marked.x}`).toBeLessThan(1);
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

describe("⚠️ every chart follows the same window", () => {
  const mk = (h) => ({
    settings: h ? { chartHorizon: h } : {}, startY: 2026, startM: 6, cash: 500000,
    employees: [{ id: "e1", name: "D", basis: "annual", amount: 120000, start: 0 }],
    projects: [], lines: [{ id: "l1", label: "R", amount: 5000, kind: "cost",
                            cadence: "recurring", start: 0, end: 35 }],
    pos: [{ id: "po1", customer: "Acme", amount: 40000, bookedMonth: 0, shipMonth: 2,
            confidence: "committed" }],
    rounds: [], history: [],
    saas: [{ id: "s1", name: "Solo", startCustomers: 10, arpu: 40, churnPct: 2,
             newGrowthPct: 9, newPerMonth: 2 }],
  });

  it("DRAWS ONE WIDTH ACROSS THE WHOLE APP, at every horizon", async () => {
    // The runway chart had a settable horizon and everything else was a hardcoded 18 — so asking for
    // 24 months moved one chart and left the rest behind.
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    for (const h of [null, 12, 24, 36]) {
      const doc = mk(h), parts = buildModelParts(doc);
      const widths = new Set();
      for (const c of CHARTS) {
        const s = buildChart(c.id, doc, parts);
        if (s?.empty || !s?.series?.length || !s?.x) continue;
        widths.add(s.x.length);
      }
      expect([...widths], `horizon ${h}`).toHaveLength(1);
      if (h) expect([...widths][0]).toBe(h);
    }
  });

  it("⚠️ KEEPS EVERY SERIES THE SAME LENGTH AS ITS AXIS", async () => {
    // A window that moves the axis and not the values is worse than a fixed one — the same mismatch
    // that put 37 values on an 18-point axis in the builder.
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    for (const h of [null, 24, 36]) {
      const doc = mk(h), parts = buildModelParts(doc);
      for (const c of CHARTS) {
        const s = buildChart(c.id, doc, parts);
        if (s?.empty || !s?.series?.length || !s?.x) continue;
        for (const sr of s.series) {
          if (!sr.values) continue;
          expect(sr.values.length, `${c.id} at horizon ${h}`).toBe(s.x.length);
        }
      }
    }
  });

  it("clamps a nonsense setting rather than trusting it", async () => {
    // ⚠️ A REJECTED OVERRIDE NOW FALLS TO THE FIT, NOT TO A FLAT 18. `monthsShown` used to BE the flat
    // 18; it is now the same adaptive window `RunwayChart` draws, so an out-of-range `chartHorizon`
    // falls back to whatever that document fits — which for a bare doc is the 12-month floor. Asserted
    // against the no-setting case rather than against a literal, because the contract is "an invalid
    // override gets no special number of its own", not "an invalid override gets 18".
    //
    // `null` still returns the flat default: there is no document there to fit.
    const { monthsShown } = await import("../../src/engine/charts.js");
    expect(monthsShown({ settings: { chartHorizon: 999 } })).toBe(36);
    expect(monthsShown({ settings: { chartHorizon: 2 } })).toBe(monthsShown({ settings: {} }));
    expect(monthsShown({ settings: { chartHorizon: 2 } })).not.toBe(2);
    expect(monthsShown(null)).toBe(18);
  });
});

describe("⚠️ a balance series plots the OPENING balance", () => {
  it("starts at cash on hand", async () => {
    // Each projection row carries `start` and `end`, and **`end` of one month IS `start` of the
    // next** — so plotting `end` under a month's label shows that month's CLOSING balance where the
    // company view shows its opening one. **Every value appeared one month early.**
    const { demoDoc } = await import("../../src/state/document.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    for (const id of ["grant-startup", "hardware-vc", "nonprofit", "saas"]) {
      const doc = demoDoc(id);
      const spec = buildChart("flow.runway", doc, buildModelParts(doc));
      expect(Math.round(spec.series[0].values[0]), id).toBe(doc.cash);
    }
  });

  it("⚠️ AGREES WITH `RunwayChart`, which is what the company dashboard draws", async () => {
    // Two renderers of the same number is how they drift. `RunwayChart` plots `r.start`; this is the
    // copy that disagreed, so this is the copy that changed.
    const src = (await import("node:fs")).readFileSync("src/engine/charts.js", "utf8");
    // ⚠️ THE BEHAVIOUR, NOT THE SOURCE TEXT. This asserted a regex over `charts.js` with a 40-character
    // window, and `monthsShown(doc)` replacing `MONTHS_SHOWN` pushed the line to 50 — **the test broke
    // because the code got better, while the thing it protects never changed.**
    //
    // NOTES.md already records "source-file string assertions test prose, not behaviour" as an
    // anti-pattern. This is that anti-pattern failing exactly as described.
    //
    // What actually matters: the chart's first plotted value is the OPENING balance, so it equals cash
    // on hand rather than the balance after the first month's burn.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { demoDoc } = await import("../../src/state/document.js");
    const doc = demoDoc("grant-startup");
    const spec = buildChart("flow.runway", doc, {});
    const first = spec?.series?.find(x => x.id === "mid" || x.id === "expected")?.values?.[0]
               ?? spec?.series?.[0]?.values?.[0];
    expect(first, "first plotted point is the opening balance").toBeCloseTo(doc.cash, -2);
  });
});

describe("⚠️ charts that read the projection read fields it has", () => {
  it("plan-against-actual plots real planned spend, not zeros", async () => {
    // ⚠️ `rows[i].out` NEVER EXISTED. `buildProjection` pushes `{ m, start, rev, cost, net, end,
    // inNonGrant }`, so `clean(undefined)` returned 0 and "Planned" was a flat line at zero against a
    // real "Actual" — a comparison chart with nothing to compare. SEVEN readers of `r.in`/`r.out`
    // across charts.js, advisor.js and alerts.js, none of which any writer has ever produced.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const { buildProjection } = await import("../../src/engine/projection.js");
    const { demoDoc } = await import("../../src/state/document.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    for (const a of ARCHETYPES) {
      const doc = demoDoc(a.id);
      const parts = buildModelParts(doc);
      parts.rows = buildProjection(parts.model, doc.settings?.toggles || {});
      const spec = buildChart("hist.planvsactual", doc, parts);
      const planned = spec.series.find((s) => s.id === "plan").values;
      expect(planned.some((v) => v > 0), `${a.id}: every planned month is 0`).toBe(true);
      expect(planned.every((v) => Number.isFinite(v)), a.id).toBe(true);
    }
  });

  it("money in and money out are not both flat zero", async () => {
    // Same phantom fields, and this chart drew NOTHING AT ALL — both series zero on every fixture.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const { buildProjection } = await import("../../src/engine/projection.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const id of ["grant-startup", "saas"]) {
      const doc = demoDoc(id);
      const parts = buildModelParts(doc);
      parts.rows = buildProjection(parts.model, doc.settings?.toggles || {});
      const spec = buildChart("flow.inout", doc, parts);
      const out = spec.series.find((s) => s.id === "out").values;
      expect(out.some((v) => v !== 0), `${id}: money out is flat zero`).toBe(true);
    }
  });

  it("revenue-as-a-share-of-burn is not flat zero where there is revenue", async () => {
    // The DEFAULT chart on the Sales tab, chosen because it draws for everybody — and it divided by a
    // phantom denominator, so the guard returned 0 and it drew for nobody.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const { buildProjection } = await import("../../src/engine/projection.js");
    const { demoDoc } = await import("../../src/state/document.js");
    const doc = demoDoc("saas");
    const parts = buildModelParts(doc);
    parts.rows = buildProjection(parts.model, doc.settings?.toggles || {});
    const spec = buildChart("sales.cover", doc, parts);
    expect(spec.series[0].values.some((v) => v > 0)).toBe(true);
  });
});

describe("⚠️ plan-against-actual's x-axis", () => {
  const built = async (doc) => {
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const { buildProjection } = await import("../../src/engine/projection.js");
    const parts = buildModelParts(doc);
    parts.rows = buildProjection(parts.model, doc.settings?.toggles || {});
    return buildChart("hist.planvsactual", doc, parts);
  };

  it("labels months by name, and month ZERO is not blank", async () => {
    // ⚠️ `h.period || h.month || ""` MADE THE FIRST RECORDED MONTH AN EMPTY STRING. Month 0 is falsy, so
    // it fell through to `""` while every other month showed a raw index: "", 1, 2, 3, 4, 5. The one
    // column a reader looks at first had no label at all, and the rest were numbers nobody thinks in.
    const { demoDoc } = await import("../../src/state/document.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    for (const a of ARCHETYPES) {
      const spec = await built(demoDoc(a.id));
      expect(spec.x[0], `${a.id}: first label is blank`).toBeTruthy();
      for (const label of spec.x) {
        expect(String(label), `${a.id}: "${label}" is not a month name`).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
      }
    }
  });

  it("⚠️ EMITS ONE CATEGORICAL TICK PER BAR", async () => {
    // Without `ticks` the renderer falls to its "ends only" fallback, which places the first and last
    // labels at the PLOT EDGES. Bars are centred in bands, so neither label sat over the bar it named —
    // which is what "the ticks and the data do not line up" looks like. `CategoryAxis` positions at
    // `i * groupW + groupW / 2`, the same band model `Bars` lays out with.
    const { demoDoc } = await import("../../src/state/document.js");
    const spec = await built(demoDoc("grant-startup"));
    expect(spec.ticks?.length, "no ticks: the axis falls back to ends-only").toBe(spec.x.length);
    expect(spec.ticks.every((t) => t.categorical), "ticks must say they are names, not month offsets").toBe(true);
    expect(spec.ticks.map((t) => t.label)).toEqual(spec.x);
    for (const sr of spec.series) expect(sr.values.length).toBe(spec.x.length);
  });

  it("⚠️ READS PLANNED BY h.month, NOT BY POSITION IN THE SLICE", async () => {
    // `hist` is `.slice(-12)`. On a document with more than a year of history, position 0 is month 12 —
    // so every planned figure was read a YEAR EARLY against the actual beside it. Invisible at six
    // months of ledger and wrong the moment somebody imports two years.
    const { demoDoc } = await import("../../src/state/document.js");
    const base = demoDoc("grant-startup");
    const long = { ...base, history: Array.from({ length: 18 }, (_, m) => ({
      month: m, lines: [{ code: "6000", amount: 60000 + m * 1000 }] })) };
    const spec = await built(long);
    expect(spec.x.length, "the slice should keep the last 12").toBe(12);
    // The window shown is months 6..17, so the first label must be month 6 — not month 0.
    const { monthLabel } = await import("../../src/engine/time.js");
    expect(spec.x[0]).toBe(monthLabel(long.startY, long.startM, 6));
    expect(spec.x[11]).toBe(monthLabel(long.startY, long.startM, 17));
  });
});
