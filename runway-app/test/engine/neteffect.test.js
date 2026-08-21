import { describe, it, expect } from "vitest";
import { buildProjection } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { confidenceBand } from "../../src/engine/band.js";
import { buildChart } from "../../src/engine/charts.js";

/** ⚠️ NET EFFECT, ACROSS EVERY SURFACE AT ONCE.
 *
 *  `causality.test.js` perturbs ONE input and checks ONE number. This perturbs a PAIR — a purchase order
 *  and the fulfilment work that serves it — and checks FIVE surfaces, because the defects worth catching
 *  are disagreements between surfaces rather than a wrong number on any one of them.
 *
 *  The scenario is deliberately the smallest thing that is still a real transaction: a $10,000 order with
 *  a $5,000 cost to deliver it. Net $5,000. Then vary two things independently — the ORDER'S TIER, and
 *  whether the work came in ON, UNDER or OVER budget — and every surface has a defensible answer.
 *
 *  ⚠️ THE MOST IMPORTANT CELL IS `floor` ON AN EXPECTED-TIER ROW, AND IT IS ZERO. Not −$6,000. If the
 *  fulfilment cost did not inherit the order's tier, the committed-only floor would book the COST of a
 *  win it had not booked the REVENUE of, and that row would read −$6,000. `syncFulfilStage` stamps the
 *  PO's confidence onto every line of the project that serves it, and its comment says why: "you don't
 *  buy the materials, or book the engineer, for a quote you haven't won." Verified — unlink the project
 *  from its PO and that cell goes to −$6,000, which is exactly the regression this table exists to catch.
 *
 *  Fixture is deliberately bare: $300k, $50k a month, no commitments, no cost share, no payroll, no
 *  history (so `burnCV` is 0 and the band's cost scaling is the identity). Every number below is an exact
 *  integer anyone can check by hand. The canary is the wrong fixture for this — a royalty rides on its
 *  revenue, so $10,000 of order is worth $9,800 and the table would be asserting the absence of a feature.
 */

const ALL = { committed: true, expected: true, speculative: true, financing: false };
const MONTH = 2;              // the PO pays during month 1, so it first shows at the START of month 2
const BASELINE = 200000;      // 300000 − 50000 × 2

const doc = (pos = [], projects = []) => ({
  startY: 2026, startM: 0, cash: 300000,
  lines: [{ id: "burn", label: "Opex", kind: "cost", cadence: "recurring", amount: 50000, start: 0, end: null }],
  employees: [], projects, pos, rounds: [], saas: [], history: [],
  cashActuals: {}, commitments: [], milestones: [],
  settings: { toggles: ALL, anchorActuals: false },
});

const scenario = (tier, fulfil) => doc(
  [{ id: "po1", name: "Acme PO", customer: "Acme", amount: 10000, depositPct: 0,
     bookedMonth: 1, deliveryMonth: 1, termsDays: 0, confidence: tier }],
  fulfil == null ? [] : [{
    id: "pj1", name: "Acme fulfilment", type: "fulfillment", poId: "po1", include: true,
    startM: 1, endM: 1, months: 1,
    lines: [{ id: "f1", label: "Acme BOM", kind: "cost", cadence: "onetime", amount: fulfil, start: 1 }],
  }],
);

/** Every surface that claims to show cash at a month, read at the same month. */
const surfaces = (d) => {
  const t = d.settings.toggles;
  const band = confidenceBand(d, undefined,
    { committed: !!t.committed, expected: !!t.expected, speculative: !!t.speculative });
  return {
    // the dashboard line: whatever tiers are switched on
    runway: buildProjection(buildModelFromDoc(d), t)[MONTH].start,
    // the Cash flow tab: committed only, by definition, whatever the toggles say
    flow: buildChart("flow.runway", d).series[0].values[MONTH],
    floor: band.floor.rows[MONTH].start,       // committed only
    expected: band.expected.rows[MONTH].start, // committed + expected
    ceiling: band.ceiling.rows[MONTH].start,   // every tier
  };
};

