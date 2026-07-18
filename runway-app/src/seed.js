// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { blankFulfillment } from "./engine/sales";
import { uid } from "./engine/time";

// Company operating lines — shown in the "Cash flow" tab
export const SEED_LINES = [
  { id: uid(), label: "Office & rent",      cadence: "recurring", kind: "cost",    amount: 6500,  start: 0, end: null, growthPct: 0 },
  { id: uid(), label: "Software & tools",   cadence: "recurring", kind: "cost",    amount: 3200,  start: 0, end: null, growthPct: 2 },
  { id: uid(), label: "Marketing",          cadence: "recurring", kind: "cost",    amount: 6000,  start: 0, end: null, growthPct: 4 },
  { id: uid(), label: "SaaS subscriptions", cadence: "recurring", kind: "revenue", amount: 14000, start: 0, end: null, growthPct: 8, confidence: "expected" },
  { id: uid(), label: "Enterprise contract",cadence: "recurring", kind: "revenue", amount: 9000,  start: 3, end: null, growthPct: 0, confidence: "committed" },
  { id: uid(), label: "Innovation grant",   cadence: "onetime",   kind: "revenue", amount: 75000, start: 4, confidence: "committed" },
  { id: uid(), label: "Pilot deal (Acme)",  cadence: "onetime",   kind: "revenue", amount: 150000,start: 6, confidence: "speculative" },
];

// Payroll roster — itemized headcount with time-dependent comp; feeds the "Payroll" cost in the projection
export const SEED_EMPLOYEES = [
  { id: uid(), name: "Alex Rivera", title: "CEO", basis: "annual", amount: 168000, start: 0, end: null, raises: [], promotions: [] },
  { id: uid(), name: "Jordan Chen", title: "CTO", basis: "annual", amount: 156000, start: 0, end: null, raises: [], promotions: [] },
  { id: uid(), name: "Sam Okafor", title: "Senior Engineer", basis: "annual", amount: 132000, start: 0, end: null,
    raises: [{ id: uid(), month: 12, mode: "pct", value: 8, everyMonths: 0 }],
    promotions: [{ id: uid(), month: 9, title: "Staff Engineer" }] },
  { id: uid(), name: "Priya Nair", title: "Engineer", basis: "annual", amount: 108000, start: 0, end: null,
    raises: [{ id: uid(), month: 8, mode: "pct", value: 12, everyMonths: 0 }],
    promotions: [{ id: uid(), month: 8, title: "Senior Engineer" }] },
  { id: uid(), name: "Morgan Lee", title: "Ops & Marketing Lead", basis: "annual", amount: 60000, start: 0, end: null,
    raises: [{ id: uid(), month: 12, mode: "pct", value: 4, everyMonths: 12 }], promotions: [] },
  { id: uid(), name: "New Engineer", title: "Engineer", basis: "annual", amount: 108000, start: 6, end: null, raises: [], promotions: [] },
];

// Purchase orders — the "Sales" tab. A PO books revenue (deposit on order, balance on delivery + terms)
// and carries the performance targets you've committed to. Fulfilling it costs money; that lives in a
// linked "PO fulfillment" project so the cash-out is modeled explicitly rather than assumed away.
/* ---- Capital. The round is why the runway matters: a raise is a deadline with a number on it.
   One sorted list of instruments, because order is load-bearing — a SAFE converts at the first priced
   round that closes after it does. ---- */

export const SEED_ROUNDS = [
  { id: uid(), kind: "safe", name: "2025 SAFE", status: "closed", amount: 1000000, closeMonth: 0,
    capType: "post", cap: 15000000, discount: 0.20, confAuto: true, goals: [] },
  { id: uid(), kind: "debt", name: "Growth facility", status: "planning", amount: 2000000, closeMonth: 3,
    rateAPR: 12, termMonths: 36, ioMonths: 12, feesPct: 0.01, finalPct: 0.05, warrantPct: 0.01,
    covenantCash: 400000, confAuto: true, goals: [] },
  { id: uid(), kind: "equity", name: "Series A", status: "planning", amount: 6000000, committedAmount: 0,
    preMoney: 24000000, closeMonth: 8, startMonth: 2, leadName: "", confAuto: true,
    useOfFunds: "18 months to a qualified 25 kW array and repeat orders",
    goals: [
      { id: uid(), kind: "technical", label: "5 kW stack at 92% efficiency, 1,000 h duty", dueMonth: 5, status: "at-risk" },
      { id: uid(), kind: "commercial", label: "$1M booked across three named customers", dueMonth: 6, status: "on-track" },
      { id: uid(), kind: "commercial", label: "Second DOE award or equivalent non-dilutive", dueMonth: 7, status: "on-track" },
      { id: uid(), kind: "team", label: "VP Engineering hired", dueMonth: 4, status: "not-started" },
      { id: uid(), kind: "regulatory", label: "UL 1741 pre-certification underway", dueMonth: 9, status: "not-started" },
    ] },
];

