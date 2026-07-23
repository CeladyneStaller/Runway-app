// NEVER SAVE A DOCUMENT THAT DID NOT COME FROM A SUCCESSFUL LOAD.
//
// This was a live data-loss bug, not a hypothetical one: a transient IndexedDB read failure made load()
// hand back an empty document, and the debounced save wrote it straight over the real one 400ms later.
// A network makes that failure routine (offline start, 500, expired session), so the guard is a
// prerequisite for the hosted build — and a fix worth having regardless.
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map();
let failGet = false;

vi.mock("idb-keyval", () => ({
  get: async (k) => { if (failGet) throw new Error("IndexedDB unavailable"); return store.get(k); },
  set: async (k, v) => { store.set(k, v); },
  keys: async () => [...store.keys()],
  clear: async () => store.clear(),
}));

describe("the save guard", () => {
  beforeEach(() => { store.clear(); failGet = false; vi.resetModules(); });

  it("a failed read is reported as failed, not as an empty document", async () => {
    const { load, save, LOAD_FAILED } = await import("../../src/state/storage");
    const { demoDoc } = await import("../../src/state/document");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await save(demoDoc());
    failGet = true;
    const r = await load();

    expect(r.state).toBe(LOAD_FAILED);   // the caller can now tell the difference
    spy.mockRestore();
  });

  it("a genuinely new document is reported as OK, so a first-time user CAN save", async () => {
    const { load, LOAD_OK } = await import("../../src/state/storage");
    const r = await load();
    expect(r.state).toBe(LOAD_OK);
    expect(r.isNew).toBe(true);
  });

  it("the real document survives a read failure — nothing is written over it", async () => {
    const { load, save, LOAD_OK } = await import("../../src/state/storage");
    const { demoDoc } = await import("../../src/state/document");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await save(demoDoc());
    const before = store.get("runway:doc");
    expect(before.employees.length).toBeGreaterThan(0);

    failGet = true;
    const r = await load();
    // App's rule: only LOAD_OK may be saved. Simulate the guard honouring it.
    if (r.state === LOAD_OK) await save(r.doc);

    const after = store.get("runway:doc");
    expect(after.employees.length).toBe(before.employees.length);   // untouched
    expect(after.cash).toBe(before.cash);
    spy.mockRestore();
  });

  it("without the guard the same sequence destroys the document — proving the guard is what saves it", async () => {
    const { load, save } = await import("../../src/state/storage");
    const { demoDoc } = await import("../../src/state/document");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await save(demoDoc());
    failGet = true;
    const r = await load();
    await save(r.doc);            // the OLD behaviour: save whatever load handed back

    expect(store.get("runway:doc").employees.length).toBe(0);   // destroyed, as it was in production
    spy.mockRestore();
  });
});
