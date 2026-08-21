// ── Four demo companies, one per shape of business ───────────────────────────────────────────────
//
// ⚠️ ONE DEMO CANNOT SHOW WHAT THIS PRODUCT IS FOR. A grant-funded institute and a SaaS founder share
// almost no tabs, so a single sample either teaches half of them the wrong thing or shows everybody a
// business nobody runs.
//
// **The test for each is not "is this realistic" but "does this show a mechanic no other sample
// shows".** Four covers the mechanics; a fifth would need a new reason.
//
// ⚠️ THE ORIGINAL `Demo Company` IS KEPT AND NOT LISTED HERE. It is the golden canary — a known runway
// figure at known toggle settings, used as a regression check through every change. **Putting it in
// this list would let somebody edit it into a different sanity check**, which is the one thing it
// cannot survive.

import { uid } from "../engine/time";

const emp = (name, title, amount, start = 0, end = null) =>
  ({ id: uid(), name, title, basis: "annual", amount, start, end, raises: [] });

const line = (label, amount, kind, cadence, start, end, extra = {}) =>
  ({ id: uid(), label, amount, kind, cadence, start, end, ...extra });

// ── 1 · Grant-funded startup, eyeing a raise ─────────────────────────────────────────────────────
//
// Shows: the reimbursement gap with a real lag, cash cost share, and a proposal sitting in the model
// without inflating it.
//
// ⚠️ THE HEADLINE DEMONSTRATION, WITH THE NUMBERS IT ACTUALLY PRODUCES. This comment used to claim
// "toggling speculative off drops the runway from ~8 months to ~5", and that was FALSE — the toggle
// moved it by 0.00 months, because the Seed SAFE closed in month 9 while the company crossed zero
// around month 8. A raise arriving after you are out cannot change when you get there, and nothing
// tested the claim.
//
// What it does now, from a four-month recorded ledger and a working SBIR award:
//   speculative OFF  runway 4.7 months, band 4.4 - 5.1, `wide` false
//   speculative ON   runway 24.6 months, band 4.4 - 26.4, `wide` TRUE
// One toggle, a 20-month swing, and the band flags that the swing rests on money that may not arrive.
//
// And the shape underneath it: cash goes UNDER in Feb 27 and comes back in May 27 when the award's
// first drawdown lands, two months after the budget period ends. That dip-and-recover IS the
// reimbursement gap, and no demo showed it before — all three grants here compiled zero lines.
const RIDGELINE = () => {
  // ⚠️ STAFF BOUND FIRST, so the SBIR budget can reference the people it pays for. `computeGrant` treats
  // personnel carrying an `employeeId` as ALLOCATED — salary already leaving as payroll — and subtracts
  // it from the grant's cash out. Without the link the same wages are charged twice: once by
  // `compileEmployee` and again by the grant, and the demo burns money nobody spends.
  const staff = [
    emp("Priya Raman", "CEO", 155000),
    emp("Tom Okonkwo", "Principal Investigator", 148000),
    emp("Sofia Lindqvist", "Senior Chemist", 126000),
    emp("Wes Adeyemi", "Process Engineer", 118000),
    emp("Hana Ito", "Lab Technician", 78000),
    emp("Ben Carter", "Operations", 92000, 3),
  ];
  // ⚠️ `byPeriod` IS AN ARRAY INDEXED BY PERIOD, and `hrs` is TOTAL HOURS FOR THAT PERIOD, not monthly.
  // `resolveProjectRates` fills `rate` from the employee's own salary, so only the hours are authored —
  // a `rate` here would be overwritten anyway. A first draft keyed `byPeriod` as an object and read the
  // hours as monthly, which compiled a $66,268 award instead of a $398,343 one.
  const onGrant = (e, hrs) => ({ id: uid(), name: e.name, employeeId: e.id, byPeriod: [{ hrs }] });

  return {
  name: "Ridgeline Catalysis",
  cash: 487000,
  // Four recorded months, Apr-Jul. Burn runs ~$85k; the May and July figures carry a conference and a
  // catalyst reorder. No single month is extreme — with four points `burnVariance` trims nothing, so an
  // outlier would dominate the spread rather than reading as the one-off it is.
  //
  // ⚠️ AND THE LAST THREE MONTHS MUST AVERAGE AT OR BELOW `itemizedOpex`. `derivedBurn` is the TRAILING
  // THREE-MONTH mean, and `baselineOpex = max(0, derivedBurn - itemizedOpex)` back-fills any excess as
  // an extra recurring cost for the whole horizon — spend the ledger shows that nobody itemised. A
  // ledger sitting above the itemised total therefore makes the demo silently more expensive: on
  // hardware-vc a first draft added $61,175 a month and cut its runway from 19.97 to 15.30 months.
  ledger: [76000, 90000, 79000, 86000],
  ledgerMix: [0.63, 0.24],
  employees: staff,
  lines: [
    line("Rent and utilities", 9200, "cost", "recurring", 0, 35),
    line("Lab consumables", 6400, "cost", "recurring", 0, 35),
    line("Insurance and compliance", 2100, "cost", "recurring", 0, 35),
  ],
  projects: [
    {
      id: uid(), type: "grant", name: "SBIR Phase II — catalyst durability",
      budget: 1150000, start: 0, end: 23, lines: [],
      grant: {
        funder: "Department of Energy",
        // ⚠️ `assumeFunded: false` AND REAL `categories`, WHICH IS WHAT MAKES THIS GRANT EXIST AT ALL.
        // With `assumeFunded: true` the revenue branch is skipped entirely and only cost share is cash
        // out; with `categories: null` every category sums to zero and NOTHING compiles. This grant
        // carried both and produced no lines whatsoever — the flagship demo for reimbursement-financed
        // organisations was demonstrating no reimbursement.
        assumeFunded: false,
        // ⚠️ ARREARS WITH A TWO-MONTH LAG. The default and the most common — and the field that creates
        // the gap this whole product exists to model.
        reimburseTiming: "arrears", reimburseLagMonths: 2,
        costShareType: "cash", costSharePct: 0,
        // One period, starting next month, so the recorded months stay clean.
        periods: [{ id: uid(), start: 1, end: 6 }],
        milestones: [],
        // ⚠️ EVERY PERSONNEL LINE IS ALLOCATED, so `cashOut` is ~0 and the grant adds no new spend. That
        // is the true shape of an SBIR-funded lab: the payroll is ALREADY going out; what the award
        // changes is that some of it comes back, two months after the period ends. The dip and the
        // recovery both come from timing, not from new cost — which is the entire argument.
        categories: {
          // Six months of a five-person team's time, most of it near full-time on the award.
          personnel: [
            onGrant(staff[1], 850), onGrant(staff[2], 800), onGrant(staff[3], 750),
            onGrant(staff[4], 900), onGrant(staff[0], 350),
          ],
          fringe: { byPeriod: [0.30] },
          // `incremental: false` means the indirect recovery is overhead ALREADY being paid — rent,
          // admin, IT — so it counts as allocated and does not draw cash twice.
          indirect: { base: "total_direct", incremental: false, rates: [{ byPeriod: [0.45] }] },
        },
      },
    },
    {
      id: uid(), type: "grant", name: "State clean-energy match",
      budget: 180000, start: 2, end: 19, lines: [],
      grant: {
        funder: "State Energy Office", assumeFunded: true,
        reimburseTiming: "arrears", reimburseLagMonths: 1,
        // ⚠️ CASH COST SHARE — money spent that nobody reimburses. It reduces runway exactly like any
        // other cost, which is what distinguishes it from in-kind.
        costShareType: "cash", costSharePct: 10,
        periods: [{ id: uid(), start: 2, end: 19 }], milestones: [], categories: null,
      },
    },
    {
      id: uid(), type: "grant", name: "Phase III proposal — pilot scale",
      budget: 2400000, start: 18, end: 41, stage: "prospective", include: true, lines: [],
      grant: {
        funder: "Department of Energy", assumeFunded: false,
        reimburseTiming: "arrears", reimburseLagMonths: 2,
        costShareType: "cash", costSharePct: 0,
        periods: [{ id: uid(), start: 18, end: 41 }], milestones: [], categories: null,
      },
    },
  ],
  // Planning, not closed — so it follows its confidence tier rather than being certain money.
  // ⚠️ CLOSES BEFORE THE COMPANY RUNS OUT, WHICH IT DID NOT USED TO. At month 9 the SAFE landed AFTER
  // the zero crossing, so switching the speculative tier moved the runway by 0.00 months — while this
  // file's own header claimed that toggle was "the most useful single demonstration in the product".
  // A raise that arrives after you are out cannot change when you get there.
  rounds: [{ id: uid(), kind: "safe", name: "Seed SAFE", status: "planning", amount: 1500000,
             closeMonth: 4, capType: "post", cap: 18000000, discount: 0.2, confAuto: true, goals: [] }],
  pos: [], saas: [],
  };
};

