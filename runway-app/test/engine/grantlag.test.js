import { describe, it, expect } from "vitest";
import { computeGrant } from "../../src/engine/grant.js";
import { buildProjection } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { nMon, periodEnd } from "../../src/engine/time.js";

/** ⚠️ THE REIMBURSEMENT LAG, WHICH IS WHY THIS PRODUCT EXISTS — AND HAD NO TEST.
 *
 *  A grant-funded organisation spends before it is paid. Standard runway tools divide cash by burn and
 *  miss the hole entirely. Nothing in this suite exercised that: no fixture produced a reimbursement
 *  line at all, so the lag arithmetic was untested end to end.
 *
 *  ⚠️ TWO FLAGS GATE EVERYTHING, AND EVERY SHIPPED FIXTURE FAILS BOTH.
 *    `categories: null`     -> `computeGrant` reads `C = {}`, every category sums to 0, NO LINES AT ALL.
 *    `assumeFunded: true`   -> the revenue branch is `else if (!g.assumeFunded)`, so NO REVENUE LINES;
 *                              only the cost-share portion is treated as cash out.
 *  Both are legitimate states. Together they are why the grant-startup archetype compiles zero
 *  grant-derived lines — see the sibling guard in this file's part two.
 *
 *  ⚠️ AND `byPeriod` IS KEYED BY PERIOD INDEX, NOT BY MONTH. `{ byPeriod: { 0: 600000 } }` is the whole
 *  budget for period ZERO, not $600k in month zero. Reading it as a month is the mistake that produced
 *  an empty fixture on the first attempt at this file.
 *
 *  The fixture below is the smallest grant that actually moves cash: one 6-month period, a $600,000
 *  budget, no cost share, no allocated labour. `cashOut / nMon` is $100,000 a month for months 0-5, and
 *  `periodEnd(p) + lag` places the reimbursement. Every figure is an integer.
 */

const T = { committed: true, expected: true, speculative: false, financing: false };

const grant = (over = {}) => ({
  assumeFunded: false,
  reimburseTiming: "arrears",
  reimburseLagMonths: 2,
  costSharePct: 0,
  costShareType: "cash",
  periods: [{ id: "p1", start: 0, end: 5 }],
  categories: { other: [{ byPeriod: { 0: 600000 } }] },
  ...over,
});

const docWith = (g, cash = 300000) => ({
  startY: 2026, startM: 0, cash,
  lines: [], employees: [], pos: [], rounds: [], saas: [], history: [],
  cashActuals: {}, commitments: [], milestones: [],
  settings: { toggles: T, anchorActuals: false },
  projects: [{ id: "g1", name: "Grant", type: "grant", include: true, stage: "awarded", grant: g }],
});

const series = (g, n = 10, cash = 300000) =>
  buildProjection(buildModelFromDoc(docWith(g, cash)), T).slice(0, n).map(r => Math.round(r.start));

describe("the grant fixture compiles to two lines and nothing else", () => {
  it("spend is the budget divided by the period, reimbursement is the period end plus the lag", () => {
    const g = grant();
    const { lines, per } = computeGrant(g, undefined, "awarded");
    expect(nMon(g.periods[0])).toBe(6);
    expect(periodEnd(g.periods[0])).toBe(5);
    expect(per[0].total).toBe(600000);
    expect(per[0].federal).toBe(600000);   // no cost share, so all of it is reimbursable
    expect(per[0].allocated).toBe(0);      // no employee-linked labour, no non-incremental indirect

    const cost = lines.find(l => l.kind === "cost");
    expect(cost).toMatchObject({ cadence: "recurring", amount: 100000, start: 0, end: 5 });

    const rev = lines.find(l => l.kind === "revenue");
    expect(rev).toMatchObject({ cadence: "onetime", amount: 600000, start: 7 });  // periodEnd 5 + lag 2
    expect(lines).toHaveLength(2);
  });

  it("⚠️ THE COST LINE CARRIES NO TIER AND THE REVENUE LINE DOES", () => {
    // `push` sets `confidence` only for revenue. Spend on an awarded grant is owed whether or not the
    // agency pays on time — gating it behind a tier would let switching a toggle erase an obligation.
    const { lines } = computeGrant(grant(), undefined, "awarded");
    expect(lines.find(l => l.kind === "cost").confidence).toBeUndefined();
    expect(lines.find(l => l.kind === "revenue").confidence).toBe("committed");
  });

  it("the stage sets the tier, not `assumeFunded`", () => {
    // A grant still in committee must not count like a signed award — that was a real defect, and it
    // collapsed the confidence band to no width for exactly this product's customers.
    expect(computeGrant(grant(), undefined, "prospective").lines
      .find(l => l.kind === "revenue").confidence).toBe("expected");
    expect(computeGrant(grant(), undefined, "awarded").lines
      .find(l => l.kind === "revenue").confidence).toBe("committed");
  });
});

