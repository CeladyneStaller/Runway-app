// ONE MODEL ASSEMBLY. App used to rebuild the projection model inline — fringe, payroll lines, project
// rates, baseline burn, revenue replacement — while scenarios, confidence bands and labor prioritisation
// went through buildModelFromDoc. Two parallel assemblies, pinned together by a single golden assertion,
// free to diverge on any other document or toggle combination. They were verified identical across 272
// combinations and then merged; the band-alignment bug ($114k apart at month 3) is what divergence costs.
//
// This guards the merge through the PUBLIC surface: the number on screen must equal what the engine
// computes from the same document. If anyone reintroduces a second assembly, this goes red.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc, emptyDoc } from "../../src/state/document";
import { buildModelFromDoc, buildProjection, anchorToActuals, zeroInfo, HORIZON } from "../../src/engine";

const TOGGLES = [
  { committed: true, expected: true, speculative: false, financing: false },   // the golden set
  { committed: true, expected: true, speculative: true, financing: false },
  { committed: true, expected: true, speculative: false, financing: true },
  { committed: true, expected: true, speculative: true, financing: true },
  { committed: true, expected: false, speculative: false, financing: false },
];

const DOCS = {
  demo: () => demoDoc(),
  noEmployees: () => { const d = demoDoc(); d.employees = []; return d; },
  noProjects: () => { const d = demoDoc(); d.projects = []; return d; },
  baselineOff: () => { const d = demoDoc(); d.settings.applyBaseline = false; return d; },
  manualFringe: () => { const d = demoDoc(); d.settings.fringe = { mode: "manual", pct: 0.42 }; return d; },
  committedRounds: () => { const d = demoDoc(); d.rounds = d.rounds.map(r => ({ ...r, status: "committed" })); return d; },
};

// what the engine says, anchored the way App anchors it
const engineRunway = (doc) => {
  const rows = anchorToActuals(
    buildProjection(buildModelFromDoc(doc), doc.settings.toggles),
    doc.cashActuals, doc.settings.anchorActuals);
  const z = zeroInfo(rows, doc.startY, doc.startM);
  // THE DISPLAYED FIGURE IS `fromNow`, not the index from the model's start. This parity test is the
  // one that catches a UI showing a different number from the engine — so it has to compare against
  // what the UI is supposed to show, which is months from today.
  return z ? `${(z.fromNow ?? z.months).toFixed(1)} mo` : `${HORIZON}+ mo`;
};

// what the app renders in the hero
const renderedRunway = (doc) => {
  function H() { const [d] = useState(doc); return <RunwayApp doc={d} setDoc={() => {}} />; }
  const { container } = render(<H />);
  return container.querySelector(".stat.hero .big")?.textContent?.trim() ?? null;
};

describe("the dashboard and the engine share one model assembly", () => {
  for (const [name, mk] of Object.entries(DOCS)) {
    for (const toggles of TOGGLES) {
      const tag = `c${+toggles.committed}e${+toggles.expected}s${+toggles.speculative}f${+toggles.financing}`;
      it(`${name} @ ${tag}: rendered runway equals the engine's`, () => {
        const doc = mk();
        doc.settings.toggles = toggles;
        expect(renderedRunway(doc)).toBe(engineRunway(doc));
      });
    }
  }

  it("an empty document is handled by both without diverging", () => {
    const d = emptyDoc();
    d.cash = 180000;
    d.lines = [{ id: "x", label: "burn", kind: "cost", cadence: "recurring", amount: 30000, start: 0, end: null }];
    d.settings.toggles = TOGGLES[0];
    expect(renderedRunway(d)).toBe(engineRunway(d));
  });
});
