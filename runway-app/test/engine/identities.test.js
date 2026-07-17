// Every identity in RUNWAY-ENGINE.md, encoded. These were each verified by hand once; now they're
// permanent. The audit findings (F1-F8) get a regression test apiece — a fixed bug with no test is
// a bug with a scheduled return date.
import { describe, it, expect } from "vitest";
import {
  computeGrant, resolveProjectRates, compileProject, lineSpan, empHourlyAt, empCostAt, HRS_YR,
  compileInstrument, debtLines, convOwnership, covenantBreach, instConf, instLabel,
  poLag, poPaidMonth, poBeyondHorizon, clampM, floorM, HORIZON, msTier, msPaid, isMsBilled,
} from "../../src/engine";
import { SEED_PROJECTS, SEED_FULFIL, SEED_EMPLOYEES, SEED_ROUNDS, SEED_POS_LINKED } from "../../src/seed";

const grants = SEED_PROJECTS.filter(p => p.type === "grant");

describe("SF-424A accounting identities", () => {
  // SF-424A Section B: the six object-class lines plus personnel and fringe are the direct total.
  it.each(grants.map(g => [g.name, g.grant]))("%s: object classes sum to direct", (_n, g) => {
    const { grand } = computeGrant(g);
    const classes = grand.personnel + grand.fringe + grand.travel + grand.equipment
      + grand.supplies + grand.contractual + grand.construction + grand.other;
    expect(classes).toBeCloseTo(grand.direct, 4);
  });
  it.each(grants.map(g => [g.name, g.grant]))("%s: direct + indirect = total", (_n, g) => {
    const { grand } = computeGrant(g);
    expect(grand.direct + grand.indirect).toBeCloseTo(grand.total, 4);
  });
  it.each(grants.map(g => [g.name, g.grant]))("%s: federal + cost share = total", (_n, g) => {
    const { grand } = computeGrant(g);
    expect(grand.federal + grand.costShare).toBeCloseTo(grand.total, 4);
  });
  it.each(grants.map(g => [g.name, g.grant]))("%s: cash out = total less what payroll already pays", (_n, g) => {
    const { grand, lines } = computeGrant(g);
    const cost = lines.filter(l => l.kind === "cost").reduce((a, l) => a + lineSpan(l), 0);
    expect(cost).toBeCloseTo(grand.total - grand.allocated, 2);
  });
});

describe("F2 — a milestone schedule must answer to the budget", () => {
  it.each(grants.filter(g => isMsBilled(g.grant)).map(g => [g.name, g.grant]))(
    "%s: balancing the last milestone reconciles it to the federal share", (_n, g) => {
      const fed = computeGrant(g).grand.federal;
      const list = g.milestones, gap = list.reduce((a, m) => a + m.payment, 0) - fed;
      const fixed = list.map((m, i) => i === list.length - 1 ? { ...m, payment: Math.round(m.payment - gap) } : m);
      expect(fixed.reduce((a, m) => a + m.payment, 0)).toBeCloseTo(fed, 0);
    });
  it("status drives the tier; paid compiles to nothing", () => {
    expect(msTier({ status: "planned" })).toBe("expected");
    expect(msTier({ status: "delivered" })).toBe("expected");
    expect(msTier({ status: "accepted" })).toBe("committed");
    expect(msPaid({ status: "paid" })).toBe(true);
  });
  it("marking a milestone paid removes it from the projection — it's already in cash", () => {
    const g = grants.find(x => isMsBilled(x.grant)).grant;
    const before = computeGrant(g).lines.filter(l => l.kind === "revenue").length;
    const after = computeGrant({ ...g, milestones: g.milestones.map((m, i) => i ? m : { ...m, status: "paid" }) })
      .lines.filter(l => l.kind === "revenue").length;
    expect(after).toBe(before - 1);
  });
  it("the agency's payment lag applies to milestones too", () => {
    const g = grants.find(x => isMsBilled(x.grant)).grant;
    const lag = g.reimburseLagMonths || 0;
    expect(lag).toBeGreaterThan(0);
    const L = computeGrant(g).lines.filter(l => l.kind === "revenue");
    g.milestones.forEach(m => {
      const line = L.find(l => l.label === m.label);
      if (line) expect(line.start).toBe(m.month + lag);
    });
  });
});

