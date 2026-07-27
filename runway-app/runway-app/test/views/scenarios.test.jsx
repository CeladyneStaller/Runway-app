// Scenarios view: build a what-if with the generic patch builder, compare against base. The engine
// (applyScenario, buildModelFromDoc) is tested separately; this covers the view + builder wiring.
import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

function scenariosView(initial) {
  const ref = { current: initial };
  function Harness() {
    const [d, setD] = useState(initial);
    ref.current = d;
    return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
  }
  const { container } = render(<Harness />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /Scenarios/.test(b.textContent)));
  return { container, get: () => ref.current };
}

describe("scenarios view", () => {
  it("renders with the base runway in the comparison", () => {
    const { container } = scenariosView(demoDoc());
    expect(container.textContent).toMatch(/Runway comparison/);
    expect(container.textContent).toMatch(/Base/);
  });

  it("creates a new scenario", () => {
    const api = scenariosView(demoDoc());
    fireEvent.click([...api.container.querySelectorAll("button")].find(b => /New scenario/.test(b.textContent)));
    expect(api.get().scenarios.length).toBe(1);
    // editor opens
    expect(api.container.textContent).toMatch(/Edit scenario/);
  });

  it("adds a patch through the builder and it persists on the scenario", () => {
    const api = scenariosView(demoDoc());
    fireEvent.click([...api.container.querySelectorAll("button")].find(b => /New scenario/.test(b.textContent)));
    // pick "Cash on hand" as the target
    const targetSel = api.container.querySelector(".scn-builder .sel");
    fireEvent.change(targetSel, { target: { value: "field:cash" } });
    // now a value input appears
    const valInput = api.container.querySelector(".scn-builder .inp");
    fireEvent.change(valInput, { target: { value: "1000000" } });
    fireEvent.click([...api.container.querySelectorAll(".scn-builder button")].find(b => /Add change/.test(b.textContent)));
    expect(api.get().scenarios[0].patches).toHaveLength(1);
    expect(api.get().scenarios[0].patches[0]).toMatchObject({ kind: "field", path: "cash", value: 1000000 });
  });

  it("saves a scenario so it persists", () => {
    const api = scenariosView(demoDoc());
    fireEvent.click([...api.container.querySelectorAll("button")].find(b => /New scenario/.test(b.textContent)));
    fireEvent.click([...api.container.querySelectorAll(".modal-foot button")].find(b => /Save scenario/.test(b.textContent)));
    expect(api.get().scenarios[0].saved).toBe(true);
  });
});
