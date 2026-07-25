// MRR reconciliation. Follows the same four rules revenue.js pins for project revenue — past-only,
// total suppression, always on, flag the gap — because two subtly different reconciliation doctrines
// in one app would be worse than either alone. What differs is where the numbers come from and what
// they IMPLY: a grant paying short is one disappointing month, while billing short means the customer
// count is wrong and therefore every forward month is too.
import { describe, it, expect } from "vitest";
import {
  saasBilled, saasVariances, recordedThroughSaas, impliedCustomers, rebaseFromActuals,
  compileSaas, saasSeries, blankSaas,
} from "../../src/engine/saas";
import { buildModelFromDoc } from "../../src/engine/buildmodel";
import { buildProjection, zeroInfo } from "../../src/engine/projection";
import { emptyDoc } from "../../src/state/document";

const mk = (o) => ({ ...blankSaas(), ...o });
const book = () => mk({ startCustomers: 100, arpu: 100, newPerMonth: 10, churnPct: 5 });

describe("scope: past-only", () => {
  it("replaces up to the last recorded month and no further", () => {
    const s = mk({ ...book(), actuals: { 0: 9000, 1: 9500 } });
    expect(recordedThroughSaas(s)).toBe(1);
    const billed = saasBilled(s);
    expect(billed[0]).toMatchObject({ billed: 9000, isActual: true });
    expect(billed[1]).toMatchObject({ billed: 9500, isActual: true });
    expect(billed[2].isActual).toBe(false);
    expect(billed[2].billed).toBeCloseTo(saasSeries(s)[2].mrr, 6);   // model resumes untouched
  });

  it("leaves the forward forecast alone even when the record is far below plan", () => {
    const s = mk({ ...book(), actuals: { 0: 1 } });
    expect(saasBilled(s)[5].billed).toBeCloseTo(saasSeries(s)[5].mrr, 6);
  });

  it("does nothing at all with no records", () => {
    const s = book();
    expect(recordedThroughSaas(s)).toBeNull();
    expect(saasBilled(s).every(p => p.isActual === false)).toBe(true);
    expect(saasVariances(s)).toEqual([]);
  });
});

describe("suppression: total, including a recorded nothing", () => {
  it("a month inside the range with no entry bills zero, not the model's guess", () => {
    // The range is a claim about what happened. A gap inside it is a $0 month, not a missing one.
    const s = mk({ ...book(), actuals: { 2: 12000 } });
    const billed = saasBilled(s);
    expect(billed[0].billed).toBe(0);
    expect(billed[1].billed).toBe(0);
    expect(billed[2].billed).toBe(12000);
  });

  it("and emits no line for it rather than an empty one", () => {
    const s = mk({ ...book(), actuals: { 0: 0, 1: 8000 } });
    const lines = compileSaas(s);
    expect(lines.find(l => l.start === 0)).toBeUndefined();
    expect(lines.find(l => l.start === 1)).toMatchObject({ amount: 8000 });
  });
});

describe("always on, and committed by definition", () => {
  it("recorded months are committed, so no confidence toggle can switch them off", () => {
    const s = mk({ ...book(), confidence: "speculative", actuals: { 0: 9000 } });
    const lines = compileSaas(s);
    expect(lines.find(l => l.start === 0).confidence).toBe("committed");
    expect(lines.find(l => l.start === 3).confidence).toBe("speculative");
  });

  it("a speculative book's recorded past still reaches the runway with speculative off", () => {
    const doc = {
      ...emptyDoc(), cash: 100000,
      lines: [{ id: "c", label: "Burn", cadence: "recurring", kind: "cost", amount: 20000, start: 0, end: null }],
      saas: [mk({ confidence: "speculative", arpu: 500, startCustomers: 100, actuals: { 0: 50000 } })],
    };
    const conservative = { committed: true, expected: true, speculative: false, financing: false };
    const rows = buildProjection(buildModelFromDoc(doc), conservative);
    expect(rows[0].rev).toBeCloseTo(50000, 6);   // it happened; it counts
  });
});

