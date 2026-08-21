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
  ledger: [78000, 118000, 84000, 90000, 79000, 87000],
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
        // ⚠️ `assumeFunded: false`, OR THE COST SHARE IS CHARGED WITH NO AWARD AGAINST IT. With it TRUE the
        // revenue branch is skipped entirely and `gross` becomes `t.costShare` — so the grant books the
        // match as spend and reimburses nothing. That is worse than an inert grant: it is a grant that
        // only costs you money.
        funder: "State Energy Office", assumeFunded: false,
        reimburseTiming: "arrears", reimburseLagMonths: 1,
        // ⚠️ CASH COST SHARE — money spent that nobody reimburses. It reduces runway exactly like any
        // other cost, which is what distinguishes it from in-kind.
        // ⚠️ A FRACTION, NOT A PERCENT, DESPITE THE NAME. `computeGrant` reads
        // `federal = total * (1 - costSharePct)`, so `10` here means "match ten times the award" and
        // produced revenue of MINUS $1,067,384. Invisible for as long as `categories: null` kept the
        // budget total at zero — the moment this grant compiled anything, it compiled nonsense.
        costShareType: "cash", costSharePct: 0.10,
        periods: [{ id: uid(), start: 2, end: 19 }], milestones: [],
        // Small and long — one chemist's time plus a modest supplies line, so the 10% CASH match is a
        // real cost the company carries rather than an accounting entry.
        categories: {
          personnel: [onGrant(staff[2], 900)],
          fringe: { byPeriod: [0.30] },
          supplies: [{ id: uid(), name: "Reagents", period: 0, qty: 1, unitCost: 24000 }],
          indirect: { base: "total_direct", incremental: false, rates: [{ byPeriod: [0.25] }] },
        },
      },
    },
    {
      id: uid(), type: "grant", name: "Phase III proposal — pilot scale",
      budget: 2400000, start: 18, end: 41, stage: "prospective", include: true, lines: [],
      grant: {
        funder: "Department of Energy", assumeFunded: false,
        reimburseTiming: "arrears", reimburseLagMonths: 2,
        costShareType: "cash", costSharePct: 0,
        periods: [{ id: uid(), start: 18, end: 41 }], milestones: [],
        // ⚠️ `stage: "prospective"` PUTS EVERY DOLLAR OF THIS IN THE EXPECTED TIER, which is the point of
        // carrying a proposal in the model at all — it widens the band without moving the floor.
        categories: {
          personnel: [onGrant(staff[1], 1800), onGrant(staff[3], 1600)],
          fringe: { byPeriod: [0.30] },
          indirect: { base: "total_direct", incremental: false, rates: [{ byPeriod: [0.45] }] },
        },
      },
    },
  ],
  // ⚠️ MONTHS FROM TODAY, resolved to calendar dates by `demoDoc`. Targets are the point: a critical
  // date with no target passes on any non-negative balance, which for a covenant or a payroll buffer is
  // the wrong question.
  // ⚠️ NEVER AUTHOR A ROUND CLOSE HERE. `roundMS` DERIVES one from every open instrument, and
  // `capital.js` says why: "A close date IS a critical date. Derive it rather than asking anyone to keep
  // two copies in step — move the close in Investment and the milestone, the chart marker and the
  // balance all follow." Authoring a second one puts two markers on one event that then drift apart.
  //
  // The Seed SAFE closes in month 4, so `roundMS` already places "Seed SAFE close" there. These three
  // are the things the SAFE is being raised AGAINST, and month 2 keeps the first clear of it.
  milestones: [
    { label: "SBIR drawdown filed", month: 2 },
    { label: "Board review — raise or cut", month: 6, target: 250000 },
    { label: "Pilot rig commissioned", month: 10, target: 100000 },
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
const KESTREL = () => {
  const staff = [
    emp("Dana Whitfield", "CEO", 190000), emp("Marcus Oyelaran", "CTO", 185000),
    emp("Yuki Tanaka", "VP Engineering", 172000), emp("Rosa Delgado", "Hardware Lead", 158000),
    emp("Sam Bright", "Firmware", 142000), emp("Nina Patel", "Firmware", 138000),
    emp("Owen Msizi", "Mechanical", 134000), emp("Lena Fischer", "Test Engineer", 118000),
    emp("Cole Barrett", "Manufacturing", 126000), emp("Amara Diallo", "Supply Chain", 112000),
    emp("Jonah Reed", "Sales", 130000), emp("Iris Kovač", "Customer Success", 98000),
    emp("Theo Nakamura", "Finance", 122000, 2), emp("Priyanka Shah", "Quality", 108000, 4),
  ];
  return {
  name: "Kestrel Systems",
  cash: 4120000,
  // Hardware burn is lumpy by nature — tooling and long-lead parts land in whole months. Scatter is
  // wider than the others on purpose, and it is the company where the cost half of the band should be
  // the visible half. cv lands near 0.10.
  ledger: [205000, 296000, 212000, 228000, 208000, 224000],
  ledgerMix: [0.55, 0.34],
  employees: staff,

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
      // ⚠️ `isLabor: true` IS HOW `teamLoad` SEES ALLOCATION for anything that is not a grant — HOURS,
      // not money, and `compileProject` filters these OUT of the projection because payroll has already
      // paid for the time. Without them the Allocation tab and "Team load by project" draw nothing,
      // however much work the project actually represents. `amount: 0` is deliberate, not a placeholder.
      // ⚠️ `employeeId` IS REQUIRED — `teamLoad`'s `push` starts `if (!id || !hrs) return`, so a labour
      // line with a null employee records NOTHING. Capacity is a question about PEOPLE; a line that
      // names no one cannot answer it.
      { id: uid(), label: "Mechanical build", kind: "cost", isLabor: true, employeeId: staff[6].id,
        hours: 640, cadence: "recurring", amount: 0, start: 0, end: 5, growthPct: 0 },
      { id: uid(), label: "Firmware and test", kind: "cost", isLabor: true, employeeId: staff[4].id,
        hours: 420, cadence: "recurring", amount: 0, start: 2, end: 5, growthPct: 0 },
      { id: uid(), label: "Test and qualification", kind: "cost", isLabor: true, employeeId: staff[7].id,
        hours: 380, cadence: "recurring", amount: 0, start: 1, end: 5, growthPct: 0 },
    ],
  }],
  pos: [
    // ⚠️ NET 60 ON A MONTH-5 DELIVERY LANDS IN MONTH 7 — and because terms round UP to whole months,
    // net 45 would land there too. Nothing in the interface says so.
    //
    // ⚠️ `deliveryMonth`, NOT `shipMonth`. These two POs carried `shipMonth`, which NOTHING READS —
    // `poPaidMonth` is `(po.deliveryMonth || 0) + poLag(po)`, and the editor, the new-PO modal and the
    // factors registry all use `deliveryMonth` too. So both orders paid at month 0 plus terms whatever
    // month they shipped: Bay Terminal booked in month 3 and was PAID IN MONTH 1, two months before the
    // order existed. Silent, because `|| 0` is a valid month.
    // ⚠️ SPECULATIVE, AND DATED BEFORE THE CROSSING — the only way a tier toggle can do anything. An
    // order landing after you are out cannot change when you get there, which is exactly how Ridgeline's
    // Seed SAFE sat inert at month 9 while the company crossed zero at month 8.
    { id: uid(), customer: "Halden Marine", ref: "RFQ-2210", amount: 1600000,
      bookedMonth: 9, deliveryMonth: 13, termsDays: 60, depositPct: 0.15, confidence: "speculative" },
    { id: uid(), customer: "Meridian Freight", ref: "PO-4417", amount: 840000,
      bookedMonth: 0, deliveryMonth: 5, termsDays: 60, depositPct: 0, confidence: "committed" },
    { id: uid(), customer: "Bay Terminal Authority", ref: "PO-2209", amount: 310000,
      bookedMonth: 3, deliveryMonth: 9, termsDays: 30, depositPct: 0.3, confidence: "expected" },
  ],
  milestones: [
    { label: "Meridian units shipped", month: 3 },
    // Not "Series B close" — there is no Series B instrument, and a milestone that names a round the
    // model does not carry sends a reader to an Investment tab that has nothing in it.
    { label: "Production line qualified", month: 9, target: 1500000 },
    { label: "Bay Terminal acceptance", month: 12, target: 800000 },
  ],
  rounds: [
    { id: uid(), kind: "safe", name: "2024 SAFE", status: "closed", amount: 1200000, closeMonth: -18,
      capType: "post", cap: 12000000, discount: 0.2, confAuto: true, goals: [] },
    { id: uid(), kind: "priced", name: "Series A", status: "closed", amount: 6000000, closeMonth: -4,
      capType: "post", cap: 32000000, discount: 0, confAuto: true, goals: [] },
  ],
  // ⚠️ AUTHORED AS OF TODAY. `demoDoc` divides every compounding field back through `DEMO_BACKFILL`
  // months so the model begins with a smaller book that grows into exactly these numbers by the time
  // the demo is opened. Read them as "210 Solo customers right now, adding 14 a month" — the back-solve
  // is arithmetic in one place, not magic constants here.
  saas: [],
  };
};

