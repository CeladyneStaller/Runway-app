import { describe, it, expect } from "vitest";
import { CHARTS, buildChart } from "../../src/engine/charts.js";
import { buildModelParts } from "../../src/engine/buildmodel.js";
import { buildProjection, anchorToActuals, solvency, balanceAtDate, forecastFrom } from "../../src/engine/projection.js";
import { roundMS, msPass, msGap } from "../../src/engine/capital.js";
import { canaryDoc, demoDoc } from "../../src/state/document.js";
import { ARCHETYPES } from "../../src/state/archetypes.js";

/** ⚠️ EVERY CHART, EVERY FIXTURE, CHECKED FOR THE SHAPE OF FAILURE THIS CODEBASE ACTUALLY HAS.
 *
 *  Not one of the chart bugs found this session THREW. Each returned a well-formed spec full of zeros,
 *  or a series whose length disagreed with its own axis, and drew confidently:
 *
 *    `r.in` / `r.out`   7 readers   flow.inout drew nothing; plan-against-actual had no "planned"
 *    `l.amounts`        6 readers   payroll timeline empty, headcount all zero, forecast flat
 *    `p.team`           3 readers   team load empty for every company since it was written
 *    slice-vs-month     3 builders  history plotted at the wrong months past a year of data
 *
 *  A unit test per chart would not have caught these — each chart was doing exactly what its code said.
 *  What catches them is asking every chart the same three questions at once, across every fixture:
 *  does it throw, does it agree with its own axis, and are its numbers real.
 */

/** The parts App.jsx actually supplies — `buildModelParts` alone is NOT what a chart receives. */
const fullParts = (doc) => {
  const parts = buildModelParts(doc);
  const T = doc.settings?.toggles || {};
  const from = forecastFrom(doc);
  parts.rows = anchorToActuals(buildProjection(parts.model, T), doc.cashActuals || {}, true);
  const solv = solvency(parts.rows, doc.startY, doc.startM, from);
  parts.msWithBal = [...(doc.milestones || []), ...roundMS(doc.rounds, doc.startY, doc.startM)].map((ms) => {
    const b = balanceAtDate(parts.rows, doc.startY, doc.startM, ms.y, ms.m, ms.day);
    const bal = b?.bal ?? 0;
    return { ...ms, t: b?.t ?? 0, bal, pass: msPass(bal, ms), gap: msGap(bal, ms),
             stranded: solv ? (b?.t ?? 0) > solv.zeroT : false };
  });
  return parts;
};

/** ⚠️ BUILT ONCE, NOT PER TEST. Four tests x five fixtures x a full model build was ~1s of rebuilding
 *  identical documents. It is not why a Windows run timed out spawning workers — that is process
 *  startup, not test execution — but a test file that rebuilds the world for every assertion is paying
 *  for nothing, and `monthsShown` caches on the doc OBJECT, so a fresh `demoDoc()` misses it every time.
 *
 *  Frozen after building: these are shared across tests now, so a test that mutated one would corrupt
 *  the others in a way that depends on execution order.
 */
let CACHE = null;
const FIXTURES = () => (CACHE ||= [["canary", canaryDoc()], ...ARCHETYPES.map((a) => [a.id, demoDoc(a.id)])]
  .map(([name, doc]) => [name, doc, fullParts(doc)]));

