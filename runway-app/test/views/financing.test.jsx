// The financing toggle surfaced on the dashboard, alongside the revenue tiers but as a SEPARATE axis.
// It must drive the same doc.settings.toggles.financing the Investment tab uses, so the two stay in sync.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

describe("financing toggle on the dashboard", () => {
  it("renders one financing switch, distinct from the three revenue tiers", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    expect(container.querySelectorAll(".fin-toggle").length).toBe(1);
    expect(container.querySelectorAll(".tier").length).toBe(3);   // still exactly three tiers, not four
    expect(container.textContent).toMatch(/separate axis/i);      // labelled as its own axis
  });

  it("reflects the current financing state (off)", () => {
    const d = demoDoc();
    d.settings.toggles = { committed: true, expected: true, speculative: true, financing: false };
    const { container } = render(<RunwayApp doc={d} setDoc={() => {}} />);
    expect(container.querySelector(".fin-toggle").className).not.toMatch(/\bon\b/);
    expect(container.querySelector(".sw.fin").className).not.toMatch(/\bon\b/);
  });

  it("flips doc.settings.toggles.financing when clicked — the same field the Investment tab switches", () => {
    let d = demoDoc();
    d.settings.toggles = { committed: true, expected: true, speculative: true, financing: false };
    const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
    fireEvent.click(container.querySelector(".fin-toggle"));
    expect(d.settings.toggles.financing).toBe(true);   // shared source of truth => synced with Investment
  });

  it("shows how many instruments financing governs", () => {
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    // the demo seed has open instruments (a planned Series A and a debt facility)
    expect(container.querySelector(".fin-mid").textContent).toMatch(/instrument/);
  });
});
