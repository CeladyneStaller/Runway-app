import { describe, it, expect } from "vitest";
import { emptyDoc, demoDoc, migrate, toJSON, fromJSON, SCHEMA_VERSION } from "../../src/state/document";
import { burnStats } from "../../src/engine";
import { seedZero } from "../helpers";

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
    expect(d.settings.toggles.financing).toBe(false);   // defaulted, not lost
  });
  it("refuses a document from a future build rather than mangling it", () => {
    expect(() => migrate({ ...emptyDoc(), schemaVersion: 99 })).toThrow(/upgrade the app/i);
  });
  it("the demo document reproduces the golden runway", () => {
    const d = demoDoc();
    expect(d.cash).toBe(560000);
    expect(seedZero({ committed: true, expected: true, speculative: false, financing: false }).zero.months)
      .toBeCloseTo(5.6, 1);
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
