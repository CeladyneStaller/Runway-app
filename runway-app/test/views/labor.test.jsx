// Labor prioritization tab. Engine (laborPriorities) is tested in engine/labor.test.js; this covers the
// tab rendering the ranking and being reachable via routing.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { canaryDoc as demoDoc } from "../../src/state/document";

function payrollTab(doc) {
  let d = doc;
  const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /Payroll/.test(b.textContent)));
  return { container, get: () => d };
}

describe("labor prioritization tab", () => {
  it("has a Prioritization sub-tab", () => {
    const { container } = payrollTab(demoDoc());
    expect([...container.querySelectorAll(".subtab")].some(b => /Prioritization/.test(b.textContent))).toBe(true);
  });

  it("shows a ranked row per employee", () => {
    const { container } = payrollTab(demoDoc());
    fireEvent.click([...container.querySelectorAll(".subtab")].find(b => /Prioritization/.test(b.textContent)));
    expect(container.textContent).toMatch(/Labor prioritization/);
    const bodyRows = container.querySelectorAll(".lp-tbl tbody tr");
    expect(bodyRows.length).toBe(demoDoc().employees.length);
  });

  it("shows net, cost-only, and per-100h columns", () => {
    const { container } = payrollTab(demoDoc());
    fireEvent.click([...container.querySelectorAll(".subtab")].find(b => /Prioritization/.test(b.textContent)));
    expect(container.textContent).toMatch(/Net . runway/);
    expect(container.textContent).toMatch(/Cost-only/);
    expect(container.textContent).toMatch(/grant-hrs/i);
  });

  it("is reachable by hash (#pay/priority)", () => {
    window.location.hash = "#pay/priority";
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    expect(container.textContent).toMatch(/Labor prioritization/);
    window.location.hash = "";
  });
});
