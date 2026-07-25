// Subscription mechanics. The reason this isn't a recurring line with a growth rate is that a
// subscription book converges on a ceiling — adds ÷ churn — and no single growth percentage produces
// that shape. Most of these tests are about the ceiling and the things that break it.
import { describe, it, expect } from "vitest";
import { saasSeries, saasCeiling, compileSaas, saasMRR, blankSaas } from "../../src/engine/saas";
import { HORIZON } from "../../src/engine/time";

const mk = (o) => ({ ...blankSaas(), ...o });

describe("the subscription book", () => {
  it("bills the customers it starts with", () => {
    const s = mk({ startCustomers: 100, arpu: 50 });
    expect(saasSeries(s)[0]).toMatchObject({ month: 0, customers: 100, mrr: 5000 });
  });

  it("adds customers who bill in the month they arrive", () => {
    // Churn is applied BEFORE adds, so a new signup isn't churned before their first renewal.
    const s = mk({ startCustomers: 0, arpu: 100, newPerMonth: 10, churnPct: 10 });
    const series = saasSeries(s);
    expect(series[0].customers).toBe(0);
    expect(series[1].customers).toBe(10);      // not 9
    expect(series[1].mrr).toBe(1000);
  });

  it("loses a share of the base every month", () => {
    const s = mk({ startCustomers: 100, arpu: 10, churnPct: 10, newPerMonth: 0 });
    const series = saasSeries(s);
    expect(series[1].customers).toBeCloseTo(90, 6);
    expect(series[2].customers).toBeCloseTo(81, 6);
  });

  it("grows ARPU independently of the customer count", () => {
    const s = mk({ startCustomers: 100, arpu: 100, arpuGrowthPct: 10, churnPct: 0 });
    const series = saasSeries(s);
    expect(series[1].arpu).toBeCloseTo(110, 6);
    expect(series[1].mrr).toBeCloseTo(11000, 6);
  });

  it("compounds the adds when new business is itself growing", () => {
    const s = mk({ startCustomers: 0, arpu: 1, newPerMonth: 10, newGrowthPct: 100, churnPct: 0 });
    const series = saasSeries(s);
    expect(series[1].customers).toBeCloseTo(20, 6);    // 10 × 2^1
    expect(series[2].customers).toBeCloseTo(60, 6);    // + 10 × 2^2
  });

  it("starts late when it starts late, and bills nothing before that", () => {
    const s = mk({ start: 6, startCustomers: 50, arpu: 20 });
    const series = saasSeries(s);
    expect(series[0].month).toBe(6);
    expect(compileSaas(s).every(l => l.start >= 6)).toBe(true);
  });
});

describe("the ceiling, which is the point", () => {
  it("settles at adds ÷ churn rather than growing forever", () => {
    const s = mk({ startCustomers: 0, arpu: 100, newPerMonth: 20, churnPct: 10 });
    expect(saasCeiling(s)).toMatchObject({ customers: 200, mrr: 20000 });
    // and the series actually approaches it
    const last = saasSeries(s, 240).at(-1);
    expect(last.customers).toBeCloseTo(200, 3);
  });

  it("approaches from above when you start over the ceiling", () => {
    const s = mk({ startCustomers: 500, arpu: 10, newPerMonth: 20, churnPct: 10 });
    const series = saasSeries(s, 240);
    expect(series[1].customers).toBeLessThan(500);
    expect(series.at(-1).customers).toBeCloseTo(200, 3);
  });

  it("has no ceiling without churn — that's unbounded growth, not a number", () => {
    expect(saasCeiling(mk({ newPerMonth: 10, churnPct: 0 }))).toBeNull();
  });

  it("has no ceiling without adds either — that's decay", () => {
    expect(saasCeiling(mk({ newPerMonth: 0, churnPct: 5 }))).toBeNull();
  });

  it("survives 100% churn without dividing by anything silly", () => {
    const s = mk({ startCustomers: 100, arpu: 10, newPerMonth: 5, churnPct: 100 });
    const series = saasSeries(s);
    expect(series[1].customers).toBe(5);     // everyone left, the month's adds remain
    expect(Number.isFinite(series[1].mrr)) .toBe(true);
  });
});

describe("expanding into line items", () => {
  it("emits ordinary one-time revenue lines the projection already understands", () => {
    const lines = compileSaas(mk({ startCustomers: 10, arpu: 100 }));
    expect(lines).toHaveLength(HORIZON + 1);
    expect(lines[0]).toMatchObject({ kind: "revenue", cadence: "onetime", confidence: "expected" });
    // No new cadence — that's what keeps scenarios, bands, SF-424A and revenue actuals working.
    expect(lines.every(l => l.cadence === "onetime")).toBe(true);
  });

  it("skips months that bill nothing rather than emitting empty lines", () => {
    expect(compileSaas(mk({ startCustomers: 0, arpu: 100, newPerMonth: 0 }))).toHaveLength(0);
  });

  it("respects the confidence tier it was given", () => {
    expect(compileSaas(mk({ startCustomers: 1, arpu: 1, confidence: "speculative" }))[0].confidence)
      .toBe("speculative");
  });

  it("drops out entirely when excluded", () => {
    expect(compileSaas(mk({ startCustomers: 10, arpu: 100, include: false }))).toHaveLength(0);
  });

  it("treats blank and junk fields as zero, never NaN", () => {
    // A NaN reaching a line amount poisons every balance after it and the chart stops drawing.
    const s = mk({ startCustomers: "", arpu: "abc", newPerMonth: null, churnPct: undefined });
    expect(saasSeries(s).every(p => Number.isFinite(p.mrr))).toBe(true);
    expect(compileSaas(s)).toHaveLength(0);
  });

  it("reports current MRR for the summary row", () => {
    expect(saasMRR(mk({ startCustomers: 40, arpu: 25 }))).toBe(1000);
    expect(saasMRR(mk({ start: 4, startCustomers: 40, arpu: 25 }))).toBe(1000);
  });
});
