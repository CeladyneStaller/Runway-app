import { describe, it, expect } from "vitest";
import { valueAt, indexAt, placeTip } from "../../src/engine/hover.js";

const spec = {
  format: "money",
  x: ["Jul", "Aug", "Sep"],
  ticks: [{ label: "Jul 26" }, { label: "Aug" }, { label: "Sep" }],
  series: [
    { id: "a", label: "Catalyst", values: [10, 20, 30], stacked: true },
    { id: "b", label: "Pilot", values: [5, 6, 7], stacked: true },
    { id: "c", label: "Headcount", values: [6, 6, 7], axis: "right" },
  ],
};

describe("⚠️ it reads the SPEC, not the drawing", () => {
  it("reports every series at one index", () => {
    // A hover layer that asked each renderer to hit-test would need four implementations of one
    // question — the fault this codebase produced five times this week.
    const v = valueAt(spec, 1);
    expect(v.rows.map(r => r.value)).toEqual([20, 6, 6]);
    expect(v.label).toBe("Aug");
  });

  it("⚠️ TOTALS THE STACK, and only the stack", () => {
    // People read a stack by its HEIGHT, so the number they want is usually the total — and a
    // right-axis series is not part of it.
    expect(valueAt(spec, 1).total).toBe(26);
  });

  it("gives no total for a single stacked series", () => {
    // One segment's total is the segment; repeating it is noise.
    const one = { ...spec, series: [spec.series[0]] };
    expect(valueAt(one, 0).total).toBeNull();
  });

  it("⚠️ MARKS A RIGHT-AXIS SERIES", () => {
    // Two scales are already a compromise; a number lifted off the wrong one is worse than not
    // reading it.
    expect(valueAt(spec, 0).rows.find(r => r.id === "c").axis).toBe("right");
    expect(valueAt(spec, 0).rows.find(r => r.id === "a").axis).toBe("left");
  });

  it("⚠️ MARKS A PROJECTED MONTH", () => {
    // A tooltip reporting a modelled figure the same way it reports a recorded one undoes the
    // actuals/projection divide — and is worse than the line, because a precise number FEELS like a
    // fact.
    expect(valueAt(spec, 0, { todayIndex: 0 }).projected).toBe(false);
    expect(valueAt(spec, 2, { todayIndex: 0 }).projected).toBe(true);
    expect(valueAt(spec, 2).projected).toBe(false);          // no divide known — claims nothing
  });

  it("⚠️ REPORTS A RANGE WHERE THE CHART DRAWS ONE", () => {
    // Reporting the centre alone would use the most precise-feeling surface in the interface to say
    // the one thing this product's design exists to avoid saying.
    const v = valueAt(spec, 1, { band: { lo: [0, -38000, 0], hi: [0, 61400, 0] } });
    expect(v.band).toEqual({ lo: -38000, hi: 61400 });
    expect(valueAt(spec, 1).band).toBeNull();
  });

  it("keeps a dimmed series, marked", () => {
    // Dimming is emphasis, not exclusion — it stays on the axis scale, so it stays here.
    const d = { ...spec, series: [{ ...spec.series[0], dim: true }] };
    expect(valueAt(d, 0).rows[0].dim).toBe(true);
  });

  it("survives an index past the data", () => {
    expect(valueAt(spec, 99).rows.every(r => r.value === 0)).toBe(true);
    expect(valueAt(spec, -1)).toBeNull();
    expect(valueAt(null, 0)).toBeNull();
  });
});

describe("⚠️ NEAREST X, not nearest mark", () => {
  it("snaps anywhere in the plot to a month", () => {
    // Requiring somebody to hit a 2px line is a chart you can only read with a mouse and good aim —
    // and it makes the touch case impossible rather than merely awkward.
    const box = { left: 52, width: 560, n: 18 };
    expect(indexAt(52, box)).toBe(0);
    expect(indexAt(612, box)).toBe(17);
    expect(indexAt(332, box)).toBe(9);
  });

  it("clamps outside the plot rather than returning nothing", () => {
    const box = { left: 52, width: 560, n: 18 };
    expect(indexAt(0, box)).toBe(0);
    expect(indexAt(9999, box)).toBe(17);
  });

  it("handles a one-point chart", () => {
    expect(indexAt(100, { left: 52, width: 560, n: 1 })).toBe(0);
  });
});

