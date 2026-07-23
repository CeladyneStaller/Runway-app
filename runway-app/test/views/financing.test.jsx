// The financing toggle surfaced on the dashboard, alongside the revenue tiers but as a SEPARATE axis.
// It must drive the same doc.settings.toggles.financing the Investment tab uses, so the two stay in sync.
import { describe, it, expect } from "vitest";
import { useState } from "react";
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

describe("financing feeds the speculative line (regression: stale memo froze it)", () => {
  // stateful harness so toggling financing actually re-renders the controlled RunwayApp
  function harness(initial) {
    function Harness() {
      const [d, setD] = useState(initial);
      return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
    }
    return render(<Harness />);
  }
  const upsideD = (c) => c.querySelector('[data-trace="upside"]')?.getAttribute("d");

  it("toggling financing moves the 'with speculative' line when speculative is off", () => {
    const d = demoDoc();
    // speculative OFF (so a separate upside line is drawn), financing OFF to start
    d.settings.toggles = { committed: true, expected: true, speculative: false, financing: false };
    const { container } = harness(d);

    const before = upsideD(container);
    expect(before).toBeTruthy();   // the dashed "with speculative" line is present

    // turn financing on via the dashboard toggle
    fireEvent.click(container.querySelector(".fin-toggle"));

    const after = upsideD(container);
    expect(after).toBeTruthy();
    // the speculative line must now incorporate the fundraise, so its path changes.
    // (with the stale [model]-only memo it stayed byte-identical — this is the regression guard.)
    expect(after).not.toBe(before);
  });

  it("with financing on + speculative on, there is no separate upside line (it IS the projection)", () => {
    const d = demoDoc();
    d.settings.toggles = { committed: true, expected: true, speculative: true, financing: true };
    const { container } = harness(d);
    // all three tiers on => showUpside is false => no separate dashed speculative line
    expect(container.querySelector('[data-trace="upside"]')).toBeNull();
  });
});

describe("the confident-line floor also reacts to financing (same stale-memo class)", () => {
  function harness(initial) {
    function H() {
      const [d, setD] = useState(initial);
      return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
    }
    return render(<H />);
  }

  it("toggling financing moves the 'confident to <date>' floor when the raise is expected-tier", () => {
    const d = demoDoc();
    // a signed term sheet is expected-tier (INST_CONF: committed -> expected), so it reaches a
    // speculative-free line. With the demo's default planning-stage raise the bug is invisible.
    d.rounds = d.rounds.map(r => ({ ...r, status: "committed" }));
    d.settings.toggles = { committed: true, expected: true, speculative: true, financing: false };
    const { container } = harness(d);

    const confText = () => container.querySelector(".meta.conf")?.textContent?.trim() ?? null;
    const before = confText();
    expect(before).toBeTruthy();                     // the floor is shown while speculative is on

    fireEvent.click(container.querySelector(".fin-toggle"));   // financing on

    // with the raise included, the speculative-free floor genuinely changes; a stale memo held it fixed
    expect(confText()).not.toBe(before);
  });
});
