import { describe, it, expect } from "vitest";
import { plotFrame, padFor, BASE_PAD, RUNWAY_PAD, moneyTick, monthTick, monthTicks, ruleValues, domainFor,
         wantsVerticals, legendMode, RULE_COUNT } from "../../src/engine/plotframe.js";

describe("money on the axis", () => {
  it("is written in thousands, one unit all the way up", () => {
    // ⚠️ Switching to "1.24M" halfway up an axis nobody expects to change scale is how a reader
    // misjudges a magnitude by three orders.
    expect(moneyTick(412000)).toBe("412k");
    expect(moneyTick(1240000)).toBe("1,240k");
    expect(moneyTick(0)).toBe("0");
  });

  it("keeps one decimal below 100k and none above", () => {
    expect(moneyTick(41200)).toBe("41.2k");
    expect(moneyTick(412000)).toBe("412k");
  });

  it("handles negatives, which this product has", () => {
    expect(moneyTick(-88000)).toBe("-88k");
  });
});

describe("the year rule", () => {
  it("PUTS THE YEAR ON THE FIRST LABEL AND EVERY JANUARY — and nothing else", () => {
    // ⚠️ THE APPROVED RULE, restored. I had built a density rule on top of it — years on every label
    // when they fit, plus a repeated-month check — after reading a preference for the runway chart's
    // labels as a request to change the rule. IT WAS NOT ONE.
    expect(monthTick(2026, 6, 0, { first: true })).toBe("Jul 26");
    expect(monthTick(2026, 6, 1)).toBe("Aug");
    expect(monthTick(2026, 6, 6)).toBe("Jan 27");
    expect(monthTick(2026, 6, 8)).toBe("Mar");
  });

  it("ANCHORS A WINDOW CONTAINING NO JANUARY", () => {
    // Feb to Dec. Under the old rule this chart carried no year at all.
    expect(monthTick(2026, 1, 0, { first: true })).toBe("Feb 26");
    expect(monthTick(2026, 1, 10)).toBe("Dec");
  });

  it("does not print the year twice when the chart starts in January", () => {
    expect(monthTick(2027, 0, 0, { first: true })).toBe("Jan 27");
  });
});

describe("label thinning", () => {
  it("THINS ON A FIXED SEQUENCE, not an arbitrary spacing per width", () => {
    // Choosing a spacing per width makes the same chart label differently on two devices.
    // Returns {i, year} since the density rule landed — the step is between the INDICES.
    const wide = monthTicks(18, 720).map(t => t.i);
    const narrow = monthTicks(18, 320).map(t => t.i);
    expect(wide.length).toBeGreaterThan(narrow.length);
    for (const set of [wide, narrow]) {
      expect([1, 3, 6, 12]).toContain(set[1] - set[0]);
    }
  });

  it("always labels the first and last month", () => {
    for (const w of [320, 480, 720]) {
      const t = monthTicks(18, w).map(x => x.i);
      expect(t[0]).toBe(0);
      expect(t[t.length - 1]).toBe(17);
    }
  });

  it("survives a one-month chart", () => {
    expect(monthTicks(1, 720).map(t => t.i)).toEqual([0]);
  });
});