describe("placement", () => {
  it("⚠️ FLIPS BEFORE THE EDGE", () => {
    // A tooltip that runs off the canvas is unreadable; one that covers the hovered column makes people
    // move the pointer to see what they were reading, which moves the tooltip.
    expect(placeTip(690, 60, { w: 720, h: 252 }).flipped).toBe(true);
    expect(placeTip(100, 60, { w: 720, h: 252 }).flipped).toBe(false);
  });

  it("stays inside the box vertically", () => {
    const p = placeTip(100, 250, { w: 720, h: 252 });
    expect(p.y).toBeGreaterThanOrEqual(4);
    expect(p.y).toBeLessThanOrEqual(252 - 4);
  });
});

describe("⚠️ a breakdown subtotals whether or not it is stacked", () => {
  const mk = (stacked) => ({
    format: "money", x: ["a"], ticks: [{ label: "Nov" }],
    series: [
      { id: "p:1", label: "Catalyst", group: "p", groupLabel: "Project spend", values: [41000], stacked },
      { id: "p:2", label: "Pilot", group: "p", groupLabel: "Project spend", values: [26800], stacked },
      { id: "p:3", label: "Stack", group: "p", groupLabel: "Project spend", values: [18200], stacked },
    ],
  });

  it("GIVES THE SAME SUBTOTAL EITHER WAY", () => {
    // The total was gated on `stacked`, which is a DRAWING choice — but eight projects drawn as eight
    // lines are still eight parts of one measure. **Gating a semantic fact on a visual setting meant
    // the number appeared and disappeared depending on which shape somebody picked.**
    for (const stacked of [true, false]) {
      const g = valueAt(mk(stacked), 0).groups;
      expect(g, `stacked=${stacked}`).toHaveLength(1);
      expect(g[0].value).toBe(86000);
      expect(g[0].label).toBe("Project spend");     // named, not just "Total"
    }
  });

  it("⚠️ DOES NOT SUM UNRELATED MEASURES", () => {
    // Money in plus cash balance is arithmetic nobody asked for. Each measure is its own group of one.
    const un = { format: "money", x: ["a"], ticks: [{ label: "Nov" }], series: [
      { id: "rev", group: "rev", label: "Money in", values: [80000] },
      { id: "end", group: "end", label: "Cash", values: [500000] },
    ] };
    expect(valueAt(un, 0).groups).toHaveLength(0);
    expect(valueAt(un, 0).total).toBeNull();
  });

  it("still reports the STACK HEIGHT when several measures are stacked together", () => {
    // One group each, so no subtotal — but the height is what the eye reads.
    const two = { format: "money", x: ["a"], ticks: [{ label: "Nov" }], series: [
      { id: "rev", group: "rev", label: "Money in", values: [80000], stacked: true },
      { id: "cost", group: "cost", label: "Money out", values: [-40000], stacked: true },
    ] };
    expect(valueAt(two, 0).total).toBe(40000);
    expect(valueAt(two, 0).groups).toHaveLength(0);
  });

  it("⚠️ CARRIES `group` THROUGH THE ROW PICK", () => {
    // The subtotal came back empty on the first attempt because `rows` never copied `group` — the same
    // hand-written-pick omission that dropped `color` in the renderer, `color` again in the legend, and
    // four fields in `saveChart`.
    expect(valueAt(mk(true), 0).rows[0].group).toBe("p");
    expect(valueAt(mk(true), 0).rows[0].groupLabel).toBe("Project spend");
  });
});
