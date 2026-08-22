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

describe("⚠️ purchase-order timing — family B's PO half", () => {
  it("cash never lands before the order that earns it", async () => {
    // ⚠️ `poPaidMonth` IS `(po.deliveryMonth || 0) + poLag(po)`, AND `|| 0` IS A VALID MONTH. Two
    // hardware-vc orders were authored with `shipMonth`, a field NOTHING reads — not the engine, not
    // the editor, not the new-PO modal, not the factors registry. Both therefore delivered in "month
    // zero": Bay Terminal booked in month 3 and was PAID IN MONTH 1, two months before the order
    // existed. No error, no warning, just money arriving early.
    //
    // Paid-after-booked is the semantic invariant that catches it without the engine having to change
    // how it reads an absent field on documents that already exist.
    const { poPaidMonth } = await import("../../src/engine/sales.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      for (const po of demoDoc(a.id).pos || []) {
        const who = `${a.id} · ${po.customer}`;
        expect(Number.isFinite(po.deliveryMonth), `${who} has no deliveryMonth`).toBe(true);
        expect(poPaidMonth(po), `${who} is paid before it is booked`)
          .toBeGreaterThanOrEqual(po.bookedMonth ?? 0);
        expect(poPaidMonth(po), `${who} is paid before it is delivered`)
          .toBeGreaterThanOrEqual(po.deliveryMonth);
      }
    }
  });

  it("terms round UP to whole months, so net 45 and net 60 both land two months out", async () => {
    // Stated in `poLag`'s own comment — `round()` let net-40 land at 30 days, and `ceil()` means the
    // model never books money before the terms allow it. Conservative by construction.
    const { poLag, poPaidMonth } = await import("../../src/engine/sales.js");
    expect([0, 30, 31, 45, 60, 61, 90].map(poLag_ => poLag({ termsDays: poLag_ }))).toEqual([0, 1, 2, 2, 2, 3, 3]);
    expect(poPaidMonth({ deliveryMonth: 5, termsDays: 45 })).toBe(7);
    expect(poPaidMonth({ deliveryMonth: 5, termsDays: 60 })).toBe(7);
    expect(poPaidMonth({ deliveryMonth: 5, termsDays: 61 })).toBe(8);
  });

  it("a deposit lands when the order is booked, the balance when it is paid", async () => {
    // Two dates, two tiers of certainty in one row — and the deposit is the earlier of the two.
    const { compilePO } = await import("../../src/engine/sales.js");
    const lines = compilePO({ amount: 100000, depositPct: 0.3, bookedMonth: 2, deliveryMonth: 6,
      termsDays: 30, confidence: "expected" });
    const dep = lines.find(l => /Deposit/.test(l.label));
    const bal = lines.find(l => /Balance/.test(l.label));
    expect(dep).toMatchObject({ amount: 30000, start: 2, confidence: "expected" });
    expect(bal).toMatchObject({ amount: 70000, start: 7, confidence: "expected" });
    expect(dep.amount + bal.amount).toBe(100000);
  });
});

describe("⚠️ milestones must not duplicate what roundMS derives", () => {
  it("no authored milestone shares a month with a derived round close", async () => {
    // ⚠️ `roundMS` DERIVES A CRITICAL DATE FROM EVERY OPEN INSTRUMENT, and `capital.js` states the rule:
    // "A close date IS a critical date. Derive it rather than asking anyone to keep two copies in step —
    // move the close in Investment and the milestone, the chart marker and the balance all follow."
    //
    // Authoring a second one puts two markers on one event. They agree on the day they are written and
    // drift the first time somebody moves the close. saas shipped exactly that: "Seed close or extend"
    // authored at month 6 beside "Seed round close" derived at month 6.
    //
    // A shared month is the detectable form. It also catches the softer version — an unrelated milestone
    // landing on the close date, which reads as clutter even when it is not a duplicate.
    const { roundMS } = await import("../../src/engine/capital.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      const doc = demoDoc(a.id);
      const derived = roundMS(doc.rounds, doc.startY, doc.startM);
      const taken = new Set(derived.map((m) => `${m.y}-${m.m}`));
      for (const ms of doc.milestones || []) {
        const clash = derived.find((r) => r.y === ms.y && r.m === ms.m);
        expect(taken.has(`${ms.y}-${ms.m}`),
          `${a.id}: "${ms.label}" lands on the same month as the derived "${clash?.label}"`).toBe(false);
      }
    }
  });

  it("and no authored milestone is labelled like a round close", async () => {
    // The label is the other half. `roundMS` names its own "<round> close"; an authored milestone using
    // that wording is claiming to be the same thing whatever month it sits in.
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      for (const ms of demoDoc(a.id).milestones || []) {
        expect(/\bclose\b/i.test(ms.label), `${a.id}: "${ms.label}" reads as a round close`).toBe(false);
      }
    }
  });
});