// ── 2 · Venture-backed hardware, revenue in hand ─────────────────────────────────────────────────
//
// Shows: the capital stack after a conversion, orders whose cash lands months after delivery, a
// deposit arriving early, and a fulfilment project where cost and revenue move together.
const KESTREL = () => ({
  name: "Kestrel Systems",
  cash: 4120000,
  // Hardware burn is lumpy by nature — tooling and long-lead parts land in whole months. Scatter is
  // wider than the others on purpose, and it is the company where the cost half of the band should be
  // the visible half. cv lands near 0.10.
  ledger: [198000, 226000, 205000, 228000],
  ledgerMix: [0.55, 0.34],
  employees: [
    emp("Dana Whitfield", "CEO", 190000), emp("Marcus Oyelaran", "CTO", 185000),
    emp("Yuki Tanaka", "VP Engineering", 172000), emp("Rosa Delgado", "Hardware Lead", 158000),
    emp("Sam Bright", "Firmware", 142000), emp("Nina Patel", "Firmware", 138000),
    emp("Owen Msizi", "Mechanical", 134000), emp("Lena Fischer", "Test Engineer", 118000),
    emp("Cole Barrett", "Manufacturing", 126000), emp("Amara Diallo", "Supply Chain", 112000),
    emp("Jonah Reed", "Sales", 130000), emp("Iris Kovač", "Customer Success", 98000),
    emp("Theo Nakamura", "Finance", 122000, 2), emp("Priyanka Shah", "Quality", 108000, 4),
  ],
  lines: [
    line("Rent — office and workshop", 24000, "cost", "recurring", 0, 35),
    line("Cloud and tooling", 7800, "cost", "recurring", 0, 35),
    line("Insurance", 4200, "cost", "recurring", 0, 35),
    line("Certification testing", 65000, "cost", "onetime", 6, 6),
  ],
  projects: [{
    id: uid(), type: "fulfillment", name: "Meridian build", budget: 420000, start: 0, end: 5,
    lines: [
      line("Components and BOM", 48000, "cost", "recurring", 0, 5),
      line("Contract assembly", 90000, "cost", "onetime", 4, 4),
    ],
  }],
  pos: [
    // ⚠️ NET 60 ON A MONTH-5 DELIVERY LANDS IN MONTH 7 — and because terms round UP to whole months,
    // net 45 would land there too. Nothing in the interface says so.
    { id: uid(), customer: "Meridian Freight", ref: "PO-4417", amount: 840000,
      bookedMonth: 0, shipMonth: 5, termsDays: 60, depositPct: 0, confidence: "committed" },
    { id: uid(), customer: "Bay Terminal Authority", ref: "PO-2209", amount: 310000,
      bookedMonth: 3, shipMonth: 9, termsDays: 30, depositPct: 0.3, confidence: "expected" },
  ],
  rounds: [
    { id: uid(), kind: "safe", name: "2024 SAFE", status: "closed", amount: 1200000, closeMonth: -18,
      capType: "post", cap: 12000000, discount: 0.2, confAuto: true, goals: [] },
    { id: uid(), kind: "priced", name: "Series A", status: "closed", amount: 6000000, closeMonth: -4,
      capType: "post", cap: 32000000, discount: 0, confAuto: true, goals: [] },
  ],
  saas: [],
});

