// The projection journal's UI: past forecasts overlaid on recorded reality, plus the honest framing
// about what a gap between them actually means.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { SEED_JOURNAL } from "../../src/seed";
import { canaryDoc as demoDoc, emptyDoc } from "../../src/state/document";
import { JournalPanel } from "../../src/views/chrome/JournalPanel";

function harness(initial) {
  const ref = { current: initial };
  function H() {
    const [d, setD] = useState(initial);
    ref.current = d;
    return <RunwayApp doc={d} setDoc={(v) => setD(p => (typeof v === "function" ? v(p) : v))} />;
  }
  const { container } = render(<H />);
  return { container, get: () => ref.current };
}
const toForecasts = (container) => {
  fireEvent.click([...container.querySelectorAll("button")].find(b => /history/i.test(b.textContent)));
  const t = [...container.querySelectorAll(".subtab")].find(b => /forecasts/i.test(b.textContent));
  if (t) fireEvent.click(t);
};

describe("forecast journal panel", () => {
  it("draws one line per past snapshot, plus today's forecast", () => {
    const h = harness(demoDoc());
    toForecasts(h.container);
    const past = h.container.querySelectorAll('[data-jr="past"]');

    // ⚠️ NOT A FIXED COUNT — THIS TEST WAS TIME-DEPENDENT AND ROTTED.
    //
    // The demo seeds four weekly snapshots, the newest dated 22 July 2026. The app takes an automatic
    // snapshot on load when one is due, so once the clock passed 29 July the mount produced a FIFTH and
    // the assertion of exactly four began failing — with nothing wrong in the app.
    //
    // A test that depends on how long ago the fixture was written is a test that fails on a date
    // nobody chose. Assert the seeded ones are all drawn, and allow the automatic one.
    expect(past.length).toBeGreaterThanOrEqual(SEED_JOURNAL.length);
    expect(past.length).toBeLessThanOrEqual(SEED_JOURNAL.length + 1);
    expect(h.container.querySelector('[data-jr="current"]')).toBeTruthy();
  });

  it("plots the cash that was actually recorded, so the gap is visible", () => {
    const h = harness(demoDoc());
    toForecasts(h.container);
    expect(h.container.querySelectorAll('[data-jr="actual"]').length).toBeGreaterThan(0);
  });

  it("lists each snapshot with the runway it predicted", () => {
    const h = harness(demoDoc());
    toForecasts(h.container);
    // the seeded demo forecasts tighten from 6.5 to 5.7 months
    expect(h.container.textContent).toMatch(/6\.5 mo/);
    expect(h.container.textContent).toMatch(/5\.7 mo/);
  });

  it("says plainly that a gap is plan-versus-reality, not pure forecast error", () => {
    const h = harness(demoDoc());
    toForecasts(h.container);
    expect(h.container.textContent).toMatch(/plan versus reality/i);
  });

  it("'Snapshot now' records one into the document", () => {
    const h = harness(demoDoc());
    toForecasts(h.container);
    const before = h.get().journal.length;
    fireEvent.click([...h.container.querySelectorAll("button")].find(b => /snapshot now/i.test(b.textContent)));
    expect(h.get().journal.length).toBe(before + 1);
    expect(h.get().journal[h.get().journal.length - 1].auto).toBe(false);   // manual, not the weekly one
  });

  it("an empty document records nothing automatically — zeroes would poison the statistics", () => {
    // a brand-new document shows onboarding rather than the app shell, so there is nothing to navigate
    // to; what matters is that no snapshot is manufactured from an empty plan.
    const h = harness(emptyDoc());
    expect(h.get().journal).toEqual([]);
  });

  it("shows an empty state, rather than a blank panel, before the first snapshot", () => {
    const { container } = render(
      <JournalPanel journal={[]} currentCurve={[]} cashActuals={{}} startY={2026} startM={6} onSnapshot={() => {}} />
    );
    expect(container.textContent).toMatch(/No snapshots yet/i);
    expect(container.querySelectorAll('[data-jr="past"]').length).toBe(0);
  });

  it("a document with cash takes its first snapshot immediately — the clock starts on first use", () => {
    const d = emptyDoc();
    d.cash = 250000;
    const h = harness(d);
    expect(h.get().journal.length).toBe(1);
    expect(h.get().journal[0].auto).toBe(true);
    expect(h.get().journal[0].cash).toBe(250000);
  });
});
