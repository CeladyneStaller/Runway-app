// The timelines at phone width. An axis is not the point of these charts — they are a list of dated
// things and a verdict on each — and at 328px the axis costs everything and buys nothing.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Chart } from "../../src/views/chrome/Chart";

afterEach(cleanup);

/** matchMedia is not implemented in jsdom, so the component's narrow check has to be given one. */
const setWidth = (narrow) => {
  globalThis.matchMedia = vi.fn().mockImplementation(() => ({
    matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
};

const goals = {
  kind: "goals",
  span: 18,
  ticks: [{ i: 0, quarter: true, label: "Jul 26", q: "Q3" }],
  cashOutLabel: "16 Nov 26",
  closeM: 8, closeLabel: "31 Mar 27",
  pre: [
    { id: "g1", label: "VP Engineering hired", due: 4, dueLabel: "1 Nov 26", bal: 0, target: 0 },
    { id: "g2", label: "5 kW stack at 92% efficiency, 1,000 h duty", due: 5, dueLabel: "1 Dec 26",
      stranded: true, bridge: 180554 },
  ],
  post: [{ id: "g3", label: "Scale to 50 kW", due: 20, dueLabel: "1 Sep 27" }],
  rows: [],
};

const milestones = {
  kind: "milestones", span: 18, ticks: [{ i: 0, quarter: true, label: "Jul 26", q: "Q3" }],
  cashOutLabel: "17 Dec 26",
  mine: [
    { id: "m1", label: "Board review", due: 2, dueLabel: "30 Sep 26", bal: 264515, target: 250000 },
    { id: "m2", label: "Pilot customer signed", due: 4, dueLabel: "31 Oct 26", bal: 186000,
      target: 250000, short: true, shortBy: 64000 },
  ],
  fromRound: [{ id: "m3", label: "Series A close", due: 12, dueLabel: "31 Mar 27", bal: -104494,
                stranded: true, negative: true, bridge: 107511 }],
  rows: [],
};

describe("wide enough for an axis", () => {
  beforeEach(() => setWidth(false));

  it("draws the SVG timeline", () => {
    const v = render(<Chart spec={goals} />);
    expect(v.container.querySelector("svg")).toBeTruthy();
    expect(v.container.querySelector(".chrows")).toBeNull();
  });
});

describe("too narrow for an axis", () => {
  beforeEach(() => setWidth(true));

  it("becomes rows rather than a cramped chart", () => {
    const v = render(<Chart spec={goals} />);
    expect(v.container.querySelector(".chrows")).toBeTruthy();
    expect(v.container.querySelector("svg")).toBeNull();
  });

  it("keeps every goal, in both phases", () => {
    // Dropping rows to fit would be the one substitution that loses information.
    const v = render(<Chart spec={goals} />);
    expect(v.container.querySelectorAll(".chr")).toHaveLength(3);
    expect(v.container.textContent).toMatch(/Pre-raise/);
    expect(v.container.textContent).toMatch(/Post-raise/);
  });

  it("shows each label IN FULL — the axis was what forced truncation", () => {
    // The wide chart cuts labels at 36 characters because they have to fit beside a dot. A row has the
    // whole width, so the phone version is the one that shows more.
    const v = render(<Chart spec={goals} />);
    expect(v.container.textContent).toMatch(/5 kW stack at 92% efficiency, 1,000 h duty/);
  });

  it("carries the same verdict, in the same words", () => {
    // Two phrasings of one verdict is how a reader on a phone and a reader at a desk end up describing
    // different things to each other.
    const v = render(<Chart spec={goals} />);
    expect(v.container.textContent).toMatch(/needs \$181k to reach/);
  });

  it("states the cash-out date rather than shading a region", () => {
    // A shaded band does not survive being one column wide; the sentence does.
    const v = render(<Chart spec={goals} />);
    expect(v.container.textContent).toMatch(/Cash out · 16 Nov 26/);
  });

  it("does the same for milestones, including reached-but-short", () => {
    const v = render(<Chart spec={milestones} />);
    expect(v.container.querySelectorAll(".chr")).toHaveLength(3);
    expect(v.container.textContent).toMatch(/\$64k short/);
    expect(v.container.textContent).toMatch(/Dates you set/);
    expect(v.container.textContent).toMatch(/From rounds/);
  });

  it("drops the legend, which explains marks the rows do not draw", () => {
    const v = render(<Chart spec={{ ...goals, legend: [{ label: "Reachable", tone: "signal" }] }} />);
    expect(v.container.querySelector(".ch-legend")).toBeNull();
  });

  it("leaves every OTHER chart as an SVG", () => {
    // Only the timelines have an axis worth abandoning. A line chart at 328px is still a line chart.
    const line = { kind: "lines", x: ["a", "b"], series: [{ id: "s", label: "S", values: [1, 2] }] };
    const v = render(<Chart spec={line} />);
    expect(v.container.querySelector("svg")).toBeTruthy();
  });

  it("still shows an empty spec as its sentence", () => {
    const v = render(<Chart spec={{ empty: "No critical dates set yet." }} />);
    expect(v.container.textContent).toMatch(/No critical dates/);
  });
});