// ── 3 · Grant-funded non-profit ──────────────────────────────────────────────────────────────────
//
// Shows: milestone billing, an advance-paid grant (the opposite cash shape), in-kind cost share that
// does not touch the bank, and an uncovered commitment.
//
// ⚠️ ITS BAND IS NARROW ON PURPOSE. Almost no speculative income, so almost no uncertainty — **set
// beside Ridgeline's wide band it shows what the band actually measures**: not risk in general, but how
// much of your runway depends on money nobody has promised.
const TIDEWATER = () => ({
  name: "Tidewater Restoration Alliance",
  cash: 612000,
  // A programme budget held tightly: payroll-dominated, little discretionary spend, so the scatter is
  // the narrowest of the four. cv near 0.04 — a demonstrably STEADY organisation, which is its own
  // useful reading of the band.
  ledger: [88000, 96000, 90000, 95000],
  ledgerMix: [0.71, 0.16],
  employees: [
    emp("Grace Amadi", "Executive Director", 118000), emp("Peter Lund", "Programme Director", 104000),
    emp("Aisha Rahman", "Field Lead", 88000), emp("Diego Serrano", "Restoration Ecologist", 82000),
    emp("Mei Chen", "Restoration Ecologist", 82000), emp("Tomas Herrera", "Field Technician", 62000),
    emp("Nora Blake", "Field Technician", 62000), emp("Ravi Menon", "Grants Manager", 76000),
    emp("Chloe Dubois", "Finance and Admin", 71000),
  ],
  lines: [
    line("Office and field station", 6800, "cost", "recurring", 0, 35),
    line("Vehicles and fuel", 3900, "cost", "recurring", 0, 35),
    line("Insurance and audit", 2400, "cost", "recurring", 0, 35),
  ],
  projects: [
    {
      id: uid(), type: "grant", name: "Coastal restoration — federal", budget: 1800000, start: 0, end: 35,
      lines: [],
      grant: {
        // ⚠️ FALSE FOR A MILESTONE-BILLED GRANT. With it true, `computeGrant` emits ONE committed lump
        // and ignores the milestones entirely — so a survey already accepted and a report not yet
        // written counted identically. **The milestones carry the confidence; `assumeFunded` overrides
        // it with certainty the organisation does not have.**
        funder: "NOAA", assumeFunded: false,
        // ⚠️ MILESTONE BILLING. Under arrears, slow work means slow claims and cash roughly tracks.
        // Under milestone billing **a deliverable that slips by a month delays a whole payment.**
        reimburseTiming: "milestone", reimburseLagMonths: 1,
        costShareType: "cash", costSharePct: 0,
        periods: [{ id: uid(), start: 0, end: 11 }, { id: uid(), start: 12, end: 23 },
                  { id: uid(), start: 24, end: 35 }],
        milestones: [
          // ⚠️ ACCEPTED, NOT MERELY DELIVERED. `msTier` maps accepted -> committed and everything else
          // -> expected, so a grant whose milestones are ALL planned has no floor at all: the
          // committed curve sees none of the money and the two curves diverge by the whole award.
          // **One accepted milestone is what makes the floor meaningful** — this funder has paid
          // for work already signed off, and the rest is real but not yet earned.
          { id: uid(), name: "Baseline survey complete", month: 5, payment: 240000, status: "accepted" },
          { id: uid(), name: "Phase 1 planting", month: 13, payment: 520000, status: "planned" },
          { id: uid(), name: "Year 2 monitoring report", month: 23, payment: 480000, status: "planned" },
          { id: uid(), name: "Final report", month: 34, payment: 560000, status: "planned" },
        ],
        categories: null,
      },
    },
    {
      id: uid(), type: "grant", name: "Foundation programme support", budget: 400000, start: 0, end: 23,
      lines: [],
      grant: {
        funder: "Wexler Foundation", assumeFunded: true,
        // ⚠️ ADVANCE — money arrives BEFORE the spend, which is the opposite shape from arrears and
        // rare enough that people do not believe it until they see it modelled.
        reimburseTiming: "advance", reimburseLagMonths: 0,
        costShareType: "cash", costSharePct: 0,
        periods: [{ id: uid(), start: 0, end: 11 }, { id: uid(), start: 12, end: 23 }],
        milestones: [], categories: null,
      },
    },
    {
      id: uid(), type: "grant", name: "State habitat programme", budget: 250000, start: 4, end: 27,
      lines: [],
      grant: {
        funder: "State Coastal Commission", assumeFunded: true,
        reimburseTiming: "arrears", reimburseLagMonths: 2,
        // ⚠️ IN-KIND — the most misunderstood number on a grant. It appears on the budget as a large
        // figure and **moves no cash at all**, because the staff time it represents is already on
        // payroll. Counting it as spend would charge those salaries twice.
        costShareType: "inkind", costSharePct: 25,
        periods: [{ id: uid(), start: 4, end: 27 }], milestones: [], categories: null,
      },
    },
  ],
  rounds: [], pos: [], saas: [],
});

