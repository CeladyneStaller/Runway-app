// Fringe: itemized inputs vs manual override, and the precedence. The engine math is in
// engine/fringe.test.js; this covers the UI wiring — that changing inputs actually moves the resolved
// rate and thus payroll cost.
import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { canaryDoc as demoDoc } from "../../src/state/document";

// stateful harness so the component actually re-renders on setDoc (the inner RunwayApp is controlled)
function fringeTab(initial) {
  const ref = { current: initial };
  function Harness() {
    const [d, setD] = useState(initial);
    ref.current = d;
    return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
  }
  const { container } = render(<Harness />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /Payroll/.test(b.textContent)));
  fireEvent.click([...container.querySelectorAll(".subtab")].find(b => /Fringe/.test(b.textContent)));
  return { container, get: () => ref.current };
}

describe("fringe UI", () => {
  it("defaults to itemized mode with the input groups", () => {
    const { container } = fringeTab(demoDoc());
    expect(container.textContent).toMatch(/Paid time off/);
    expect(container.textContent).toMatch(/401\(k\)/);
    expect(container.textContent).toMatch(/Group insurance/);
  });

  it("switches to manual mode", () => {
    const { container } = fringeTab(demoDoc());
    fireEvent.click([...container.querySelectorAll(".frg-mode")].find(b => /Manual/.test(b.textContent)));
    expect(container.querySelector(".frg-manual")).toBeTruthy();
  });

  it("a manual override writes to the fringe config", () => {
    const api = fringeTab(demoDoc());
    fireEvent.click([...api.container.querySelectorAll(".frg-mode")].find(b => /Manual/.test(b.textContent)));
    const input = api.container.querySelector(".frg-manual .inp");
    fireEvent.change(input, { target: { value: "45" } });
    expect(api.get().settings.fringe.manualPct).toBe("45");
    expect(api.get().settings.fringe.mode).toBe("manual");
  });

  it("itemized inputs write to the config", () => {
    const api = fringeTab(demoDoc());
    const vacInput = api.container.querySelector(".frg-grid .inp");
    fireEvent.change(vacInput, { target: { value: "15" } });
    expect(api.get().settings.fringe.vacationDays).toBe("15");
  });

  it("the resolved rate shows in the burden calc and updates with manual override", () => {
    const api = fringeTab(demoDoc());
    // demo starts at 30% (blank config -> legacy)
    expect(api.container.textContent).toMatch(/30%/);
    fireEvent.click([...api.container.querySelectorAll(".frg-mode")].find(b => /Manual/.test(b.textContent)));
    fireEvent.change(api.container.querySelector(".frg-manual .inp"), { target: { value: "50" } });
    expect(api.container.textContent).toMatch(/50%/);
  });
});