export const SEED_POS = [
  { id: uid(), customer: "Northwind Energy", po: "PO-2026-0142", amount: 145000, confidence: "committed",
    bookedMonth: 0, deliveryMonth: 5, termsDays: 30, depositPct: 0.25, devDecision: null, projectId: null,
    targets: [
      { id: uid(), metric: "Stack output", dir: "above", target: 5.0, units: "kW continuous", flex: "showstopper", current: 5.2 },
      { id: uid(), metric: "Conversion efficiency", dir: "above", target: 92, units: "% at rated load", flex: "showstopper", current: 88 },
      { id: uid(), metric: "Cold-start", dir: "below", target: 90, units: "s to rated", flex: "soft", current: 74 },
    ] },
  { id: uid(), customer: "Cascade Materials", po: "PO-2026-0151", amount: 62000, confidence: "committed",
    bookedMonth: 2, deliveryMonth: 7, termsDays: 45, depositPct: 0, devDecision: null, projectId: null,
    targets: [{ id: uid(), metric: "Catalyst loading", dir: "below", target: 0.42, units: "mg/cm\u00B2", flex: "showstopper", current: 0.40 }] },
  { id: uid(), customer: "Meridian Grid", po: "Quote Q-118", amount: 480000, confidence: "speculative",
    bookedMonth: 4, deliveryMonth: 12, termsDays: 60, depositPct: 0.30, devDecision: null, projectId: null,
    targets: [
      { id: uid(), metric: "Array output", dir: "above", target: 25, units: "kW", flex: "showstopper", current: null },
      { id: uid(), metric: "Duty cycle", dir: "above", target: 8000, units: "h/yr", flex: "soft", current: null },
      { id: uid(), metric: "Enclosure rating", dir: "above", target: 65, units: "IP", flex: "nice", current: 54 },
    ] },
];