// ── 4 · SaaS startup ─────────────────────────────────────────────────────────────────────────────
//
// Shows: churn against acquisition, three plans at very different prices, and an internal project
// absorbing labor with nothing coming back.
const LARKSPUR = () => ({
  name: "Larkspur Analytics",
  cash: 310000,
  // Small team, mostly salary and hosting, with one month carrying an annual software renewal. cv near
  // 0.08 — its band width should still be dominated by the revenue tiers, not by spend.
  ledger: [29000, 32000, 30000, 35000],
  ledgerMix: [0.68, 0.19],
  employees: [
    emp("Rowan Vasquez", "Founder", 96000), emp("Kit Osei", "Engineer", 128000),
    emp("Mira Solberg", "Engineer", 124000), emp("Jae-won Park", "Design and Support", 98000),
  ],
  lines: [
    line("Cloud hosting", 4200, "cost", "recurring", 0, 35, { growthPct: 2 }),
    line("Tooling and subscriptions", 1900, "cost", "recurring", 0, 35),
    line("Contract marketing", 5000, "cost", "recurring", 2, 17),
  ],
  projects: [{
    // Labor only, no revenue — the case that makes the allocation view worth opening.
    id: uid(), type: "internal", name: "Platform rebuild", budget: 180000, start: 1, end: 10,
    lines: [], labor: [],
  }],
  saas: [
    // ⚠️ THE SOLO PLAN IS ROUGHLY FLAT AND SHRINKS IF YOU TOUCH IT. 3.2% monthly churn against 14 new
    // is nearly balanced — **a SaaS demo where every plan grows teaches nothing about what churn does.**
    { id: uid(), name: "Solo", startCustomers: 176, arpu: 29, churnPct: 3.2,
      newPerMonth: 14, newGrowthPct: 2, include: true },
    { id: uid(), name: "Team", startCustomers: 41, arpu: 149, churnPct: 1.8,
      newPerMonth: 6, newGrowthPct: 5, include: true },
    { id: uid(), name: "Enterprise", startCustomers: 5, arpu: 890, churnPct: 0.5,
      newPerMonth: 0.5, newGrowthPct: 8, include: true },
  ],
  rounds: [{ id: uid(), kind: "safe", name: "Pre-seed SAFE", status: "closed", amount: 500000,
             closeMonth: -6, capType: "post", cap: 6000000, discount: 0.2, confAuto: true, goals: [] }],
  pos: [],
});

