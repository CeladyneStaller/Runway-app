// Per-project "plot against reality" chart, in the expanded card. Engine series are tested in
// engine/projectchart.test.js; this covers the render + controls.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

function expandedProjects(doc) {
  let d = doc;
  const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /Projects/.test(b.textContent)));
  const expand = [...container.querySelectorAll(".linkbtn")].find(b => /Expand all/.test(b.textContent));
  if (expand) fireEvent.click(expand);
  return container;
}

describe("project chart", () => {
  it("renders an SVG chart in each expanded card", () => {
    const c = expandedProjects(demoDoc());
    expect(c.querySelectorAll(".pchart").length).toBeGreaterThan(0);
    expect(c.querySelector(".pchart-svg")).toBeTruthy();
  });
  it("offers cost / revenue / net and monthly / cumulative", () => {
    const c = expandedProjects(demoDoc());
    const metrics = [...c.querySelectorAll(".pcm")].map(b => b.textContent);
    expect(metrics).toContain("Cost");
    expect(metrics).toContain("Revenue");
    expect(metrics).toContain("Net");
    const modes = [...c.querySelectorAll(".pcmode")].map(b => b.textContent);
    expect(modes).toContain("Monthly");
    expect(modes).toContain("Cumulative");
  });
  it("switches metric and mode without crashing", () => {
    const c = expandedProjects(demoDoc());
    fireEvent.click([...c.querySelectorAll(".pcm")].find(b => /Revenue/.test(b.textContent)));
    fireEvent.click([...c.querySelectorAll(".pcmode")].find(b => /Monthly/.test(b.textContent)));
    expect(c.querySelector(".pchart-svg")).toBeTruthy();
    expect(c.textContent).not.toMatch(/NaN|undefined/);
  });
  it("a project with recorded actuals shows the 'Recorded' legend", () => {
    // Mobile app launch is coded 5100 in the demo ledger -> has actuals
    const c = expandedProjects(demoDoc());
    expect(c.textContent).toMatch(/Recorded/);
  });
});