describe("yearEvery — the one opt-in", () => {
  it("IS OFF BY DEFAULT, and belongs to the caller that wants it", () => {
    // ⚠️ THE BASELINE IS NOW ONE YEAR LABEL PER YEAR, not one in total. Corey found the hole in "first
    // label plus every January": when labels thin, a chart spanning a year change may show no January
    // at all — `Jul 26 · Jul · Jul` — and **the year change becomes invisible on a chart whose whole
    // subject is when things happen.**
    //
    // A 36-month window spans four calendar years, so four labels carry one. `yearEvery` still differs:
    // it puts a year on EVERY label, which is what the runway chart wants at its own density.
    const plain = plotFrame({ w: 320, n: 36, startY: 2026, startM: 6, yMin: 0, yMax: 10 });
    const withYear = plain.ticks.filter(t => /\d\d$/.test(t.label));
    expect(withYear.length).toBe(4);
    expect(new Set(withYear.map(t => t.label.slice(-2))).size).toBe(4);   // one per YEAR, not repeats

    const every = plotFrame({ w: 320, n: 36, startY: 2026, startM: 6, yMin: 0, yMax: 10,
                              yearEvery: true });
    expect(every.ticks.every(t => /\d\d$/.test(t.label))).toBe(true);
  });

  it("⚠️ MARKS A YEAR CHANGE THAT CONTAINS NO JANUARY", () => {
    // The case the old rule missed entirely.
    const f = plotFrame({ w: 320, n: 36, startY: 2026, startM: 6, yMin: 0, yMax: 10 });
    expect(f.ticks.map(t => t.label)).toEqual(["Jul 26", "Jul 27", "Jul 28", "Jun 29"]);
  });
});

describe("the vertical domain", () => {
  it("⚠️ ALWAYS INCLUDES ZERO on a money axis", () => {
    // Starting at 300k because the data sits between 300k and 600k doubles the apparent slope of a
    // decline. In a product whose job is telling somebody how fast their money is going, that is not a
    // styling choice.
    const d = domainFor([560000, 480000, 390000, 310000]);
    expect(d.yMin).toBe(0);
  });

  it("reaches below zero when the data does", () => {
    expect(domainFor([100000, -40000]).yMin).toBeLessThan(0);
  });

  it("leaves headroom so a peak does not touch the frame", () => {
    expect(domainFor([100]).yMax).toBeGreaterThan(100);
  });

  it("does not divide by zero on flat data", () => {
    const d = domainFor([5, 5, 5]);
    expect(d.yMax).toBeGreaterThan(d.yMin);
  });
});

describe("rules", () => {
  it("ARE FOUR, FIXED — never adaptive to height", () => {
    // Adaptive counts mean two charts on one screen disagree about where the rules sit, which reads as
    // a difference in the data.
    expect(RULE_COUNT).toBe(4);
    expect(ruleValues(0, 600000)).toHaveLength(5);      // 4 intervals, 5 values
  });

  it("span the domain end to end", () => {
    const v = ruleValues(0, 600000);
    expect(v[0]).toBe(600000);
    expect(v[v.length - 1]).toBe(0);
  });
});

describe("verticals and legends", () => {
  it("⚠️ NO VERTICAL RULES ON BARS OR STACKS", () => {
    // They already divide the months; rules between them put a line through every gap and make the
    // chart read as a table.
    expect(wantsVerticals("line")).toBe(true);
    expect(wantsVerticals("band")).toBe(true);
    expect(wantsVerticals("bars")).toBe(false);
    expect(wantsVerticals("stack")).toBe(false);
  });

  it("SWITCHES THE LEGEND ON SERIES COUNT", () => {
    // One or two get their name where the eye already is; three or more collide, so a swatch row.
    expect(legendMode(1)).toBe("endpoint");
    expect(legendMode(2)).toBe("endpoint");
    expect(legendMode(3)).toBe("swatch");
    // ⚠️ THIS ONE FOUND A DEAD BRANCH. `count <= 2` matched zero first, so "none" was unreachable and
    // an empty chart drew an endpoint legend. Lint cannot see a dead ternary arm.
    expect(legendMode(0)).toBe("none");
  });
});

