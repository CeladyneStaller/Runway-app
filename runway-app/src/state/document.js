// The unit of persistence AND the unit of ownership. One document = one company's model.
// Today: a single document in IndexedDB. Later: the same object, one row per owner, no shape change.
// The engine never sees this — it takes plain arrays. That seam is what keeps multi-user cheap.
import { SEED_LINES, SEED_EMPLOYEES, SEED_PROJECTS, SEED_ROUNDS, SEED_POS_LINKED, SEED_FULFIL, SEED_MILESTONES, HIST, SEED_JOURNAL } from "../seed";
import { OVERHEAD } from "../engine/coding";
import { ARCHETYPES, archetypeById } from "./archetypes";

export const SCHEMA_VERSION = 9;

const settings = () => ({
  fringePct: 0.30,
  fringe: {                    // itemized/manual fringe config; fringePct above is the legacy fallback
    mode: "itemized",
    vacationDays: "", holidayDays: "", sickDays: "",
    payrollTaxPct: "", k401Pct: "", k401MatchPct: "", insurancePerPerson: "",
    manualPct: "",
  },
  method: "trailing",
  applyBaseline: true,
  anchorActuals: true,
  // FINANCING ON BY DEFAULT. It was off, which meant a company with a closed round saw a runway that
  // ignored money already in the bank — the toggle exists so a $6m raise cannot drown a $480k quote in
  // one trace, not to hide financing that has happened.
  toggles: { committed: true, expected: true, speculative: false, financing: true },
});

export const emptyDoc = () => {
  const now = new Date();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    updatedAt: now.toISOString(),
    name: "Untitled",
    startY: now.getFullYear(), startM: now.getMonth(),
    cash: 0,
    lines: [], employees: [], projects: [], milestones: [], pos: [], rounds: [],
    // Subscription products. A new field, so it reaches existing documents through the emptyDoc
    // spread in migrate() without a schema bump — same route `journal` took.
    saas: [],
    history: [],   // measured months of real spend. NOT the demo's — see engine/history.js.
    cashActuals: {}, flagOverrides: {},
    // Projection journal: append-only forecast snapshots. New field, so it arrives on existing
    // documents through the emptyDoc spread in migrate() without a schema bump.
    journal: [],
    codeMap: {},       // { code -> projectId | "overhead" }, built as you code spend
    customerMap: {},   // { customerName -> projectId }, for imports keyed on QuickBooks customer
    categoryMap: {},   // { importedCategoryLabel -> object-class key }, for grant reconciliation
    importProfiles: [], // saved column-mapping profiles for re-importing from the same source
    scenarios: [],      // saved what-if scenarios (overlay patches over this base doc)
    settings: { ...settings(), noticeWeeks: 4 },
  };
};

/** The demo company. Explicitly loaded, never the default — nobody's real data should have to be
 *  deleted around someone else's example. */

// ── demo seeds ────────────────────────────────────────────────────────────────────────────────────

/** One commitment of every flavour and kind, because each behaves differently at closure and a demo
 *  that shows only payments teaches the wrong model. */