describe("flagging the gap", () => {
  it("reports where record and model disagree, and by how much", () => {
    const s = mk({ ...book(), actuals: { 0: 8000 } });      // model says 100 × 100 = 10,000
    const v = saasVariances(s);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ month: 0, projected: 10000, actual: 8000, delta: -2000 });
    expect(v[0].label).toBe("Subscriptions");
  });

  it("stays quiet when they agree", () => {
    expect(saasVariances(mk({ ...book(), actuals: { 0: 10000 } }))).toEqual([]);
  });
});

describe("what a short month implies, which grants have no analogue for", () => {
  it("backs out the customer count the record implies", () => {
    const s = mk({ ...book(), actuals: { 0: 8000 } });
    expect(impliedCustomers(s)).toMatchObject({ month: 0, implied: 80, modelled: 100 });
  });

  it("uses the price the model assumes for THAT month, not month zero's", () => {
    const s = mk({ startCustomers: 100, arpu: 100, arpuGrowthPct: 10, churnPct: 0, actuals: { 2: 12100 } });
    // arpu at month 2 is 100 × 1.1² = 121, so 12,100 implies 100 customers, not 121.
    expect(impliedCustomers(s).implied).toBeCloseTo(100, 6);
  });

  it("declines to guess when the price is zero", () => {
    expect(impliedCustomers(mk({ arpu: 0, actuals: { 0: 5000 } }))).toBeNull();
  });
});

describe("re-basing, which is deliberately a decision and not a side effect", () => {
  it("restarts the book from what was actually billed", () => {
    const s = mk({ ...book(), actuals: { 2: 8000 } });
    const r = rebaseFromActuals(s);
    expect(r.start).toBe(2);
    expect(r.startCustomers).toBeCloseTo(80, 6);
    expect(saasBilled(r)[0]).toMatchObject({ month: 2, billed: 8000, isActual: true });
  });

  it("carries the assumptions across so only the customer base moves", () => {
    // churn, add growth and price growth all continue on the same curve — newPerMonth and arpu are
    // advanced to their month-`through` values so the forward series is exactly continuous.
    const plan = mk({ startCustomers: 100, arpu: 100, newPerMonth: 10, churnPct: 0,
                      newGrowthPct: 10, arpuGrowthPct: 10 });
    // Record EXACTLY what the model predicted, so re-basing should change nothing forward.
    const onPlan = saasSeries(plan).find(p => p.month === 3).mrr;
    const s = { ...plan, actuals: { 3: onPlan } };
    const r = rebaseFromActuals(s);
    expect(r.arpu).toBeCloseTo(133.1, 6);            // 100 × 1.1³
    expect(r.newPerMonth).toBeCloseTo(13.31, 6);     // 10 × 1.1³
    expect(r.churnPct).toBe(s.churnPct);
    // continuity: month 4 is unchanged, because the record matched the model exactly
    const before = saasSeries(s).find(p => p.month === 4);
    const after = saasSeries(r).find(p => p.month === 4);
    expect(after.mrr).toBeCloseTo(before.mrr, 4);
  });

  it("moves the forward curve when the record did NOT match", () => {
    const s = mk({ startCustomers: 100, arpu: 100, newPerMonth: 0, churnPct: 0, actuals: { 2: 5000 } });
    const before = saasSeries(s).find(p => p.month === 5).mrr;
    const after = saasSeries(rebaseFromActuals(s)).find(p => p.month === 5).mrr;
    expect(before).toBeCloseTo(10000, 6);
    expect(after).toBeCloseTo(5000, 6);
  });

  it("is a no-op without records, rather than throwing", () => {
    const s = book();
    expect(rebaseFromActuals(s)).toEqual(s);
  });
});

describe("it reaches the runway", () => {
  it("a shortfall shortens it", () => {
    const mkDoc = (actuals) => ({
      ...emptyDoc(), cash: 200000,
      lines: [{ id: "c", label: "Burn", cadence: "recurring", kind: "cost", amount: 40000, start: 0, end: null }],
      saas: [mk({ startCustomers: 100, arpu: 200, churnPct: 0, actuals })],
    });
    const onPlan = zeroInfo(buildProjection(buildModelFromDoc(mkDoc({})), mkDoc({}).settings.toggles));
    const short = zeroInfo(buildProjection(buildModelFromDoc(mkDoc({ 0: 5000, 1: 5000 })), mkDoc({}).settings.toggles));
    expect(short.months).toBeLessThan(onPlan.months);
  });
});