// Projects — the "Projects" tab. Internal projects draw internal funds;
// grants bring external funding (milestone- or budget-period-based). All feed the master projection.
export const SEED_PROJECTS = [
  { id: uid(), type: "internal", name: "Mobile app launch", budget: 95000, start: 1, end: 6, lines: [
    { id: uid(), label: "Design contractors", cadence: "onetime",   kind: "cost", amount: 14000, start: 1 },
    { id: uid(), label: "Dev contractors",    cadence: "recurring", kind: "cost", amount: 18000, start: 1, end: 5, growthPct: 0 },
    { id: uid(), label: "Equipment",          cadence: "onetime",   kind: "cost", amount: 8000,  start: 2 },
    { id: uid(), label: "Launch & app store", cadence: "onetime",   kind: "cost", amount: 6000,  start: 6 },
  ]},
  { id: uid(), type: "grant", name: "Catalyst scale-up", grant: {
    funder: "DOE EERE", assumeFunded: false, costShareType: "cash",
    costSharePct: 0.20, reimburseTiming: "arrears", reimburseLagMonths: 1,
    periods: [ { id: uid(), start: 0, end: 5 }, { id: uid(), start: 6, end: 11 } ],
    categories: {
      personnel: [
        { id: uid(), role: "Principal Investigator", byPeriod: [ { hrs: 416, rate: 62.5 }, { hrs: 416, rate: 64.4 } ] },
        { id: uid(), role: "Research Engineer",       byPeriod: [ { hrs: 1040, rate: 43 }, { hrs: 1040, rate: 44.3 } ] },
      ],
      fringe: { byPeriod: [ 0.30, 0.30 ] },
      travel: [
        { id: uid(), purpose: "DOE program review, DC", days: 3, travelers: 2, lodging: 210, flight: 420, vehicle: 0, perDiem: 74, period: 0 },
        { id: uid(), purpose: "DOE program review, DC", days: 3, travelers: 2, lodging: 210, flight: 420, vehicle: 0, perDiem: 74, period: 1 },
      ],
      equipment: [],
      supplies: [
        { id: uid(), item: "Catalyst materials", qty: 1, unitCost: 14000, period: 0 },
        { id: uid(), item: "Catalyst materials", qty: 1, unitCost: 14000, period: 1 },
      ],
      contractual: [], construction: [],
      other: [ { id: uid(), desc: "Data management & publication", byPeriod: [ 3000, 3000 ] } ],
      indirect: { base: "personnel_fringe", rates: [ { id: uid(), label: "Overhead + G&A", byPeriod: [ 0.45, 0.46 ] } ] },
    },
  }},
  { id: uid(), type: "grant", name: "Sensor SBIR Phase II", grant: {
    funder: "ARPA-E", assumeFunded: false, costShareType: "cash", costSharePct: 0,
    reimburseTiming: "milestone", reimburseLagMonths: 1,
    periods: [ { id: uid(), start: 2, end: 13 } ],
    categories: {
      personnel: [ { id: uid(), role: "Engineering", byPeriod: [ { hrs: 1200, rate: 90 } ] } ],
      fringe: { byPeriod: [ 0 ] },
      travel: [], equipment: [],
      supplies: [ { id: uid(), item: "Prototype parts", qty: 1, unitCost: 15000, period: 0 } ],
      contractual: [], construction: [], other: [],
      indirect: { base: "total_direct", rates: [] },
    },
    milestones: [
      { id: uid(), label: "Design complete",   month: 4,  payment: 40000 },
      { id: uid(), label: "Working prototype", month: 8,  payment: 45000 },
      { id: uid(), label: "Field validation",  month: 13, payment: 45000 },
    ],
  }},
  { id: uid(), type: "grant", stage: "prospective", include: false, decisionMonth: 4, name: "NSF POWER (proposal)", grant: {
    funder: "NSF", assumeFunded: false, costShareType: "cash", costSharePct: 0,
    reimburseTiming: "milestone", reimburseLagMonths: 1,
    periods: [ { id: uid(), start: 5, end: 16 } ],
    categories: {
      personnel: [ { id: uid(), role: "Research staff", byPeriod: [ { hrs: 1600, rate: 90 } ] } ],
      fringe: { byPeriod: [ 0 ] },
      travel: [],
      equipment: [ { id: uid(), item: "Instrumentation", qty: 1, unitCost: 28000, period: 0 } ],
      supplies: [], contractual: [], construction: [], other: [],
      indirect: { base: "total_direct", rates: [] },
    },
    milestones: [
      { id: uid(), label: "Phase I deliverable",  month: 10, payment: 95000 },
      { id: uid(), label: "Phase II deliverable", month: 16, payment: 95000 },
    ],
  }},
];

export const SEED_MILESTONES = [
  { id: uid(), label: "Board review",     y: 2026, m: 8, day: 30 },
  { id: uid(), label: "Product launch",   y: 2027, m: 0, day: 15 },
];

// Ordered oldest -> newest. Position IS the date: the last entry is the month before month 0, so
// these labels derive from the projection start rather than being typed. `mo` is vestigial.
export const HIST = [
  { mo: "Jan", v: 72000 }, { mo: "Feb", v: 76000 }, { mo: "Mar", v: 74000 },
  { mo: "Apr", v: 108000, note: "one-off: equipment" }, { mo: "May", v: 78000 }, { mo: "Jun", v: 82000 },
];

// Every PO ships with its fulfillment project already attached — booking revenue with no cost of
// delivering it should be impossible, not a button somebody has to remember to press.
export const SEED_FULFIL = [];

export const SEED_POS_LINKED = SEED_POS.map(po => { const f = blankFulfillment(po); SEED_FULFIL.push(f); return { ...po, projectId: f.id }; });

// Staff the demo so team allocation is visible out of the box.
export const STAFFING = [[2, 3, 3], [3], [2, 2]]; // SEED_EMPLOYEES index per labour line, per order
SEED_FULFIL.forEach((f, i) => f.lines.filter(l => l.isLabor).forEach((l, j) => {
  const idx = STAFFING[i]?.[j]; if (idx != null) l.employeeId = SEED_EMPLOYEES[idx].id;
}));
