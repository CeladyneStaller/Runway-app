// The unit of persistence AND the unit of ownership. One document = one company's model.
// Today: a single document in IndexedDB. Later: the same object, one row per owner, no shape change.
// The engine never sees this — it takes plain arrays. That seam is what keeps multi-user cheap.
import { SEED_LINES, SEED_EMPLOYEES, SEED_PROJECTS, SEED_ROUNDS, SEED_POS_LINKED, SEED_FULFIL, SEED_MILESTONES, HIST, SEED_JOURNAL } from "../seed";
import { OVERHEAD } from "../engine/coding";

export const SCHEMA_VERSION = 3;

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
  toggles: { committed: true, expected: true, speculative: false, financing: false },
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
    settings: settings(),
  };
};

/** The demo company. Explicitly loaded, never the default — nobody's real data should have to be
 *  deleted around someone else's example. */
export const demoDoc = () => ({
  ...emptyDoc(),
  // HARDCODED on purpose, and the only name in the app that is. Every other document takes its name
  // from the account's company; a demo has no account, so there is nothing to take one from.
  name: "Demo Company",
  startY: 2026, startM: 6,
  cash: 560000,
  lines: SEED_LINES,
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
});

// Every schema change appends a step. Never edit an old one — someone's data went through it.
const MIGRATIONS = {
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