// ── 3 · Grant-funded non-profit ──────────────────────────────────────────────────────────────────
//
// Shows: milestone billing, an advance-paid grant (the opposite cash shape), in-kind cost share that
// does not touch the bank, and an uncovered commitment.
//
// ⚠️ ITS BAND IS NARROW ON PURPOSE. Almost no speculative income, so almost no uncertainty — **set
// beside Ridgeline's wide band it shows what the band actually measures**: not risk in general, but how
// much of your runway depends on money nobody has promised.
const TIDEWATER = () => {
  const staff = [
    emp("Grace Amadi", "Executive Director", 118000), emp("Peter Lund", "Programme Director", 104000),
    emp("Aisha Rahman", "Field Lead", 88000), emp("Diego Serrano", "Restoration Ecologist", 82000),
    emp("Mei Chen", "Restoration Ecologist", 82000), emp("Tomas Herrera", "Field Technician", 62000),
    emp("Nora Blake", "Field Technician", 62000), emp("Ravi Menon", "Grants Manager", 76000),
    emp("Chloe Dubois", "Finance and Admin", 71000),
  ];
  // Allocated hours per budget period — salary already leaving as payroll, so the award reimburses it
  // rather than adding new spend. `rate` is filled from each person's own salary.
  const onGrant = (e, ...hrs) => ({ id: uid(), name: e.name, employeeId: e.id, byPeriod: hrs.map(h => ({ hrs: h })) });

  return {
  name: "Tidewater Restoration Alliance",
  cash: 612000,
  // A programme budget held tightly: payroll-dominated, little discretionary spend, so the scatter is
  // the narrowest of the four. cv near 0.04 — a demonstrably STEADY organisation, which is its own
  // useful reading of the band.
  ledger: [89000, 121000, 91000, 96000, 90000, 94000],
  ledgerMix: [0.71, 0.16],
  employees: staff,
  lines: [
    line("Office and field station", 6800, "cost", "recurring", 0, 35),
    line("Vehicles and fuel", 3900, "cost", "recurring", 0, 35),
    line("Insurance and audit", 2400, "cost", "recurring", 0, 35),
    // ⚠️ SPECULATIVE, AND BEFORE THE CROSSING. A named gift in conversation but not signed — the tier
    // this organisation most needs to switch off and watch the date move.
    line("Bequest — Hartnell estate", 550000, "revenue", "onetime", 7, null, { confidence: "speculative" }),
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
        funder: "Wexler Foundation", assumeFunded: false,
        // ⚠️ ADVANCE — money arrives BEFORE the spend, which is the opposite shape from arrears and
        // rare enough that people do not believe it until they see it modelled.
        reimburseTiming: "advance", reimburseLagMonths: 0,
        costShareType: "cash", costSharePct: 0,
        periods: [{ id: uid(), start: 0, end: 11 }, { id: uid(), start: 12, end: 23 }],
        milestones: [],
        // Two years of programme staff time, allocated — so the award reimburses payroll rather than
        // adding spend, and the ADVANCE timing puts each year's money in before the year is worked.
        categories: {
          personnel: [onGrant(staff[1], 900, 900), onGrant(staff[2], 800, 800), onGrant(staff[3], 700, 700)],
          fringe: { byPeriod: [0.24, 0.24] },
          indirect: { base: "total_direct", incremental: false, rates: [{ byPeriod: [0.15, 0.15] }] },
        },
      },
    },
    {
      id: uid(), type: "grant", name: "State habitat programme", budget: 250000, start: 4, end: 27,
      lines: [],
      grant: {
        funder: "State Coastal Commission", assumeFunded: false,
        reimburseTiming: "arrears", reimburseLagMonths: 2,
        // ⚠️ IN-KIND — the most misunderstood number on a grant. It appears on the budget as a large
        // figure and **moves no cash at all**, because the staff time it represents is already on
        // payroll. Counting it as spend would charge those salaries twice.
        costShareType: "inkind", costSharePct: 0.25,
        periods: [{ id: uid(), start: 4, end: 27 }], milestones: [],
        // In-kind means the 25% match is staff time already on payroll — it appears on the budget and
        // moves no cash, which is exactly what `costShareType: "inkind"` encodes in `computeGrant`.
        categories: {
          personnel: [onGrant(staff[4], 1600), onGrant(staff[5], 1400), onGrant(staff[6], 1400)],
          fringe: { byPeriod: [0.24] },
          indirect: { base: "total_direct", incremental: false, rates: [{ byPeriod: [0.15] }] },
        },
      },
    },
  ],
  milestones: [
    { label: "Federal Phase 1 report due", month: 3 },
    { label: "Board reserve floor", month: 8, target: 300000 },
    { label: "Foundation year-2 renewal", month: 12, target: 150000 },
  ],
  rounds: [], pos: [], saas: [],
  };
};

