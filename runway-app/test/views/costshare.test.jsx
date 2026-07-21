// Cost-share panel in the expanded grant card. Engine math is in engine/costshare.test.js; this covers
// that it renders for grants with a match, hides for those without, and shows derived numbers.
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

describe("cost-share panel", () => {
  it("appears for a grant with a match requirement", () => {
    let d = demoDoc();
    const cat = d.projects.find(p => p.name === "Catalyst scale-up");
    d.codeMap = { ...d.codeMap, "CS": cat.id };
    d.history = [{ month: 0, lines: [{ code: "CS", amount: 40000, category: "personnel", period: 0 }] }, ...d.history.slice(1)];
    const c = expandedProjects(d);
    expect(c.textContent).toMatch(/Cost-share/);
    expect(c.textContent).toMatch(/match/);
    expect(c.querySelectorAll(".csr").length).toBeGreaterThan(0);
  });

  it("shows recorded-vs-required numbers", () => {
    let d = demoDoc();
    const cat = d.projects.find(p => p.name === "Catalyst scale-up");
    d.codeMap = { ...d.codeMap, "CS": cat.id };
    d.history = [{ month: 0, lines: [{ code: "CS", amount: 40000, category: "personnel", period: 0 }] }, ...d.history.slice(1)];
    const c = expandedProjects(d);
    expect(c.textContent).toMatch(/toward match/);
    expect(c.textContent).toMatch(/required/);
  });

  it("does not appear for a grant with no match (costSharePct 0)", () => {
    // Sensor SBIR has costSharePct 0 in the demo; with no matched grant spend and no other 20% grant,
    // count panels and ensure it's only the ones that have a match
    const c = expandedProjects(demoDoc());
    const panels = c.querySelectorAll(".csr").length;
    // demo has exactly one grant with a match (Catalyst, 20%); the others are 0%
    expect(panels).toBe(1);
  });
});
