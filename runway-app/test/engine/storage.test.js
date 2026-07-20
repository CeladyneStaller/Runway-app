// storage.js is the multi-user seam and had no coverage — because jsdom has no IndexedDB, so nothing
// could exercise it. fake-indexeddb fixes that, which turns two lines of test noise into a real test.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { clear, get, keys, set } from "idb-keyval";
import { load, save } from "../../src/state/storage";
import { emptyDoc, demoDoc, SCHEMA_VERSION } from "../../src/state/document";

beforeEach(() => clear());

describe("storage", () => {
  it("a first run has nothing stored and gets an empty document", async () => {
    const d = await load();
    expect(d.employees).toHaveLength(0);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("round-trips a real model", async () => {
    const doc = demoDoc();
    await save(doc);
    const back = await load();
    expect(back.cash).toBe(560000);
    expect(back.employees).toHaveLength(doc.employees.length);
    expect(back.rounds).toHaveLength(doc.rounds.length);
    expect(back.history).toHaveLength(doc.history.length);
  });

  it("stamps updatedAt on every save", async () => {
    const before = new Date().toISOString();
    await save(emptyDoc());
    expect((await load()).updatedAt >= before).toBe(true);
  });

  it("never destroys a document it cannot read", async () => {
    // The nightmare: a document from a future build, or one corrupted by a bad migration. Falling back
    // to empty is fine. Losing the original is not — that's someone's financial model.
    // We assert the warning fires (it's part of the contract, and it keeps the expected log off the
    // test console instead of looking like a failure).
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await set("runway:doc", { schemaVersion: 99, cash: 1234567, employees: [{ id: "x" }] });
    const d = await load();
    expect(d.cash).toBe(0);                                     // we fall back...
    expect(spy, "recovery must warn, not fail silently").toHaveBeenCalled();
    const parked = (await keys()).find(k => String(k).includes("unreadable"));
    expect(parked, "an unreadable document must be parked, not dropped").toBeTruthy();
    expect((await get(parked)).cash).toBe(1234567);             // ...and the original survives
    spy.mockRestore();
  });
});