const SEED_COMMITMENTS = [
  // A DEBT with a date: goods ordered, invoice to follow. Counts against the clean-exit date.
  { id: "cm_demo_po", label: "Stack tooling — Meridian Grid", flavor: "payment", kind: "debt",
    signedMonth: 0, payMonth: 3, amount: 62000, source: "manual",
    lineId: "l_demo_po", status: "committed", paidRef: null },

  // A PLANNED cost with a date: you would simply not renew if you closed. Shows the badge doing work.
  { id: "cm_demo_pat", label: "Patent renewal — US 11,482,003", flavor: "payment", kind: "planned",
    signedMonth: 0, payMonth: 8, amount: 4200, source: "manual",
    lineId: "l_demo_pat", status: "committed", paidRef: null },

  // A CLOSURE-TRIGGERED payment: no date, and the badge is not offered because it exists BECAUSE you
  // closed. This is the row that makes the clean-exit date mean something.
  { id: "cm_demo_break", label: "Lease break — Fulton St", flavor: "payment", kind: "debt",
    signedMonth: 0, payMonth: null, amount: 38000, source: "manual",
    lineId: null, status: "committed", paidRef: null },

  // RECURRING: overhead that stops when the business does, so it is never a closure debt.
  { id: "cm_demo_lease", label: "Office lease — Fulton St", flavor: "recurring", kind: "planned",
    signedMonth: 0, payMonth: null, amount: 6500, source: "manual",
    lineId: "l_demo_lease", status: "committed", paidRef: null },

  // INDEXED: scales with revenue and creates no line of its own — `indexedLines` builds it at
  // projection time. Deliberately small, so the demo still reads as a going concern.
  { id: "cm_demo_roy", label: "Licence royalty — Ferrous Labs", flavor: "indexed", kind: "debt",
    signedMonth: 0, payMonth: null, amount: 0, index: { of: "revenue", ref: null, pct: 0.02 },
    source: "manual", lineId: null, status: "committed", paidRef: null },
];

/** One subscription product, so the recurring-revenue engine has something to show. */
const SEED_SAAS = [
  { id: "saas_demo", name: "Cellsight monitoring", price: 480, unit: "month",
    customers: 34, growth: 0.06, churn: 0.02, start: 0, confidence: "expected" },
];

/** ⚠️ NO SEEDED SCENARIO. I wrote one with `patch: { employees: { defer: 3 } }` — a shape I invented.
 *  The real one is `patches: []` of `{ kind, collection, item }`, and the Scenarios view crashed with
 *  "Cannot read properties of undefined" on every test that opened it.
 *
 *  Inventing a data shape for a demo is worse than leaving the feature undemonstrated: the demo is the
 *  thing people load first, and it crashed the tab it was meant to show off. Seeding a real scenario
 *  means building one through the same code path a user would, which is a task rather than a literal.
 */
const SEED_SCENARIOS = [];


// The seed's cash, named so the divergence above is about commitments and nothing else.
const SEED_CASH_DEMO = 560000;

/** The original demo, kept and NOT offered to users.
 *
 *  ⚠️ IT IS THE GOLDEN CANARY — a known runway figure at known toggle settings, used as the regression
 *  check through every change in this codebase. **Listing it in the picker would let somebody edit it
 *  into a different sanity check**, which is the one thing it cannot survive.
 *
 *  Tests import this directly. Nothing in the UI reaches it.
 */
