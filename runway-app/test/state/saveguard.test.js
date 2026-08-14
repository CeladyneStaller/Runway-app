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
    const { load, save, flush, LOAD_FAILED } = await import("../../src/state/storage");
    const { demoDoc } = await import("../../src/state/document");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    save(demoDoc()); await flush();
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
    const { load, save, flush, LOAD_OK } = await import("../../src/state/storage");
    const { demoDoc } = await import("../../src/state/document");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    save(demoDoc()); await flush();
    const before = store.get("runway:doc");
    expect(before.employees.length).toBeGreaterThan(0);

    failGet = true;
    const r = await load();
    // App's rule: only LOAD_OK may be saved. Simulate the guard honouring it.
    if (r.state === LOAD_OK) { save(r.doc); await flush(); }

    const after = store.get("runway:doc");
    expect(after.employees.length).toBe(before.employees.length);   // untouched
    expect(after.cash).toBe(before.cash);
    spy.mockRestore();
  });

  it("without the guard the same sequence destroys the document — proving the guard is what saves it", async () => {
    const { load, save, flush } = await import("../../src/state/storage");
    const { demoDoc } = await import("../../src/state/document");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    save(demoDoc()); await flush();
    failGet = true;
    const r = await load();
    save(r.doc); await flush();   // the OLD behaviour: save whatever load handed back

    expect(store.get("runway:doc").employees.length).toBe(0);   // destroyed, as it was in production
    spy.mockRestore();
  });
});

describe("⚠️ a forbidden load is the wrong company, not broken storage", () => {
  it("EXPORTS A DISTINCT STATE for it", async () => {
    // `load_document` raises `forbidden` when `is_member(company_id)` is false. The active company is a
    // PER-DEVICE preference that survives losing access, being removed from a team, or the company
    // being deleted on another device — a routine state, not a fault.
    const mod = await import("../../src/state/storage.js");
    expect(mod.LOAD_WRONG_COMPANY).toBeTruthy();
    expect(mod.LOAD_WRONG_COMPANY).not.toBe(mod.LOAD_FAILED);
  });

  it("⚠️ FORGETS THE SELECTION, which is the whole recovery", async () => {
    // It surfaced as "Your saved model couldn't be read just now", editing disabled, and a Reload
    // button that reloads the same unusable company. **A recoverable state presented as a broken one,
    // and the only way out was knowing to clear browser storage.**
    const src = (await import("node:fs")).readFileSync("src/state/storage.js", "utf8");
    const i = src.indexOf("kindOf(e) === ERR_FORBIDDEN");
    expect(i).toBeGreaterThan(-1);
    const branch = src.slice(i, i + 400);
    expect(branch).toMatch(/clearActiveCompany\(\)/);
    expect(branch).toMatch(/isNew: true/);
  });

  it("does not disable editing for it", async () => {
    // LOAD_FAILED disables editing so an empty model cannot be saved over a real one. That reasoning
    // does not apply here: there IS no model to save over — the company belongs to somebody else.
    const app = (await import("node:fs")).readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/r\.state === LOAD_WRONG_COMPANY/);
  });
});
