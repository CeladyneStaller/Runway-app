// Hash routing end to end: clicking nav updates the hash, a tab change updates the hash, and loading
// with a hash restores the view+tab. Pure parse/format is in engine/hashroute.test.js.
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { canaryDoc as demoDoc } from "../../src/state/document";

describe("hash routing", () => {
  beforeEach(() => { window.location.hash = ""; });

  it("clicking a nav item updates the hash", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Spend history/.test(b.textContent)));
    expect(window.location.hash).toBe("#hist");
  });

  it("changing a sub-tab writes the tab into the hash", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Spend history/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll(".subtab")].find(b => b.textContent.startsWith("Ledger")));
    expect(window.location.hash).toBe("#hist/ledger");
  });

  it("loading with a hash restores the view and tab", () => {
    window.location.hash = "#sales/orders";
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    // the Sales view is shown with the Orders tab active
    const activeSub = container.querySelector(".subtab.on");
    expect(activeSub?.textContent).toMatch(/Orders/);
  });

  it("an unknown tab for a view falls back to that view's default (never blank)", () => {
    window.location.hash = "#proj/ledger";   // 'ledger' isn't a Projects tab
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    // Projects renders, defaulting to 'All' rather than showing nothing
    const activeSub = container.querySelector(".subtab.on");
    expect(activeSub?.textContent).toMatch(/All/);
  });

  it("switching views clears the previous view's tab from the hash", () => {
    window.location.hash = "#hist/ledger";
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Payroll/.test(b.textContent)));
    expect(window.location.hash).toBe("#pay");   // not #pay/ledger
  });
});