export const canaryDoc = () => ({
  ...emptyDoc(),
  // HARDCODED on purpose, and the only name in the app that is. Every other document takes its name
  // from the account's company; a demo has no account, so there is nothing to take one from.
  name: "Demo Company",
  startY: 2026, startM: 6,
  // ⚠️ THE DEMO NOW DIFFERS FROM THE SEED DATA, deliberately, and this is the line where that happens.
  //
  // Two tests assert the demo reproduces the golden runway — a contract keeping the demo and the seed
  // in step. Adding commitments to demonstrate them breaks it: the seed has none, so the demo cannot
  // both carry them and match. Raising cash to compensate would restore the NUMBER while making the
  // two documents different companies, which is worse than an honest divergence.
  //
  // So the demo keeps the seed's cash and reads SHORTER than the golden 5.6. The golden canary still
  // guards the seed, which is what it was for; the demo's own runway is asserted separately.
  cash: SEED_CASH_DEMO,
  // SEED_LINES PLUS THE DEMO'S OWN. The golden canary builds from `SEED_LINES` directly, so anything
  // added there moves the number the whole suite is anchored to — these belong to the demo document
  // and nowhere else.
  //
  // They exist because a commitment OWNS EXACTLY ONE OUTFLOW: without them the tab would show
  // obligations with no cash behind them, which is the one thing the invariant forbids.
  lines: [
    ...SEED_LINES,
    { id: "l_demo_po", label: "Stack tooling — Meridian Grid", cadence: "onetime", kind: "cost",
      amount: 62000, start: 3, confidence: "committed" },
    { id: "l_demo_pat", label: "Patent renewal", cadence: "onetime", kind: "cost",
      amount: 4200, start: 8, confidence: "committed" },
    { id: "l_demo_lease", label: "Office lease — Fulton St", cadence: "recurring", kind: "cost",
      amount: 6500, start: 0, confidence: "committed" },
  ],
  employees: SEED_EMPLOYEES,
  // one project carries recorded spend so the budget-vs-actual tag is visible in the demo
  projects: [...SEED_PROJECTS, ...SEED_FULFIL].map(p =>
    p.name === "Mobile app launch" ? { ...p, actuals: { 0: 34000, 1: 18000 } } : p),
  milestones: SEED_MILESTONES,
  pos: SEED_POS_LINKED,
  rounds: SEED_ROUNDS,
  journal: SEED_JOURNAL,
  history: HIST,
  // codes in the seeded ledger -> the demo's projects (matched by name, since ids are per-load)
  codeMap: (() => {
    const byName = (n) => ([...SEED_PROJECTS, ...SEED_FULFIL].find(p => p.name === n) || {}).id;
    return { "5000": byName("Catalyst scale-up"), "5100": byName("Mobile app launch"), "6000": OVERHEAD, "9000": OVERHEAD };
  })(),
  cashActuals: {
    // Recorded start-of-month cash. A gentle drift ~$3k/month behind plan
    // (model: 560,000 / 470,525 / 349,866 / 225,851 / 119,817) — slightly over budget, not off a cliff.
    // NOTE the field is `revenue`, not `rev`: the History cash tab reads `r.revenue`.
    0: { cash: 560000, revenue: 15000, additional: 0, grants: {} },
    1: { cash: 467000, revenue: 15000, additional: 0, grants: {} },
    2: { cash: 343000, revenue: 16000, additional: 0, grants: {} },
    3: { cash: 216000, revenue: 17000, additional: 0, grants: {} },
    4: { cash: 108000, revenue: 18000, additional: 0, grants: {} },
  },
  // ── EVERY FEATURE, DEMONSTRATED ONCE ──────────────────────────────────────────────────────────
  // A demo whose job is to be read in a minute, so one representative example of each thing rather
  // than a maximal one. Anything that appears twice here is doing two different jobs.
  commitments: SEED_COMMITMENTS,
  // ⚠️ SAAS DELIBERATELY NOT SEEDED.  asserts the demo carries none, and its
  // premise is sound: it isolates the subscription engine by starting from a model without one.
  // Seeding a product here would have meant rewriting that test to accommodate the demo, which is the
  // wrong way round. Recurring revenue stays unexercised in the demo — noted rather than hidden.
  scenarios: SEED_SCENARIOS,
});

/** The demo somebody actually opens.
 *
 *  ⚠️ THE ARCHETYPE SUPPLIES ONLY WHAT DIFFERS. Everything structural — schema version, id, settings,
 *  toggles, code map — comes from `emptyDoc()`, so **a field added to the document later reaches all
 *  four archetypes without editing any of them.** Four hand-written full documents would be four places
 *  to forget.
 *
 *  An unknown id falls back to the first rather than throwing: a bad link should show somebody a demo,
 *  not an error.
 */
/** How many recorded months a demo carries BEFORE today.
 *
 *  ⚠️ A DEMO THAT STARTS TODAY CANNOT DEMONSTRATE THE BAND. Its width has two sources — which revenue
 *  tiers are on, and how far recorded spend has scattered from its own mean. The second is measured
 *  from `history`, and with no history it is 0.000 in every archetype, so the cost half of the band has
 *  never appeared in a demo at all. Two of the four then had no tier spread either, so floor, expected
 *  and ceiling landed on one number and the chart drew its "no range" note instead of a band.
 *
 *  Four is the number because it is what a real ledger looks like at this stage and because it keeps
 *  every archetype's declared `cash` meaning "cash on hand TODAY" rather than at some notional start.
 *
 *  ⚠️ FOUR IS ALSO BELOW `burnVariance`'s TRIMMING THRESHOLD, which is five. With four points nothing is
 *  discarded, so no month in a ledger below may be an outlier — one extreme figure would dominate the
 *  variance instead of being trimmed as the equipment purchase it represents.
 */