describe("⚠️ the lag is the hole", () => {
  it("places the money at periodEnd + lag, exactly", () => {
    for (const lag of [0, 1, 2, 3]) {
      const rev = computeGrant(grant({ reimburseLagMonths: lag }), undefined, "awarded").lines
        .find(l => l.kind === "revenue");
      expect(rev.start, `lag ${lag}`).toBe(5 + lag);
    }
  });

  it("digs a trough a cash-over-burn calculation cannot see", () => {
    // $300k of cash against a $600k budget spent over six months, reimbursed two months after the
    // period ends. Burn-rate arithmetic says three months of runway and never recovers; the truth is a
    // trough that bottoms at −$300,000 and closes when the money lands.
    expect(series(grant({ reimburseLagMonths: 2 })))
      .toEqual([300000, 200000, 100000, 0, -100000, -200000, -300000, -300000, 300000, 300000]);
  });

  it("⚠️ EXTENDS THE TIME UNDERWATER, AND ONLY DEEPENS THE HOLE WHILE SPENDING CONTINUES", () => {
    // The distinction that matters when someone asks "how much worse is net-90 than net-30".
    //
    // Spending stops at month 5, so depth is fixed at cumulative spend minus cash — $600k − $300k —
    // and every extra month of lag holds you at the bottom for longer rather than digging deeper.
    const depth = (lag) => Math.min(...series(grant({ reimburseLagMonths: lag }), 12));
    const closes = (lag) => series(grant({ reimburseLagMonths: lag }), 12).findIndex((v, i) => i > 5 && v >= 0);
    expect([0, 1, 2, 3].map(depth)).toEqual([-200000, -300000, -300000, -300000]);
    expect([0, 1, 2, 3].map(closes)).toEqual([6, 7, 8, 9]);
  });

  it("and DOES deepen it when a second period keeps spending through the gap", () => {
    // Two 6-month periods, $600k each, spend running months 0-11. Now the lag overlaps live spending,
    // so each extra month of it costs another month of burn at the bottom: $100,000 a step, exactly.
    const twoPeriod = (lag) => grant({
      reimburseLagMonths: lag,
      periods: [{ id: "a", start: 0, end: 5 }, { id: "b", start: 6, end: 11 }],
      categories: { other: [{ byPeriod: { 0: 600000, 1: 600000 } }] },
    });
    const depth = (lag) => Math.min(...series(twoPeriod(lag), 16));
    expect([0, 1, 2, 3].map(depth)).toEqual([-200000, -300000, -400000, -500000]);
  });
});

describe("how it is billed changes when the money arrives, not how much", () => {
  it("arrears pays once at the period end, advance pays once at the start, monthly pays as incurred", () => {
    const revOf = (timing) => computeGrant(grant({ reimburseTiming: timing }), undefined, "awarded")
      .lines.filter(l => l.kind === "revenue");

    const arrears = revOf("arrears");
    expect(arrears).toHaveLength(1);
    expect(arrears[0]).toMatchObject({ amount: 600000, start: 7 });        // periodEnd 5 + lag 2

    const advance = revOf("advance");
    expect(advance).toHaveLength(1);
    expect(advance[0]).toMatchObject({ amount: 600000, start: 2 });        // p.start 0 + lag 2

    const monthly = revOf("monthly");
    expect(monthly).toHaveLength(6);                                       // one per month of the period
    expect(monthly.map(l => l.start)).toEqual([2, 3, 4, 5, 6, 7]);         // each month + lag
    expect(monthly.every(l => l.amount === 100000)).toBe(true);
    expect(monthly.reduce((a, l) => a + l.amount, 0)).toBe(600000);        // same total, spread
  });

  it("⚠️ AND ADVANCE BILLING REMOVES THE HOLE ENTIRELY", () => {
    // Same budget, same lag, same spend — the balance never goes negative, because the money arrives
    // before the work is done. This is the comparison a grant officer is actually making.
    expect(Math.min(...series(grant({ reimburseTiming: "advance" }), 12))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...series(grant({ reimburseTiming: "arrears" }), 12))).toBe(-300000);
  });
});

