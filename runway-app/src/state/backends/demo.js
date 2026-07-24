// Demo backend: a fully working model that goes nowhere.
//
// For showing the app to someone who has not signed up. Every edit behaves normally — the projection
// moves, the journal records, scenarios run — and none of it reaches the database or survives the tab
// being closed.
//
// WHY sessionStorage AND NOT IndexedDB, which the rest of the app uses: a demo written to IndexedDB
// would look exactly like a real locally-built model, and the adoption flow would later offer to upload
// a fictional company into somebody's real account. Keeping demo data in a store the app never reads
// for real documents makes that collision impossible rather than merely unlikely.
//
// Falls back to memory when sessionStorage is unavailable (private modes, embedded webviews). A demo
// that resets on refresh is a nuisance; a demo that refuses to open is a lost customer.

const KEY = "runway:demo";

const session = () => {
  try {
    const s = globalThis.sessionStorage;
    // Availability is not the same as writability — Safari's private mode throws on setItem.
    s.setItem(`${KEY}:probe`, "1");
    s.removeItem(`${KEY}:probe`);
    return s;
  } catch { return null; }
};

export function createDemoBackend(seed) {
  const store = session();
  let memory = null;

  const read = () => {
    if (store) {
      const raw = store.getItem(KEY);
      if (raw) { try { return JSON.parse(raw); } catch { /* corrupt; fall through to the seed */ } }
      return null;
    }
    return memory;
  };

  const write = (doc) => {
    if (store) { try { store.setItem(KEY, JSON.stringify(doc)); return; } catch { /* quota */ } }
    memory = doc;
  };

  // Seed on construction so the demo opens with a company in it rather than an empty shell.
  if (seed && !read()) write(seed);

  return {
    name: "demo",
    async read() {
      const doc = read();
      return doc ? { raw: doc, meta: {} } : null;
    },
    async write(raw) {
      write(raw);
      return { meta: {} };
    },
    async park() {},
  };
}

/** Wipe the demo. Called when leaving demo mode, so the next visitor starts from the same place. */
export function clearDemo() {
  try { globalThis.sessionStorage?.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Is there a demo in progress in this tab? Used to restore it across a refresh. */
export function demoInProgress() {
  try { return !!globalThis.sessionStorage?.getItem(KEY); } catch { return false; }
}