const DEMO_BACKFILL = 4;

/** Shift a month index that belongs to a DATED FUTURE EVENT.
 *
 *  ⚠️ NOT EVERYTHING MOVES, AND THAT IS THE WHOLE SUBTLETY. Backdating the start without re-indexing
 *  pulls the entire future four months earlier; re-indexing everything uniformly leaves the four new
 *  months empty, because the rent and the salaries move out of them too.
 *
 *  Month 0 means "already running" — rent, consumables, insurance and the existing staff were being
 *  paid in April as much as in August, so they stay put. A start ABOVE zero is a dated plan — the sixth
 *  hire, a round close, a delivery — and has to move so it lands on the same CALENDAR month it did
 *  before. Ends always move, so a line that covered the horizon still covers it.
 */
const shiftStart = (v) => (v == null || v === 0 ? v : v + DEMO_BACKFILL);
const shiftEnd = (v) => (v == null ? v : v + DEMO_BACKFILL);
const shiftDated = (v) => (v == null ? v : v + DEMO_BACKFILL);
const shiftLines = (ls) => (ls || []).map(l => ({ ...l, start: shiftStart(l.start), end: shiftEnd(l.end) }));

/** A recorded month, split across the codes the ledger view expects. */
const ledgerMonth = (month, total, mix) => ({
  month,
  lines: [
    { code: "6000", amount: Math.round(total * mix[0]), note: "payroll" },
    { code: "5000", amount: Math.round(total * mix[1]), note: "direct costs" },
    { code: "", amount: total - Math.round(total * mix[0]) - Math.round(total * mix[1]), note: "rent, software, insurance" },
  ],
});

