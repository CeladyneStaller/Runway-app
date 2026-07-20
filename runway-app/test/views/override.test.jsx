// The per-project actuals override: the last missing input. Coded spend is the source of truth; this
// lets you redistribute WITHIN a project (a milestone that billed to a different month than it
// landed) and flags you only when you change the total — which is no longer redistribution.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

function openProjects(doc) {
  let d = doc;
  const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /Projects/.test(b.textContent)));
  // projects now open collapsed on multi-project tabs; expand them so the override editor renders
  const expandAll = [...container.querySelectorAll(".linkbtn")].find(b => /Expand all/.test(b.textContent));
  if (expandAll) fireEvent.click(expandAll);
  return { container, get: () => d };
}
// the internal project "Mobile app launch" is coded 5100 -> {1:8000, 2:18000, 4:22000}
const overrideOf = (c) => [...c.querySelectorAll(".override")].find(o =>
  o.closest(".card, .projwrap, div")?.textContent?.includes("Recorded spend"));

describe("actuals override", () => {
  it("shows each coded month with an editable Recorded column", () => {
    const api = openProjects(demoDoc());
    const ov = api.container.querySelector(".override");
    const rows = ov.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(1);        // months + total
    expect(ov.textContent).toMatch(/Coded/);
    expect(ov.textContent).toMatch(/Recorded/);
  });

  it("editing a month writes actualsOverride to that project", () => {
    const api = openProjects(demoDoc());
    const ov = api.container.querySelector(".override");
    const input = ov.querySelector("tbody input[type=number]");
    fireEvent.change(input, { target: { value: "12000" } });
    const edited = api.get().projects.find(p => p.actualsOverride);
    expect(edited).toBeTruthy();
    expect(Object.values(edited.actualsOverride)).toContain(12000);
  });

  it("flags the project when an override changes its total", () => {
    // start with an override that inflates the total
    const doc = demoDoc();
    const mobile = doc.projects.find(p => p.name === "Mobile app launch");
    mobile.actualsOverride = { 1: 40000 };   // coded month 1 was 8000
    const api = openProjects(doc);
    const flag = [...api.container.querySelectorAll(".ovflag")];
    expect(flag.length).toBeGreaterThan(0);
    expect(flag[0].textContent).toMatch(/changed total|difference/i);
  });

  it("does not flag a redistribution that preserves the total", () => {
    const doc = demoDoc();
    const mobile = doc.projects.find(p => p.name === "Mobile app launch");
    // coded {1:8000, 2:18000, 4:22000} = 48000; redistribute to same total
    mobile.actualsOverride = { 1: 16000, 2: 10000, 4: 22000 };
    const api = openProjects(doc);
    // find THIS project's override block and confirm no flag inside it
    const blocks = [...api.container.querySelectorAll(".override")];
    const anyFlag = blocks.some(b => b.querySelector(".ovflag"));
    expect(anyFlag).toBe(false);
  });

  it("Reset to coded clears the override", () => {
    const doc = demoDoc();
    doc.projects.find(p => p.name === "Mobile app launch").actualsOverride = { 1: 40000 };
    const api = openProjects(doc);
    fireEvent.click([...api.container.querySelectorAll(".linkbtn")].find(b => /Reset to coded/.test(b.textContent)));
    expect(api.get().projects.find(p => p.name === "Mobile app launch").actualsOverride).toBeUndefined();
  });
});
