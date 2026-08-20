import { describe, it, expect } from "vitest";
import { PLANS, ADVISOR_PLANS, priceOn, savingLabel } from "../../src/state/plans.js";

describe("⚠️ billing cadence", () => {
  it("EVERY PLAN IS EXACTLY TWO MONTHS FREE", () => {
    // The saving is stated three times per card — the struck price, the annual total and the dollar
    // figure — and **a chip reading "2 months free" beside a plan where it is not true is worse than
    // no chip**, because it is checkable by the person deciding to pay.
    for (const p of [...PLANS, ...ADVISOR_PLANS]) {
      if (!p.monthly) continue;
      expect(p.monthly * 10, p.name).toBeCloseTo(p.price * 12, 0);
    }
  });

  it("generates the chip rather than hard-coding it", () => {
    // So it cannot outlive the prices it describes.
    expect(savingLabel(PLANS)).toBe("2 months free");
    expect(savingLabel(ADVISOR_PLANS)).toBe("2 months free");
  });

  it("⚠️ THE ANNUAL COST IS COMPARABLE ACROSS CADENCES", () => {
    // `billed` is what one charge is; `annual` is what a year costs either way. Conflating them is how
    // a card shows "$99/mo" beside "$1,188" and implies the monthly plan costs that too.
    for (const p of PLANS) {
      const y = priceOn(p, "yearly"), m = priceOn(p, "monthly");
      expect(y.billed).toBe(p.price * 12);
      expect(m.billed).toBe(p.monthly);          // one month
      expect(m.annual).toBe(p.monthly * 12);     // a year of them
      expect(y.saves).toBe(m.annual - y.annual);
    }
  });

  it("defaults to yearly when asked for nothing", () => {
    for (const p of PLANS) expect(priceOn(p).perMonth).toBe(p.price);
  });
});
