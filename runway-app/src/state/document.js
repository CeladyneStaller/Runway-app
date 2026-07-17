// The unit of persistence AND the unit of ownership. One document = one company's model.
// Today: a single document in IndexedDB. Later: the same object, one row per owner, no shape change.
// The engine never sees this — it takes plain arrays. That seam is what keeps multi-user cheap.
import { SEED_LINES, SEED_EMPLOYEES, SEED_PROJECTS, SEED_ROUNDS, SEED_POS_LINKED, SEED_FULFIL, SEED_MILESTONES, HIST } from "../seed";

export const SCHEMA_VERSION = 1;

const settings = () => ({
  fringePct: 0.30,
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
    history: [],   // measured months of real spend. NOT the demo's — see engine/history.js.
    cashActuals: {}, flagOverrides: {},
    settings: settings(),
  };
};

/** The demo company. Explicitly loaded, never the default — nobody's real data should have to be
 *  deleted around someone else's example. */
export const demoDoc = () => ({
  ...emptyDoc(),
  name: "Demo company",
  startY: 2026, startM: 6,
  cash: 560000,
  lines: SEED_LINES,
  employees: SEED_EMPLOYEES,
  projects: [...SEED_PROJECTS, ...SEED_FULFIL],
  milestones: SEED_MILESTONES,
  pos: SEED_POS_LINKED,
  rounds: SEED_ROUNDS,
  history: HIST,
  cashActuals: { 0: { cash: 560000, rev: 15000 }, 1: { cash: 467000 }, 2: { cash: 343000 },
                 3: { cash: 216000 }, 4: { cash: 108000 } },
});

// Every schema change appends a step. Never edit an old one — someone's data went through it.
const MIGRATIONS = {
  // 2: (d) => ({ ...d, instruments: d.rounds ?? [], rounds: undefined, schemaVersion: 2 }),
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
