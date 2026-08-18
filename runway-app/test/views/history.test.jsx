// Spend history was unreachable for the app's entire life: HIST was a module constant, so the
// History view could only ever display the demo's six months. The measured-burn baseline — the
// feature that says "your line items claim $67k/mo, your bank says $78k" — could not be fed by
// anyone with their own numbers. These tests cover the way in.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { emptyDoc, canaryDoc as demoDoc } from "../../src/state/document";

function mount(doc) {
  let d = doc;
  const api = { get: () => d };
  const { container, rerender } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; api.doc = d; }} />);
  api.container = container;
  api.rerender = () => rerender(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; api.doc = d; }} />);
  api.click = (re, sel = "button") => { const b = [...container.querySelectorAll(sel)].find(x => re.test(x.textContent)); if (b) fireEvent.click(b); return !!b; };
  return api;
}
const toBurn = (api) => { api.click(/Spend history/i); api.click(/^Burn/, ".subtab"); };

describe("spend history", () => {
  it("says what's missing rather than showing an empty chart", () => {
    const api = mount({ ...emptyDoc(), cash: 100000 });
    toBurn(api);
    expect(api.container.textContent).toMatch(/No months recorded/i);
    expect(api.container.textContent).toMatch(/what your line items claim — never what they miss/i);
  });

  it("adding a month writes to the document", () => {
    const api = mount({ ...emptyDoc(), cash: 100000 });
    toBurn(api);
    expect(api.click(/Month/)).toBe(true);
    expect(api.doc.history).toHaveLength(1);
  });

  it("labels months from the projection start, not from a typed string", () => {
    const api = mount(demoDoc());   // starts Jul 2026, six months of history
    toBurn(api);
    // the six months before month 0 are Jan..Jun 26 — derived, so they follow startY/startM
    ["Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26"].forEach(m =>
      expect(api.container.textContent).toContain(m));
  });

  it("follows the start date instead of hardcoding the year", () => {
    const api = mount({ ...demoDoc(), startY: 2029, startM: 0 });
    toBurn(api);
    expect(api.container.textContent).toContain("Jul 28");   // six months before Jan 2029
    expect(api.container.textContent).not.toContain("Jan 26");
  });

  it("deleting a month re-points the flag overrides it would otherwise strand", () => {
    // flagOverrides is keyed by index. Removing month 1 shifts every later month down one, so an
    // override on month 3 would silently start excluding month 4.
    const doc = { ...demoDoc(), flagOverrides: { 3: true, 5: false } };
    const api = mount(doc);
    toBurn(api);
    const rows = [...api.container.querySelectorAll("tbody tr")];
    fireEvent.click(rows[1].querySelector(".iconbtn"));   // delete the second month
    expect(api.doc.history).toHaveLength(5);
    expect(api.doc.flagOverrides).toEqual({ 2: true, 4: false });   // both moved down one
  });
});