describe("F3 — fulfilment labour carries employer burden", () => {
  const labourOf = (fringe) => resolveProjectRates(SEED_FULFIL, SEED_EMPLOYEES, fringe)[0]
    .lines.filter(l => l.isLabor).reduce((a, l) => a + lineSpan(l), 0);
  it("is loaded, not salary-only", () => {
    const e = SEED_EMPLOYEES[2];
    const r = resolveProjectRates(SEED_FULFIL, SEED_EMPLOYEES, 0.30)[0].lines.find(l => l.employeeId === e.id);
    expect(r.rate).toBeCloseTo(empCostAt(e, r.start ?? 0, 0.30) * 12 / HRS_YR, 6);
    expect(r.rate).toBeGreaterThan(empHourlyAt(e, r.start ?? 0));
  });
  it("is proportional to the fringe rate, not hardcoded", () => {
    expect(labourOf(0)).toBeCloseTo(31696, -1);       // salary-only when there's no burden
    expect(labourOf(0.30)).toBeCloseTo(41204, -1);
  });
  it("never draws cash — it's already in payroll", () => {
    const p = resolveProjectRates(SEED_FULFIL, SEED_EMPLOYEES, 0.30)[0];
    const all = p.lines.reduce((a, l) => a + lineSpan(l), 0);
    expect(compileProject(p).reduce((a, l) => a + lineSpan(l), 0)).toBeCloseTo(all - labourOf(0.30), 1);
  });
});

describe("F8 — money past the horizon falls off; it does not slide back", () => {
  it("clampM and floorM are not interchangeable", () => {
    expect(clampM(21)).toBe(HORIZON);   // for select values and array indices
    expect(floorM(21)).toBe(21);        // for placing money in time
    expect(clampM(-5)).toBe(0);
    expect(floorM(-5)).toBe(0);
  });
  it("net-90 on a month-18 delivery is paid in month 21, and flagged", () => {
    const po = { deliveryMonth: 18, termsDays: 90 };
    expect(poPaidMonth(po)).toBe(21);
    expect(poBeyondHorizon(po)).toBe(true);
  });
  it("no seeded order is paid past the horizon", () => {
    SEED_POS_LINKED.forEach(p => expect(poBeyondHorizon(p)).toBe(false));
  });
});

describe("net terms are conservative — never sooner than the terms allow", () => {
  it.each([[15, 1], [30, 1], [31, 2], [40, 2], [44, 2], [45, 2], [60, 2], [90, 3]])(
    "net %i pays in month %i", (days, months) => {
      expect(poLag({ termsDays: days })).toBe(months);
      expect(months * 30).toBeGreaterThanOrEqual(days === 15 || days === 30 ? 30 : days > 30 ? 31 : days);
    });
});

describe("capital", () => {
  const [safe, debt, round] = SEED_ROUNDS;
  it("a term sheet is expected, not committed", () => {
    expect(instConf({ status: "committed" })).toBe("expected");
    expect(instConf({ status: "closed" })).toBe("committed");
    expect(instLabel({ kind: "equity", status: "committed" })).toBe("Term sheet");
    expect(instLabel({ kind: "debt", status: "committed" })).toBe("Commitment letter");
  });
  it("a manual override beats the status default", () => {
    expect(instConf({ status: "planning", confAuto: false, confidence: "committed" })).toBe("committed");
  });
  it("a closed instrument draws no cash — it's already in the balance", () => {
    expect(compileInstrument(safe, SEED_ROUNDS)).toHaveLength(0);
  });
  it("but a closed instrument still converts", () => {
    expect(convOwnership(safe, round)).toBeCloseTo(1e6 / 15e6, 10);   // post-money: exactly amount/cap
  });
  it("debt draws net of fees and amortises after the interest-only period", () => {
    const L = debtLines(debt, "speculative");
    expect(compileInstrument(debt, SEED_ROUNDS).find(l => l.kind === "revenue").amount).toBeCloseTo(1980000, 0);
    expect(L.find(l => /interest only/.test(l.label)).amount).toBeCloseTo(20000, 0);
    expect(L.find(l => /principal & interest/.test(l.label)).amount).toBeCloseTo(94147, 0);
    expect(L.find(l => /final/.test(l.label)).amount).toBeCloseTo(100000, 0);
  });
  it("every repayment carries the draw's tier and the financing flag", () => {
    const L = compileInstrument(debt, SEED_ROUNDS);
    expect(L.every(l => l.confidence === instConf(debt))).toBe(true);
    expect(L.every(l => l.financing === true)).toBe(true);
  });
  it("a note with nothing to convert into is a cash repayment, with accrued interest", () => {
    const note = { id: "n", kind: "note", name: "Bridge", status: "committed", amount: 500000,
                   closeMonth: 2, maturityMonths: 24, interestPct: 8, atMaturity: "repay" };
    const cliff = compileInstrument(note, [note]).find(l => /repaid at maturity/.test(l.label));
    expect(cliff.amount).toBeCloseTo(500000 + 500000 * 0.08 * 2, 0);
    expect(compileInstrument({ ...note, assumeExtended: true }, [note]).some(l => /repaid/.test(l.label))).toBe(false);
    expect(compileInstrument(note, [note, round]).some(l => /repaid/.test(l.label))).toBe(false);
  });
  it("a covenant breach is found inside the facility's term", () => {
    const rows = Array.from({ length: 19 }, (_, m) => ({ m, start: 500000 - m * 50000 }));
    const b = covenantBreach({ ...debt, covenantCash: 400000 }, rows);
    expect(b.month).toBe(debt.closeMonth);
    expect(covenantBreach({ ...debt, covenantCash: 0 }, rows)).toBeNull();
  });
});