// `net` is the transaction's own arithmetic: 10000 in, `fulfil` out.
// `seenBy` is which surfaces are entitled to see it. Everything else must read EXACTLY zero.
const SCENARIOS = [
  { tier: "committed",   fulfil: null, net: 10000, seenBy: ["runway", "flow", "floor", "expected", "ceiling"] },
  { tier: "committed",   fulfil: 4000, net:  6000, seenBy: ["runway", "flow", "floor", "expected", "ceiling"] },
  { tier: "committed",   fulfil: 5000, net:  5000, seenBy: ["runway", "flow", "floor", "expected", "ceiling"] },
  { tier: "committed",   fulfil: 6000, net:  4000, seenBy: ["runway", "flow", "floor", "expected", "ceiling"] },

  { tier: "expected",    fulfil: null, net: 10000, seenBy: ["runway", "expected", "ceiling"] },
  { tier: "expected",    fulfil: 4000, net:  6000, seenBy: ["runway", "expected", "ceiling"] },
  { tier: "expected",    fulfil: 5000, net:  5000, seenBy: ["runway", "expected", "ceiling"] },
  { tier: "expected",    fulfil: 6000, net:  4000, seenBy: ["runway", "expected", "ceiling"] },

  { tier: "speculative", fulfil: null, net: 10000, seenBy: ["runway", "ceiling"] },
  { tier: "speculative", fulfil: 4000, net:  6000, seenBy: ["runway", "ceiling"] },
  { tier: "speculative", fulfil: 5000, net:  5000, seenBy: ["runway", "ceiling"] },
  { tier: "speculative", fulfil: 6000, net:  4000, seenBy: ["runway", "ceiling"] },
];

const SURFACES = ["runway", "flow", "floor", "expected", "ceiling"];

describe("the fixture is arithmetic anyone can check", () => {
  it("sits at $200,000 at month 2 before anything is added", () => {
    // If this drifts, all sixty numbers below are measuring something else.
    const s = surfaces(doc());
    for (const k of SURFACES) expect(s[k], k).toBe(BASELINE);
  });
});

describe("⚠️ a PO and its fulfilment, across tier × budget × surface", () => {
  for (const { tier, fulfil, net, seenBy } of SCENARIOS) {
    const label = `${tier} PO, ${fulfil == null ? "no fulfilment cost" : `$${fulfil} fulfilment`}`;
    it(`${label} → net $${net}, seen by ${seenBy.join(", ")}`, () => {
      const s = surfaces(scenario(tier, fulfil));
      for (const k of SURFACES) {
        const want = seenBy.includes(k) ? net : 0;
        // ⚠️ EXACT, INCLUDING THE ZEROS. A surface not entitled to see this transaction must move by
        // NOTHING — not a little, not in the right direction. Every leak found in this engine was
        // something moving that should not have, and only an equality catches that.
        expect(Math.round(s[k] - BASELINE), `${label} · ${k}`).toBe(want);
      }
    });
  }
});

describe("what the zeros are actually proving", () => {
  it("⚠️ THE FULFILMENT COST INHERITS THE ORDER'S TIER, or the floor would go negative", () => {
    // The single most load-bearing cell in the table above: `expected` tier, $6,000 of fulfilment, read
    // on the committed-only floor. It is 0. It is 0 because `syncFulfilStage` stamps the PO's confidence
    // onto the project's lines, so the gate drops the cost and the revenue TOGETHER.
    //
    // Unlink the project from its order and the stamping does not happen — the revenue is still gated
    // and the cost is not, so the floor books $6,000 of spend for a sale it refused to count. Asserting
    // the broken value here proves the table is measuring the pairing and not something incidental.
    const linked = scenario("expected", 6000);
    const unlinked = {
      ...linked,
      projects: [{ ...linked.projects[0], type: "internal", poId: undefined }],
    };
    expect(Math.round(surfaces(linked).floor - BASELINE)).toBe(0);
    expect(Math.round(surfaces(unlinked).floor - BASELINE)).toBe(-6000);
  });

  it("⚠️ AND THE PROBE IS LIVE — the same order does move the ceiling", () => {
    // A zero that comes from the input being ignored entirely would be worthless. The speculative rows
    // read 0 on four surfaces and $5,000 on the ceiling, which is what makes the four zeros mean
    // "correctly gated" rather than "silently dropped".
    const s = surfaces(scenario("speculative", 5000));
    expect(Math.round(s.ceiling - BASELINE)).toBe(5000);
    expect(Math.round(s.floor - BASELINE)).toBe(0);
  });

  it("the Cash flow tab ignores the toggles, because it is a definition", () => {
    // `flow` tracks `floor` on every row of the table and never `runway`. That is not a coincidence —
    // the Cash flow chart is committed-only BY DEFINITION and does not consult `settings.toggles`, so
    // switching every tier on cannot move it. If these ever diverge, one of them has grown an opinion.
    const d = scenario("expected", 5000);
    const withAllOff = { ...d, settings: { ...d.settings,
      toggles: { committed: true, expected: false, speculative: false, financing: false } } };
    expect(buildChart("flow.runway", d).series[0].values[MONTH])
      .toBe(buildChart("flow.runway", withAllOff).series[0].values[MONTH]);
  });
});