describe("⚠️ chart audit — every chart, every fixture", () => {
  it("nothing throws", () => {
    // `buildChart` catches, so a throw becomes an empty state rather than a stack trace. That is right
    // for production and hides the failure here, so this asserts on the raw builder.
    for (const [name, doc, parts] of FIXTURES()) {
      for (const spec of CHARTS) {
        expect(() => spec.build(doc, parts), `${name} / ${spec.id}`).not.toThrow();
      }
    }
  });

  it("⚠️ EVERY SERIES AGREES WITH ITS OWN X-AXIS", () => {
    // `sales.forecast` drew 6 booked points against a 23-month axis — the recorded months crammed into
    // the left quarter of the plot, silently. A series shorter than its axis is not a short series; it
    // is a series drawn at the wrong months.
    for (const [name, doc, parts] of FIXTURES()) {
      for (const { id } of CHARTS) {
        const spec = buildChart(id, doc, parts);
        if (!spec || spec.empty || !Array.isArray(spec.x)) continue;
        for (const sr of spec.series || []) {
          if (!sr.values?.length) continue;
          expect(sr.values.length, `${name} / ${id} / ${sr.id} vs its x-axis`).toBe(spec.x.length);
        }
        if (spec.ticks?.[0]?.categorical) {
          expect(spec.ticks.length, `${name} / ${id}: a tick per column`).toBe(spec.x.length);
        }
      }
    }
  });

  it("no series contains NaN or Infinity", () => {
    // A non-finite value renders as a broken path or a missing bar — visible, but only if somebody is
    // looking at that fixture on that tab.
    for (const [name, doc, parts] of FIXTURES()) {
      for (const { id } of CHARTS) {
        const spec = buildChart(id, doc, parts);
        if (!spec || spec.empty) continue;
        for (const sr of spec.series || []) {
          for (const v of sr.values || []) {
            if (v == null) continue;
            expect(Number.isFinite(v), `${name} / ${id} / ${sr.id} has ${v}`).toBe(true);
          }
        }
      }
    }
  });

  it("⚠️ ALL-ZERO SERIES ARE LISTED, AND THE LIST MAY NOT GROW", () => {
    // A flat-zero series is the signature of every phantom-field bug in this codebase. Most of the
    // entries below are HONEST — a nonprofit has no subscribers, a company with no venture debt has no
    // debt closure — so demanding zero here would be wrong. Pinning the list is not: a NEW flat series
    // means either a reader wired to nothing, or demo data that stopped exercising a feature.
    const found = [];
    for (const [name, doc, parts] of FIXTURES()) {
      for (const { id } of CHARTS) {
        const spec = buildChart(id, doc, parts);
        if (!spec || spec.empty) continue;
        for (const sr of spec.series || []) {
          const v = sr.values || [];
          if (v.length && v.every((x) => x === 0 || x == null)) found.push(`${name}/${id}/${sr.id}`);
        }
      }
    }
    const KNOWN = new Set([
      // no subscriptions -> no subscriber series
      "canary/sales.recurring/subs", "canary/sales.recurring/count",
      "grant-startup/sales.recurring/subs", "grant-startup/sales.recurring/count",
      "hardware-vc/sales.recurring/subs", "hardware-vc/sales.recurring/count",
      "nonprofit/sales.recurring/subs", "nonprofit/sales.recurring/count",
      // no purchase orders -> no booked order revenue
      "grant-startup/sales.recurring/orders", "nonprofit/sales.recurring/orders", "saas/sales.recurring/orders",
      // no venture debt in any fixture — a demo-data gap, not a wiring one
      "canary/cmt.closure/debt", "grant-startup/cmt.closure/debt", "hardware-vc/cmt.closure/debt",
      "nonprofit/cmt.closure/debt", "saas/cmt.closure/debt",
      // no cash cost share to accrue
      "hardware-vc/cmt.closure/cs", "nonprofit/cmt.closure/cs", "saas/cmt.closure/cs",
      "hardware-vc/cmt.costshare/accrued", "nonprofit/cmt.costshare/accrued", "saas/cmt.costshare/accrued",
      // ⚠️ THE POINT OF THE CHART. "You cannot match federal money with federal money" — a flat zero
      // against a rising accrued line IS the shortfall it exists to show.
      "grant-startup/cmt.costshare/matched", "nonprofit/cmt.costshare/matched",
    ]);
    const added = found.filter((f) => !KNOWN.has(f));
    expect(added, `new all-zero series: ${added.join(", ")}`).toEqual([]);
  });
});