describe("⚠️ every recorded cost resolves to a project or to overhead", () => {
  it("no demo ships an unmapped ledger code", async () => {
    // `resolveLine` returns a projectId, OVERHEAD, or NULL — and null means the spend sits in the
    // baseline attributed to nothing. Every archetype shipped with `codeMap: {}` while its ledger used
    // 6000 and 5000, so 100% of recorded spend was unattributed: plan-against-actual had nothing to
    // compare per project, and variance-by-code had nothing to name.
    const { codesInLedger, unmappedCodes } = await import("../../src/engine/coding.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      const doc = demoDoc(a.id);
      expect(codesInLedger(doc.history || []).length, `${a.id} has no ledger codes`).toBeGreaterThan(0);
      const unmapped = unmappedCodes(doc.history || [], doc.codeMap);
      expect(unmapped, `${a.id}: unmapped ledger codes ${unmapped.join(", ")}`).toEqual([]);
    }
  });

  it("⚠️ AND NO LEDGER LINE IS UNCODED, which `unmappedCodes` cannot see", async () => {
    // `codesInLedger` skips falsy codes, so a line with `code: ""` is not merely unmapped — it is
    // INVISIBLE to the mapping check. The demo generator used an empty code for its third bucket, so a
    // fifth of every month's spend resolved to nothing and no mapping report would ever mention it.
    // Checking `resolveLine` per LINE catches what checking codes cannot.
    const { resolveLine } = await import("../../src/engine/coding.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      const doc = demoDoc(a.id);
      const maps = { codeMap: doc.codeMap, customerMap: doc.customerMap };
      for (const month of doc.history || []) {
        for (const l of month.lines || []) {
          expect(resolveLine(l, maps), `${a.id} month ${month.month}: "${l.note || l.code}" resolves to nothing`)
            .not.toBeNull();
        }
      }
    }
  });
});

describe("⚠️ the ledger records receipts, not only spend", () => {
  it("every demo books revenue, and `kind` says so", async () => {
    // ⚠️ `lineKind` DEFAULTS TO COST AND THAT IS LOAD-BEARING — a receipt without `kind: "revenue"` is
    // counted as money going OUT. Every demo recorded six months of spend and no receipts at all, so
    // "Forecast against booked" had nothing to compare and the whole revenue half of the ledger was
    // untested by any fixture.
    const { monthRevenue, monthTotal } = await import("../../src/engine/coding.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      const hist = demoDoc(a.id).history || [];
      expect(hist.some((h) => monthRevenue(h) > 0), `${a.id} books no revenue`).toBe(true);
      // and every month still records spend — receipts must not have displaced the cost lines
      expect(hist.every((h) => monthTotal(h) > 0), `${a.id} has a month with no spend`).toBe(true);
    }
  });

  it("⚠️ RECEIPTS DO NOT MOVE `burnVariance`, because `monthTotal` sums COSTS ONLY", async () => {
    // The ledger's spend story has to survive the revenue being added beside it. If a receipt ever
    // counted toward burn, the confidence band would narrow or widen for a reason nobody could see.
    const { confidenceBand } = await import("../../src/engine/band.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      const doc = demoDoc(a.id);
      const stripped = { ...doc, history: (doc.history || []).map((h) => ({ ...h,
        lines: (h.lines || []).filter((l) => l.kind !== "revenue") })) };
      const R = { committed: true, expected: true, speculative: false };
      expect(confidenceBand(doc, undefined, R).burnCV, a.id)
        .toBe(confidenceBand(stripped, undefined, R).burnCV);
    }
  });

  it("booked revenue reaches the forecast chart, for POs as well as subscriptions", async () => {
    // The gate was `if (!doc.saas.length)` — a SUBSCRIPTION check standing in for a REVENUE check, so a
    // hardware company with $680,000 of collected orders read "No revenue lines yet."
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const { buildProjection } = await import("../../src/engine/projection.js");
    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    for (const a of ARCHETYPES) {
      const doc = demoDoc(a.id);
      const parts = buildModelParts(doc);
      parts.rows = buildProjection(parts.model, doc.settings?.toggles || {});
      const spec = buildChart("sales.forecast", doc, parts);
      expect(spec.empty, `${a.id}: ${spec.empty}`).toBeFalsy();
      const booked = spec.series.find((s) => s.id === "booked").values;
      expect(booked.some((v) => v > 0), `${a.id}: booked is flat zero`).toBe(true);
      expect(booked.length, `${a.id}: booked disagrees with its axis`).toBe(spec.x.length);
    }
  });
});