describe("cost share is money you spend and are not reimbursed for", () => {
  it("leaves the spend alone and cuts the reimbursement", () => {
    // ⚠️ THE SPEND DOES NOT MOVE. A 20% match does not mean you spend 20% more — it means 20% of the
    // same budget comes out of your own pocket. Asserting both halves is what makes that unambiguous.
    const at = (pct) => {
      const { lines } = computeGrant(grant({ costSharePct: pct }), undefined, "awarded");
      return { cost: lines.find(l => l.kind === "cost").amount,
               rev: lines.find(l => l.kind === "revenue").amount };
    };
    expect(at(0)).toEqual({ cost: 100000, rev: 600000 });
    expect(at(0.2)).toEqual({ cost: 100000, rev: 480000 });
  });
});

describe("⚠️ the two flags that silently produce nothing", () => {
  it("`categories: null` compiles no lines at all", () => {
    // Not an error, not a warning — an empty array. Every shipped archetype grant is in this state.
    expect(computeGrant(grant({ categories: null }), undefined, "awarded").lines).toEqual([]);
  });

  it("`assumeFunded: true` compiles no revenue, whatever the timing says", () => {
    // The award is assumed to cover itself, so only cost share is cash out. With `costSharePct: 0`
    // that is nothing either — the grant becomes entirely invisible to the projection.
    const { lines } = computeGrant(grant({ assumeFunded: true }), undefined, "awarded");
    expect(lines.filter(l => l.kind === "revenue")).toEqual([]);
    expect(series(grant({ assumeFunded: true }))).toEqual(Array(10).fill(300000));
  });
});

describe("⚠️ a shipped demo must actually demonstrate reimbursement", () => {
  it("at least one archetype compiles a real grant line set", async () => {
    // ⚠️ THIS PASSES, ON EXACTLY ONE GRANT, AND THAT IS THE WHOLE STORY.
    //
    // `nonprofit` · "Coastal restoration — federal" is milestone-billed, and the milestone branch of
    // `computeGrant` reads `g.milestones` rather than `g.categories` — so it compiles four reimbursement
    // lines despite `categories: null`, tiered by milestone status (accepted -> committed, planned ->
    // expected). One working demonstration of the reimbursement lag exists in the whole fixture set.
    //
    // ⚠️ ALL THREE GRANTS IN `grant-startup` COMPILE NOTHING. `categories: null` plus, on two of them,
    // `assumeFunded: true`. That archetype's model is nine cost lines and one instrument revenue line,
    // and NOT ONE comes from a grant — so the flagship fixture for reimbursement-financed organisations
    // demonstrates no reimbursement, and its runway is ordinary burn against ordinary cost lines.
    //
    // This guard is deliberately the WEAK form the brief asked for: at least one archetype, somewhere,
    // produces a reimbursement. The strong form — every archetype that HAS grant projects has at least
    // one that compiles — fails on `grant-startup` today. Writing it here would land a red suite for a
    // demo-data problem, and fixing that data changes the archetype's published runway, which is a
    // product decision rather than an engine one. The failure list is in the message below so the
    // strong form is one line away when that decision is made.

    const { ARCHETYPES } = await import("../../src/state/archetypes.js");
    const { demoDoc } = await import("../../src/state/document.js");
    const { computeGrant } = await import("../../src/engine/grant.js");

    const counts = ARCHETYPES.flatMap(a => {
      const doc = demoDoc(a.id);
      return (doc.projects || []).filter(p => p.type === "grant").map(p => ({
        archetype: a.id,
        name: p.name,
        lines: computeGrant(p.grant, undefined, p.stage).lines.length,
        reimbursements: computeGrant(p.grant, undefined, p.stage).lines
          .filter(l => l.kind === "revenue").length,
      }));
    });

    // A grant that compiles nothing is a grant nobody can see the point of.
    const inert = counts.filter(c => c.lines === 0).map(c => `${c.archetype} · ${c.name}`);
    expect(counts.some(c => c.reimbursements > 0),
      `no archetype grant produces a reimbursement line:\n${JSON.stringify(counts, null, 2)}`).toBe(true);

    // Recorded, not asserted. If this list ever shrinks to empty the strong form becomes free; if it
    // grows, someone has added another grant nobody can see.
    expect(inert.length, `inert grants (compile no lines): ${inert.join(", ")}`).toBeLessThanOrEqual(5);
  });
});
