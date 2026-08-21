import { describe, it, expect } from "vitest";
import { buildProjection, zeroInfo, anchorToActuals, forecastFrom } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { confidenceBand } from "../../src/engine/band.js";
import { buildChart } from "../../src/engine/charts.js";
import { canaryDoc, demoDoc } from "../../src/state/document.js";
import { ARCHETYPES } from "../../src/state/archetypes.js";

/** ⚠️ FIVE SURFACES, ONE CROSSING — READ AS DATES, NOT AS BALANCES.
 *
 *  `neteffect.test.js` perturbs a PO and reads five surfaces at one MONTH. This reads the same five as
 *  RUNWAY FIGURES, which is a different question and the one flag 1 was about: a balance is linear in
 *  its inputs and a crossing is not, so two surfaces can agree on every month's cash and still disagree
 *  about the date. That is exactly what shipped — the tile read "3.8 mo" above a range of "1.9 - 2.7".
 *
 *  The chain below is the whole product in one line:
 *
 *      floor  <=  committed-only  <=  headline == band expected  <=  ceiling
 *
 *  Each link says something a reader would otherwise have to take on trust:
 *    floor <= committed-only     the floor is committed revenue with costs scaled UP, so it cannot be
 *                                later than the same revenue at plan cost
 *    committed-only <= headline  the Cash flow tab counts strictly less money than the dashboard
 *    headline == band expected   THE FLAG 1 FIX. Not "close to" — the same computation, so exactly.
 *    <= ceiling                  every tier switched on is the most money there is
 */

const surfaces = (doc) => {
  const T = doc.settings.toggles;
  const from = forecastFrom(doc);
  const ca = doc.cashActuals || {};
  const rows = anchorToActuals(buildProjection(buildModelFromDoc(doc), T), ca, true);
  const band = confidenceBand(doc, undefined,
    { committed: !!T.committed, expected: !!T.expected, speculative: !!T.speculative });
  // The Cash flow tab's own line: committed revenue at plan cost, which is neither the floor nor the
  // dashboard. `financing` follows the document because a closed round is banked money either way.
  const committedOnly = anchorToActuals(
    buildProjection(buildModelFromDoc(doc),
      { committed: true, expected: false, speculative: false, financing: !!T.financing }), ca, true);
  const at = (rs) => zeroInfo(rs, doc.startY, doc.startM, from)?.fromNow ?? Infinity;
  return {
    floor: band.floor.zeroNull ? Infinity : band.floor.zeroFromNow,
    committed: at(committedOnly),
    headline: at(rows),
    expected: band.expected.zeroNull ? Infinity : band.expected.zeroFromNow,
    ceiling: band.ceiling.zeroNull ? Infinity : band.ceiling.zeroFromNow,
  };
};

const FIXTURES = () => [["canary", canaryDoc()], ...ARCHETYPES.map((a) => [a.id, demoDoc(a.id)])];

describe("⚠️ the five surfaces agree about one crossing", () => {
  for (const [name] of FIXTURES()) {
    it(`${name}: floor <= committed-only <= headline == expected <= ceiling`, () => {
      const doc = name === "canary" ? canaryDoc() : demoDoc(name);
      const s = surfaces(doc);

      // ⚠️ EQUALITY, NOT PROXIMITY. Post-flag-1 the headline and the band's expected curve are the same
      // computation over the same rows. A tolerance here would let them drift apart again and call it
      // agreement — which is precisely how "3.8 mo" came to sit above "1.9 - 2.7 mo".
      expect(s.headline, `${name}: headline vs band expected`).toBe(s.expected);

      expect(s.floor, `${name}: floor after committed-only`).toBeLessThanOrEqual(s.committed + 1e-9);
      expect(s.committed, `${name}: Cash flow after the dashboard`).toBeLessThanOrEqual(s.headline + 1e-9);
      expect(s.headline, `${name}: headline after the ceiling`).toBeLessThanOrEqual(s.ceiling + 1e-9);
    });
  }

  it("the Cash flow marker is the committed-only crossing, to its printed precision", () => {
    // The chart prints one decimal. Asserting to that precision is asserting what a READER sees — a
    // tighter comparison would test the formatter, and a looser one would let the marker drift off the
    // line it belongs to, which is the defect it replaced.
    for (const [name] of FIXTURES()) {
      const doc = name === "canary" ? canaryDoc() : demoDoc(name);
      const spec = buildChart("flow.runway", doc);
      const marker = spec?.markers?.[0];
      if (!marker) continue;
      const printed = Number(marker.label.replace(/[^0-9.]/g, ""));
      expect(printed, `${name}: marker "${marker.label}"`).toBeCloseTo(surfaces(doc).committed, 1);
    }
  });
});

describe("⚠️ a tier moves exactly the surfaces entitled to see it", () => {
  // One perturbation, three tiers, five surfaces — the propagation matrix, read as DATES. The zeros are
  // the assertions that matter: a surface not entitled to this money must not move at all.
  const base = () => demoDoc("grant-startup");
  const withRevenue = (tier) => {
    const doc = base();
    return { ...doc, lines: [...(doc.lines || []),
      { id: "probe", kind: "revenue", cadence: "onetime", amount: 250000,
        start: forecastFrom(doc) + 1, confidence: tier }] };
  };
  const KEYS = ["floor", "committed", "headline", "expected", "ceiling"];
  const MOVED = {
    // grant-startup runs with speculative OFF, so its own tier cannot reach any surface — including the
    // ceiling, which is narrowed by the document's toggles exactly as the dashboard narrows it.
    committed:   ["floor", "committed", "headline", "expected", "ceiling"],
    expected:    ["headline", "expected", "ceiling"],
    speculative: [],
  };

  for (const [tier, expected] of Object.entries(MOVED)) {
    it(`${tier} revenue moves: ${expected.join(", ") || "nothing"}`, () => {
      const before = surfaces(base());
      const after = surfaces(withRevenue(tier));
      for (const k of KEYS) {
        const moved = Math.abs(after[k] - before[k]) > 0.01;
        expect(moved, `${tier} · ${k}: ${before[k]} -> ${after[k]}`).toBe(expected.includes(k));
      }
    });
  }

  it("⚠️ AND THE CHAIN STILL HOLDS AFTER EACH ONE", () => {
    // A propagation test that let the ordering break would be checking movement without checking sense.
    for (const tier of ["committed", "expected", "speculative"]) {
      const s = surfaces(withRevenue(tier));
      expect(s.floor, tier).toBeLessThanOrEqual(s.committed + 1e-9);
      expect(s.committed, tier).toBeLessThanOrEqual(s.headline + 1e-9);
      expect(s.headline, tier).toBe(s.expected);
      expect(s.headline, tier).toBeLessThanOrEqual(s.ceiling + 1e-9);
    }
  });
});
