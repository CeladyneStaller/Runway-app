import { describe, it, expect } from "vitest";
import { emptyDoc, canaryDoc as demoDoc, migrate, toJSON, fromJSON, SCHEMA_VERSION } from "../../src/state/document";
import { burnStats } from "../../src/engine";
import { seedZero } from "../helpers";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";

describe("the document", () => {
  it("starts empty, not as someone else's demo", () => {
    const d = emptyDoc();
    expect(d.cash).toBe(0);
    expect(d.employees).toHaveLength(0);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
  });
  it("round-trips through JSON unchanged", () => {
    const d = demoDoc();
    expect(fromJSON(toJSON(d))).toEqual(migrate(d));
  });
  it("fills in settings a older document never had", () => {
    const d = migrate({ ...demoDoc(), settings: { fringePct: 0.25 } });
    expect(d.settings.fringePct).toBe(0.25);
    expect(d.settings.toggles.financing).toBe(true);    // defaulted, not lost — and the default is now ON
  });
  it("refuses a document from a future build rather than mangling it", () => {
    expect(() => migrate({ ...emptyDoc(), schemaVersion: 99 })).toThrow(/upgrade the app/i);
  });
  it("the demo document's runway, which is NOT the golden one", () => {
    // ⚠️ THE DEMO NO LONGER MATCHES THE SEED, deliberately. The seed data has no commitments; the demo
    // carries five, one of each flavour, because its job is to demonstrate the product. So the demo's
    // runway is SHORTER than the golden 5.6 and asserting equality would force one of two bad choices:
    // strip the demo of the feature, or raise its cash and make the two documents different companies.
    //
    // The golden canary still guards the SEED, which is what it was for. This asserts the demo's own
    // number, so a change to either is still caught — there are simply two numbers now, not one.
    const d = demoDoc();
    expect(d.cash).toBe(560000);   // same cash as the seed — the divergence is commitments alone
    // The SEED still yields the golden number — that canary is untouched.
    expect(seedZero({ committed: true, expected: true, speculative: false, financing: true }).zero.months)
      .toBeCloseTo(5.6, 1);
    // The DEMO is shorter, because it carries five commitments the seed does not.
    const dz = zeroInfo(buildProjection(buildModelFromDoc(d), d.settings?.toggles || {}), d.startY, d.startM);
    expect(dz.months).toBeCloseTo(3.9, 1);
  });
});

describe("history belongs to the document, not the engine", () => {
  it("an empty model has no measured burn — not the demo's", () => {
    // burnStats used to import the seed's HIST directly. A new user with $100k and nothing else got a
    // $78k/mo baseline and a 1.3-month runway, computed from a company they'd never heard of.
    const b = burnStats(emptyDoc().history, 0, {}, "trailing");
    expect(b.applied).toBe(0);
    expect(b.rows).toHaveLength(0);
  });
  it("the demo carries its own history", () => {
    expect(demoDoc().history.length).toBeGreaterThan(0);
    expect(burnStats(demoDoc().history, 0, {}, "trailing").applied).toBeCloseTo(73333, -2);   // months 4-5 (108k outlier auto-excluded)
  });
  it("the engine never reaches for data it wasn't handed", () => {
    expect(burnStats(undefined, 0, {}, "trailing").applied).toBe(0);
  });
});
