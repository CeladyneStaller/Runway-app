import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Chart } from "../../src/views/chrome/Chart";
import { buildChart, CHARTS } from "../../src/engine/charts";
import { canaryDoc as demoDoc } from "../../src/state/document";
import { buildModelParts } from "../../src/engine/buildmodel";

afterEach(cleanup);

/** ⚠️ THE FIRST TEST THAT LOOKS AT A RENDERED AXIS.
 *
 *  `charts.test.js` has 105 tests and all of them passed while every month-indexed chart was drawing a
 *  half-empty axis, because they assert what `build()` RETURNS and never what the axis DRAWS. The bug
 *  was `startY={spec.startY}` at two call sites against a field no chart's build returns, so every
 *  chart took a fallback that read `axisTicks().label` — null on any non-quarter month.
 */
describe("the rendered time axis", () => {
  const doc = demoDoc();
  const parts = buildModelParts(doc);
  const timeCharts = CHARTS.filter(c => !/ownership|goals|milestones/.test(c.id));

  it("LABELS SOMETHING on every month-indexed chart", () => {
    for (const c of timeCharts) {
      let spec;
      try { spec = buildChart(c.id, doc, parts); } catch { continue; }
      if (!spec?.ticks?.length) continue;
      const { container } = render(<Chart spec={spec} />);
      const labels = [...container.querySelectorAll("text.ch-t")]
        .map(t => t.textContent.trim()).filter(Boolean);
      expect(labels.length, `${c.id} drew no axis labels`).toBeGreaterThan(1);
      cleanup();
    }
  });

  it("NEVER DRAWS AN EMPTY OR NULL LABEL", () => {
    // The failure mode was a tick marked as labelled whose text was `null` — a longer tick with
    // nothing under it, which reads as a rendering fault rather than a missing value.
    for (const c of timeCharts.slice(0, 8)) {
      let spec;
      try { spec = buildChart(c.id, doc, parts); } catch { continue; }
      if (!spec?.ticks?.length) continue;
      const { container } = render(<Chart spec={spec} />);
      for (const t of container.querySelectorAll("text.ch-t")) {
        expect(t.textContent, `${c.id} drew an empty label`).toBeTruthy();
        expect(t.textContent).not.toMatch(/null|undefined|NaN/);
      }
      cleanup();
    }
  });

  it("puts the year on the first label and on January, and nowhere else", () => {
    const spec = buildChart("flow.inout", doc, parts);
    const { container } = render(<Chart spec={spec} />);
    const labels = [...container.querySelectorAll("text.ch-t")]
      .map(t => t.textContent.trim()).filter(Boolean);
    expect(labels[0]).toMatch(/\d\d$/);                       // first carries a year
    for (const l of labels.slice(1)) {
      if (/\d\d$/.test(l)) expect(l).toMatch(/^Jan/);         // any other year is a January
    }
  });
});