describe("the frame itself", () => {
  const f = () => plotFrame({ w: 720, h: 252, yMin: 0, yMax: 600000, n: 9,
                              startY: 2026, startM: 6, shape: "line" });

  it("IS THE SINGLE SOURCE FOR x AND y", () => {
    // Three renderers each defined their own. A gridline two pixels off its own baseline is the kind of
    // bug nobody reports and everybody notices.
    const p = f();
    expect(p.x(0)).toBe(p.inner.x);
    expect(p.x(8)).toBeCloseTo(p.inner.x + p.inner.w, 5);
    expect(p.y(0)).toBeCloseTo(p.inner.y + p.inner.h, 5);
    expect(p.y(600000)).toBeCloseTo(p.inner.y, 5);
  });

  it("clamps an out-of-range index rather than drawing off the canvas", () => {
    const p = f();
    expect(p.x(99)).toBeCloseTo(p.x(8), 5);
    expect(p.x(-3)).toBeCloseTo(p.x(0), 5);
  });

  it("puts a single-month chart in the middle", () => {
    const p = plotFrame({ n: 1, yMin: 0, yMax: 10 });
    expect(p.x(0)).toBeCloseTo(p.inner.x + p.inner.w / 2, 5);
  });

  it("REPORTS ZERO SEPARATELY from the rules", () => {
    // Zero is a real event in this product, not a gridline that happens to sit there — so it is drawn
    // heavier and is never one of the four.
    expect(f().zeroY).toBeCloseTo(f().inner.y + f().inner.h, 5);
    expect(plotFrame({ yMin: 100, yMax: 500, n: 4 }).zeroY).toBeNull();
  });

  it("drops the verticals for a stacked chart", () => {
    expect(plotFrame({ n: 9, yMin: 0, yMax: 10, shape: "stack" }).verticals).toEqual([]);
    expect(plotFrame({ n: 9, yMin: 0, yMax: 10, shape: "line" }).verticals.length).toBeGreaterThan(0);
  });

  it("does not draw a vertical over either edge of the frame", () => {
    const p = f();
    for (const v of p.verticals) {
      expect(v.i).not.toBe(0);
      expect(v.i).not.toBe(p.n - 1);
    }
  });

  it("labels its ticks with the year rule applied", () => {
    const labels = f().ticks.map(t => t.label);
    expect(labels[0]).toMatch(/^Jul \d\d$/);
    expect(labels.some(l => /^Jan \d\d$/.test(l))).toBe(true);
  });
});

describe("⚠️ one set of padding rules, two bases", () => {
  it("LEAVES A SINGLE-UNIT CHART EXACTLY AS IT WAS", () => {
    // Most of the 37 curated charts are single-unit, and none of them should shift because the builder
    // gained a feature.
    expect(padFor({})).toEqual(BASE_PAD);
  });

  it("⚠️ RESERVES THE RIGHT GUTTER ONLY WHEN THERE IS A RIGHT AXIS", () => {
    // The gutter was 16px and a right axis needs about 44 — five tick labels plus a title — so on any
    // two-unit chart those labels were drawn past the edge of the viewBox. **"Cramped" was the visible
    // half of a clipping bug.**
    // 44 for five tick labels and a title, plus 2 so the longest is not flush against the panel edge —
    // the same clearance reasoning as the legend and the 16px corner.
    expect(padFor({ rightAxis: true }).r).toBe(BASE_PAD.r + 46);
    expect(padFor({}).r).toBe(BASE_PAD.r);
  });

  it("gives a category axis room for names that wrap", () => {
    expect(padFor({ categorical: true }).b).toBeGreaterThan(BASE_PAD.b);
  });

  it("⚠️ `RunwayChart` SHARES THE RULES AND KEEPS ITS OWN BASE", () => {
    // Four constants lived in its file and four in `Chart.jsx` — agreeing on the day they were written
    // and free to drift the moment an element was added to one of them. **Two sets of constants do not
    // drift when written; they drift when changed.**
    expect(padFor({ base: RUNWAY_PAD })).toEqual(RUNWAY_PAD);
    expect(padFor({ base: RUNWAY_PAD, titled: true }).l).toBe(RUNWAY_PAD.l + 14);
    expect(RUNWAY_PAD).not.toEqual(BASE_PAD);          // different canvas, different starting point
  });

  it("does not let one base leak into the other", () => {
    padFor({ base: RUNWAY_PAD, rightAxis: true });
    expect(padFor({})).toEqual(BASE_PAD);
  });
});
