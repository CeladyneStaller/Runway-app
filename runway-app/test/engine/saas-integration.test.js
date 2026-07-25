// SaaS revenue reaching the runway. The engine tests cover the mechanics; these cover the wiring —
// that expanding into ordinary line items really does mean everything downstream keeps working.
import { describe, it, expect } from "vitest";
import { buildModelFromDoc, buildModelParts } from "../../src/engine/buildmodel";
import { buildProjection, zeroInfo } from "../../src/engine/projection";
import { emptyDoc, demoDoc } from "../../src/state/document";
import { blankSaas } from "../../src/engine/saas";

const base = (over = {}) => ({
  ...emptyDoc(), cash: 300000,
  lines: [{ id: "c1", label: "Burn", cadence: "recurring", kind: "cost", amount: 50000, start: 0, end: null }],
  ...over,
});
const months = (doc, toggles) => {
  const z = zeroInfo(buildProjection(buildModelFromDoc(doc), toggles || doc.settings.toggles));
  return z ? z.months : null;
};

describe("subscriptions reach the runway", () => {
  it("a book of customers lengthens it", () => {
    const without = months(base());
    const withSaas = months(base({ saas: [{ ...blankSaas(), startCustomers: 100, arpu: 200 }] }));
    expect(without).toBeCloseTo(6, 1);          // 300k / 50k
    expect(withSaas).toBeGreaterThan(without);
  });

  it("and churn decides whether the business escapes at all", () => {
    // THE CEILING, made concrete. Same adds, same price, same burn — the ONLY difference is whether
    // customers leave. At 20%/mo churn the book tops out at 10/0.2 = 50 customers = $25k/mo, which
    // never covers $50k of burn, so the company still dies. At 0% churn it grows past burn and
    // survives. No single growth percentage on a recurring line can express that difference, which is
    // the entire reason subscriptions are modelled as a population instead.
    const capped = base({ saas: [{ ...blankSaas(), arpu: 500, newPerMonth: 10, churnPct: 20 }] });
    const uncapped = base({ saas: [{ ...blankSaas(), arpu: 500, newPerMonth: 10, churnPct: 0 }] });
    expect(months(capped)).not.toBeNull();
    expect(months(capped)).toBeGreaterThan(6);      // churn still buys time...
    expect(months(uncapped)).toBeNull();            // ...but only the uncapped book escapes
  });

  it("an excluded book contributes nothing", () => {
    const off = base({ saas: [{ ...blankSaas(), startCustomers: 100, arpu: 200, include: false }] });
    expect(months(off)).toBeCloseTo(months(base()), 6);
  });
});

describe("it obeys the same rules as every other revenue line", () => {
  it("a speculative book is off unless speculative is on", () => {
    const doc = base({ saas: [{ ...blankSaas(), startCustomers: 100, arpu: 400, confidence: "speculative" }] });
    const off = months(doc, { committed: true, expected: true, speculative: false, financing: false });
    const on = months(doc, { committed: true, expected: true, speculative: true, financing: false });
    expect(off).toBeCloseTo(6, 1);
    expect(on).toBeGreaterThan(off);
  });

  it("defaults to expected, like any untagged revenue", () => {
    const doc = base({ saas: [{ ...blankSaas(), startCustomers: 10, arpu: 100 }] });
    const lines = buildModelFromDoc(doc).lineItems.filter(l => l.saasId);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(l => l.confidence === "expected")).toBe(true);
  });

  it("introduces no new cadence — that's what keeps everything downstream working", () => {
    const doc = base({ saas: [{ ...blankSaas(), startCustomers: 10, arpu: 100 }] });
    const cadences = new Set(buildModelFromDoc(doc).lineItems.map(l => l.cadence));
    expect([...cadences].every(c => c === "recurring" || c === "onetime")).toBe(true);
  });

  it("is exposed as an intermediate, like every other compiled source", () => {
    const parts = buildModelParts(base({ saas: [{ ...blankSaas(), startCustomers: 10, arpu: 100 }] }));
    expect(parts.saasLines.length).toBeGreaterThan(0);
  });
});

describe("nothing moved for documents without subscriptions", () => {
  it("the demo's runway is untouched", () => {
    // The golden number lives in golden.test.js; this pins that an empty `saas` is genuinely inert.
    const d = demoDoc();
    expect(d.saas).toEqual([]);
    const withField = months(d);
    const withoutField = months({ ...d, saas: undefined });
    expect(withField).toBeCloseTo(withoutField, 10);
  });

  it("an old document with no saas key at all still builds", () => {
    const doc = base();
    delete doc.saas;
    expect(() => buildModelFromDoc(doc)).not.toThrow();
    expect(months(doc)).toBeCloseTo(6, 1);
  });
});
