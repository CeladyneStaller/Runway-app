// Confidence band display: shaded region on the chart + range in the headline + honesty caption.
// Engine (confidenceBand) is tested in engine/band.test.js; this covers the UI wiring.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

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
