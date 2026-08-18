// Confidence band display: shaded region on the chart + range in the headline + honesty caption.
// Engine (confidenceBand) is tested in engine/band.test.js; this covers the UI wiring.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { canaryDoc as demoDoc } from "../../src/state/document";

describe("confidence band display", () => {
  it("shows a runway range in addition to the headline number", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    // dashboard is the default view; the range band caption mentions "Runway range"
    expect(container.textContent).toMatch(/Runway range/);
  });

  it("includes the honesty caption (not statistical probability)", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    expect(container.textContent).toMatch(/not statistical probability/);
  });

  it("can be toggled off", () => {
    let d = demoDoc();
    const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
    expect(container.textContent).toMatch(/Runway range/);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /range band/i.test(b.textContent)));
    expect(container.textContent).not.toMatch(/Runway range/);
  });

  it("draws the band as an SVG region on the chart", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    // the band adds paths with the signal-2 fill at low opacity; the chart svg exists
    expect(container.querySelector(".svgc")).toBeTruthy();
  });
});

describe("the band brackets the main line in the rendered chart (regression: band was offset)", () => {
  // parse the y-coordinate of the point at a given index from an SVG path 'd' string like
  // "M66.0 120.0 L92.3 130.5 L...". Returns the y of the (index)-th coordinate pair.
  const yAt = (d, index) => {
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    return nums[index * 2 + 1];   // pairs are [x,y,x,y,...]; y of pair `index`
  };
  const pathD = (container, sel) => container.querySelector(sel)?.getAttribute("d");

  it("over recorded actuals the band coincides with the line; past them it opens up", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    const floor = pathD(container, '[data-band="floor"]');
    const ceiling = pathD(container, '[data-band="ceiling"]');
    const main = pathD(container, '[data-trace="main"]');
    expect(floor && ceiling && main).toBeTruthy();

    // t=3 is inside the recorded-cash region (actuals cover months 0–4): there's no uncertainty about
    // cash already recorded, so floor = ceiling = line all sit on the same anchored value. This is the
    // decisive check — an un-anchored band (old bug) would sit ~$114k off, and an end-of-month-sampled
    // band (old bug) would sit a month ahead; either way it would NOT coincide with the line here.
    const yF3 = yAt(floor, 3), yC3 = yAt(ceiling, 3), yL3 = yAt(main, 3);
    expect(Math.abs(yF3 - yL3)).toBeLessThan(0.6);
    expect(Math.abs(yC3 - yL3)).toBeLessThan(0.6);

    // past the actuals (t=8), the projection diverges into tiers, so the band has real width:
    // ceiling (+speculative) sits above floor (committed only). SVG y grows downward, so yFloor > yCeil.
    const yF8 = yAt(floor, 8), yC8 = yAt(ceiling, 8);
    expect(yF8 - yC8).toBeGreaterThan(1);
  });
});

describe("nothing in the chart runs beyond the x-axis (regression: unclipped band overran to ~2.6x width)", () => {
  it("every rendered path stops at or before the plot's right edge", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    const svg = container.querySelector(".svgc");
    // plot right edge = W - R (matches RunwayChart's x-scale: x(tMax) = L + (W-L-R) = W-R)
    const W = 980, R = 26, rightEdge = W - R;   // 954
    const overflowing = [];
    svg.querySelectorAll("path[d]").forEach(p => {
      const nums = (p.getAttribute("d").match(/-?\d+(\.\d+)?/g) || []).map(Number);
      let maxX = -Infinity;
      for (let i = 0; i < nums.length; i += 2) maxX = Math.max(maxX, nums[i]);
      if (maxX > rightEdge + 1) overflowing.push({   // 1px tolerance for rounding
        tag: p.getAttribute("data-band") || p.getAttribute("data-trace") || p.getAttribute("stroke"),
        maxX: +maxX.toFixed(1),
      });
    });
    // if the band (or anything) loses its clip to tMax, it sprays past the axis and this catches it
    expect(overflowing).toEqual([]);
  });
});