/** The list the picker shows.
 *
 *  ⚠️ EACH BLURB SAYS WHAT THE COMPANY SHOWS, NOT WHAT IT IS. "An SBIR award and a proposal you have
 *  not won yet" is a description; "shows the gap between spending and being reimbursed" is the reason
 *  to pick it. **Somebody at the front door is choosing what to learn**, not which fictional company
 *  they identify with.
 */
export const ARCHETYPES = Object.freeze([
  { id: "grant-startup", label: "Grant-funded startup", company: "Ridgeline Catalysis",
    blurb: "An SBIR award, a state match, and a Phase III proposal you have not won yet.",
    shows: "Shows the gap between spending and being reimbursed.",
    // ⚠️ HIDDEN TABS PER ARCHETYPE, which doubles as the demonstration that the setup questions do
    // something — a non-profit with a Sales tab full of nothing teaches the wrong lesson.
    hidden: ["sales"], build: RIDGELINE },
  { id: "hardware-vc", label: "Venture-backed hardware", company: "Kestrel Systems",
    blurb: "A Series A in the bank and two customer orders in flight.",
    shows: "Shows when order money actually lands.",
    hidden: ["sales:subs"], build: KESTREL },
  { id: "nonprofit", label: "Grant-funded non-profit", company: "Tidewater Restoration Alliance",
    blurb: "Three funders paying three different ways, and a subcontract nothing covers.",
    shows: "Shows milestone billing and in-kind cost share.",
    hidden: ["sales", "inv"], build: TIDEWATER },
  { id: "saas", label: "SaaS startup", company: "Larkspur Analytics",
    blurb: "Three plans, one of them shrinking.",
    shows: "Shows churn working against new customers.",
    hidden: ["proj:grants", "proj:proposals", "proj:fulfil", "sales:orders", "sales:targets"],
    build: LARKSPUR },
]);

export const archetypeById = (id) => ARCHETYPES.find(a => a.id === id) || null;