// ── 4 · SaaS startup ─────────────────────────────────────────────────────────────────────────────
//
// Shows: churn against acquisition, three plans at very different prices, and an internal project
// absorbing labor with nothing coming back.
const LARKSPUR = () => {
  const staff = [
    emp("Rowan Vasquez", "Founder", 96000), emp("Kit Osei", "Engineer", 128000),
    emp("Mira Solberg", "Engineer", 124000), emp("Jae-won Park", "Design and Support", 98000),
  ];
  return {
  name: "Larkspur Analytics",
  cash: 310000,
  // Small team, mostly salary and hosting, with one month carrying an annual software renewal. cv near
  // 0.08 — its band width should still be dominated by the revenue tiers, not by spend.
  ledger: [30000, 44000, 31000, 34000, 30000, 33000],
  ledgerMix: [0.68, 0.19],
  employees: staff,

  lines: [
    line("Cloud hosting", 4200, "cost", "recurring", 0, 35, { growthPct: 2 }),
    line("Tooling and subscriptions", 1900, "cost", "recurring", 0, 35),
    line("Contract marketing", 5000, "cost", "recurring", 2, 17),
  ],
  projects: [{
    // Labor only, no revenue — the case that makes the allocation view worth opening.
    id: uid(), type: "internal", name: "Platform rebuild", budget: 180000, start: 1, end: 10,
    // ⚠️ `labor: []` IS A FOURTH ALLOCATION MECHANISM AND NOTHING READS IT — `teamLoad` reads `lines`
    // with `isLabor`, so an internal project's effort has to live there or it is invisible to both the
    // Allocation tab and the team-load chart. Hours only: the salaries are already in payroll, and
    // charging them here would bill the same engineer twice.
    lines: [
      { id: uid(), label: "Rebuild engineering", kind: "cost", isLabor: true, employeeId: staff[1].id,
        hours: 900, cadence: "recurring", amount: 0, start: 1, end: 10, growthPct: 0 },
      { id: uid(), label: "Migration and QA", kind: "cost", isLabor: true, employeeId: staff[2].id,
        hours: 320, cadence: "recurring", amount: 0, start: 6, end: 10, growthPct: 0 },
    ],
  }],
  saas: [
    // ⚠️ THE SOLO PLAN IS ROUGHLY FLAT AND SHRINKS IF YOU TOUCH IT. 3.2% monthly churn against 14 new
    // is nearly balanced — **a SaaS demo where every plan grows teaches nothing about what churn does.**
    { id: uid(), name: "Solo", startCustomers: 210, arpu: 29, churnPct: 3.2,
      newPerMonth: 14, newGrowthPct: 2, include: true },
    { id: uid(), name: "Team", startCustomers: 64, arpu: 149, churnPct: 1.8,
      newPerMonth: 6, newGrowthPct: 5, include: true },
    { id: uid(), name: "Enterprise", startCustomers: 7, arpu: 890, churnPct: 0.5,
      newPerMonth: 0.5, newGrowthPct: 8, include: true },
  ],
  // ⚠️ "Seed close or extend" WAS HERE AND WAS A DUPLICATE. The Seed round closes in month 6 and
  // `roundMS` already derives "Seed round close" for exactly that date — two markers, one event, and
  // the authored copy would not follow if the close date moved.
  milestones: [
    { label: "Enterprise tier GA", month: 2 },
    { label: "Annual contracts renewed", month: 9, target: 180000 },
    { label: "Cash-flow positive target", month: 14 },
  ],
  rounds: [
    // ⚠️ `status: "raising"` MAPS TO SPECULATIVE through INST_CONF, so this is the tier toggle's
    // demonstration here — the status spine already says how sure it is, no separate field needed. And
    // it closes at month 6, comfortably before the crossing, because a round landing after you are out
    // cannot move the date.
    { id: uid(), kind: "equity", name: "Seed round", status: "raising", amount: 2200000,
      closeMonth: 6, capType: "post", preMoney: 9000000, cap: 0, discount: 0, confAuto: true,
      // ⚠️ GOALS ARE THE EVIDENCE THE ROUND IS BEING RAISED ON, and `phase: "pre"` means it has to be
      // true BEFORE the money lands. The chart's whole question is whether the runway reaches them —
      // a goal due after the cash runs out is a round you cannot raise.
      goals: [
        { id: uid(), kind: "commercial", label: "$25k MRR", dueMonth: 3, status: "on-track", phase: "pre" },
        { id: uid(), kind: "technical", label: "Enterprise SSO shipped", dueMonth: 4, status: "at-risk", phase: "pre" },
        { id: uid(), kind: "commercial", label: "Two lighthouse logos", dueMonth: 5, status: "not-started", phase: "pre" },
        { id: uid(), kind: "financial", label: "Net retention above 100%", dueMonth: 11, status: "not-started", phase: "post" },
      ] },
    { id: uid(), kind: "safe", name: "Pre-seed SAFE", status: "closed", amount: 500000,
      closeMonth: -6, capType: "post", cap: 6000000, discount: 0.2, confAuto: true, goals: [] }],
  pos: [],
  };
};

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