export const demoDoc = (which = "grant-startup") => {
  const a = archetypeById(which) || ARCHETYPES[0];
  const built = a.build();

  // Start `DEMO_BACKFILL` months back. Built through a Date so a January load wraps the year correctly
  // rather than producing month -3.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - DEMO_BACKFILL, 1);

  const ledger = built.ledger || [];
  const mix = built.ledgerMix || [0.63, 0.24];
  const spent = ledger.reduce((x, v) => x + v, 0);

  // ⚠️ OPENING CASH IS TODAY'S CASH PLUS EVERYTHING SPENT SINCE. That makes the arithmetic close on
  // itself: walk the opening balance down by the ledger and the month that lands on `built.cash` is
  // TODAY. An archetype still declares the one number a reader checks — what is in the bank now.
  const openingCash = (built.cash || 0) + spent;

  // Month-opening balances for every recorded month AND for today, because on the 21st you do know what
  // you had on the 1st. Anchoring on today's figure is what makes "cash on hand" a recorded fact rather
  // than a projection, and it is what puts the accumulated forecast error on screen.
  const cashActuals = {};
  let bal = openingCash;
  for (let m = 0; m <= ledger.length; m++) {
    cashActuals[m] = { cash: Math.round(bal), revenue: 0, additional: 0, grants: {} };
    bal -= ledger[m] || 0;
  }

  const shifted = ledger.length ? {
    lines: shiftLines(built.lines),
    employees: (built.employees || []).map(e => ({ ...e, start: shiftStart(e.start), end: shiftEnd(e.end) })),
    // ⚠️ `?? 0` ON DELIVERY, BECAUSE AN ABSENT DELIVERY MONTH IS NOT AN ABSENT DATE. `poPaidMonth` reads
    // `(po.deliveryMonth || 0) + poLag(po)`, so an undefined delivery already MEANS month zero — and
    // preserving the undefined through the shift left two hardware POs paying $1,057,000 into the
    // recorded months, against a ledger that says the company only spent. That divergence dragged the
    // anchored forecast down and cut the demo's runway from 19.97 months to 11.77.
    pos: (built.pos || []).map(x => ({ ...x, bookedMonth: shiftDated(x.bookedMonth), deliveryMonth: shiftDated(x.deliveryMonth ?? 0) })),
    // ⚠️ `shiftStart`, NOT `shiftDated`, AND THE DIFFERENCE IS $4M. `compileInstrument` treats a CLOSED
    // round with `closeMonth <= 0` as already banked and emits no draw — that money is in `cash` on
    // hand. Shifting a closed-at-zero round to month 4 made it "closing in the future", so the model
    // paid the Series A into the balance a second time. Recorded cash then overrode the month, the
    // anchor offset absorbed the phantom $4M, and the demo's runway fell from 19.97 to 15.30 months for
    // no reason a reader could see. Month zero means "already true" for rounds exactly as it does for
    // rent.
    rounds: (built.rounds || []).map(r => ({ ...r, closeMonth: shiftStart(r.closeMonth) })),
    commitments: (built.commitments || []).map(c => ({ ...c, signedMonth: shiftStart(c.signedMonth), payMonth: shiftDated(c.payMonth) })),
    projects: (built.projects || []).map(pj => ({
      ...pj,
      startM: shiftStart(pj.startM), endM: shiftEnd(pj.endM),
      lines: pj.lines ? shiftLines(pj.lines) : pj.lines,
      grant: pj.grant ? {
        ...pj.grant,
        periods: (pj.grant.periods || []).map(x => ({ ...x, start: shiftStart(x.start), end: shiftEnd(x.end) })),
        milestones: (pj.grant.milestones || []).map(x => ({ ...x, month: shiftDated(x.month) })),
      } : pj.grant,
    })),
    cash: openingCash,
    history: ledger.map((v, m) => ledgerMonth(m, v, mix)),
    cashActuals,
  } : {};

  // ⚠️ `ledger` AND `ledgerMix` ARE AUTHORING INPUTS, NOT DOCUMENT FIELDS. They exist so an archetype can
  // declare its recorded months in one readable place; once `history` and `cashActuals` are built from
  // them they have no further meaning, and spreading `built` wholesale carried them onto the document
  // and straight through `toJSON`/`fromJSON` into anything a user saved.
  const { ledger: _led, ledgerMix: _mix, ...rest } = built;

  return {
    ...emptyDoc(),
    startY: start.getFullYear(), startM: start.getMonth(),
    // `it` marks the document as a demo for the banner and the save guard.
    it: "demo",
    demoId: a.id,
    ...rest,
    ...shifted,
  };
};

// Every schema change appends a step. Never edit an old one — someone's data went through it.
const MIGRATIONS = {
  // v8 -> v9: saved charts and per-tab defaults.
  //
  // Purely additive and absent by default — a document with neither behaves exactly as before, because
  // `savedFor()` returns an empty list and `defaultChartId()` returns null, which is what the existing
  // `defaultChartFor(tab)` already handles.
  //
  // ⚠️ ONE-DIRECTIONAL. An old client opening a v9 document drops `savedCharts` silently on its next
  // write. Deploy the client before anybody saves a chart.
  9: (d) => ({ ...d, schemaVersion: 9 }),

  // v7 -> v8: the plan gains a THRUST level (the template's "TASK 1" rows).
  //
  // ⚠️ NO THRUST IS INVENTED. A plan with milestones at the top level is valid and renders exactly as
  // it did — the level is optional, and adopting existing milestones into a thrust nobody created would
  // renumber work somebody may already have filed.
  8: (d) => ({ ...d, schemaVersion: 8 }),

  // v6 -> v7: projects gain a PLAN — milestones, go/no-go gates, and the tasks that reach them.
  //
  // Purely additive. Every existing project gets an empty array, and a project with no plan behaves
  // exactly as before: the feature is invisible until somebody uses it.
  7: (d) => ({
    ...d, schemaVersion: 7,
    projects: (d.projects || []).map(p => ({ ...p, plan: p.plan || [] })),
  }),

  // v5 -> v6: commitments gain a FLAVOUR and, for payments, a KIND.
  //
  //   recurring — overhead that stops the moment the business does (a lease's rent)
  //   indexed   — scales with something and stops when that stops (cost share, royalties)
  //   payment   — a discrete debt, due on a date or ON CLOSURE
  //
  // The three differ at exactly one moment — closure — and that is the whole reason to distinguish
  // them. Recurring stops. Indexed stops, leaving whatever it accrued. Payments survive.
  //
  // INFERRED, NOT GUESSED. Everything that exists today has a `payMonth` and is a payment; derived cost
  // share is `source: "grant"` and is indexed. `kind` defaults to "debt" for the same reason the UI
  // does: a closure figure that errs towards comfort is not worth having.
  6: (d) => ({
    ...d, schemaVersion: 6,
    commitments: (d.commitments || []).map(c => ({
      ...c,
      flavor: c.flavor || (c.source === "grant" ? "indexed" : "payment"),
      kind: c.kind || "debt",
    })),
  }),

  // v4 -> v5: COMMITMENTS. A signed obligation is real from the day it is signed and, until now,
  // invisible until the month it is paid — a $200k PO payable in month 20 left runway at 5.6 months and
  // every screen looking identical to not having signed it.
  //
  // PURELY ADDITIVE. Every existing model becomes a model with no commitments, which is the truth about
  // it — there is nothing in an old document from which a commitment could be inferred, and guessing
  // one would be inventing an obligation somebody never entered.
  5: (d) => ({ ...d, schemaVersion: 5, commitments: d.commitments || [] }),

  // v3 -> v4: a round's goals gain a PHASE. A round has goals pointing in both directions and the
  // model was treating them as one list — "5 kW stack at 92%" is evidence needed to CLOSE the round,
  // "scale to 50 kW" is what the round BUYS, and they are measured against two different runways.
  //
  // INFERRED FROM THE DUE DATE, which is right for every goal written before this field existed: a
  // goal due on or before the close was gating it, and one due after it was not. A goal already filed
  // correctly does not move.
  4: (d) => ({
    ...d,
    schemaVersion: 4,
    rounds: (d.rounds || []).map(r => ({
      ...r,
      goals: (r.goals || []).map(g => ({
        ...g,
        phase: g.phase || ((g.dueMonth ?? 0) <= (r.closeMonth ?? 0) ? "pre" : "post"),
      })),
    })),
  }),

  // v1 -> v2: a spend month was a single total { mo, v, note }. It becomes a one-line ledger so the
  // old data keeps working and can be coded later. `v` is preserved as a derived getter in the engine.
  // v2 -> v3: ledger lines gain optional dimensions (kind/category/period). No line data changes —
  // absent kind means cost, so every existing total is identical. Purely additive: ensure the new
  // maps exist. This is what keeps the golden number pinned across the schema bump.
  3: (d) => ({
    ...d,
    schemaVersion: 3,
    customerMap: d.customerMap || {},
    categoryMap: d.categoryMap || {},
  }),

  2: (d) => ({
    ...d,
    schemaVersion: 2,
    codeMap: d.codeMap || {},
    history: (d.history || []).map((m, i) => m.lines
      ? m
      : { month: Number.isFinite(m.month) ? m.month : i,
          lines: [{ code: "", amount: Number(m.v) || 0, note: m.note || "" }] }),
  }),
};

export function migrate(doc) {
  let d = doc;
  while ((d.schemaVersion ?? 0) < SCHEMA_VERSION) {
    const next = (d.schemaVersion ?? 0) + 1;
    const step = MIGRATIONS[next];
    if (!step) throw new Error(`No migration to schema v${next} (document is v${d.schemaVersion ?? 0})`);
    d = step(d);
  }
  if (d.schemaVersion > SCHEMA_VERSION) throw new Error(`Document is v${d.schemaVersion}; this build understands v${SCHEMA_VERSION}. Upgrade the app.`);
  return { ...emptyDoc(), ...d, settings: { ...settings(), ...(d.settings || {}) } };
}

export const toJSON = (doc) => JSON.stringify(doc, null, 2);
export const fromJSON = (text) => migrate(JSON.parse(text));
