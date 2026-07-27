// The write cadence lives in storage.js, not the caller. These pin the behaviours that stop mattering
// locally and start mattering the moment a write crosses a network: don't push no-ops, don't stack
// concurrent writes, and never drop the pending document when a write fails.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const store = new Map();
let failWrites = 0;
let writes = 0;
let inFlightPeak = 0;
let concurrent = 0;

vi.mock("idb-keyval", () => ({
  get: async (k) => store.get(k),
  set: async (k, v) => {
    concurrent += 1; inFlightPeak = Math.max(inFlightPeak, concurrent);
    await new Promise(r => setTimeout(r, 5));
    try {
      if (failWrites > 0) { failWrites -= 1; throw new Error("write failed"); }
      writes += 1; store.set(k, v);
    } finally { concurrent -= 1; }
  },
  keys: async () => [...store.keys()],
  clear: async () => store.clear(),
}));

let S;
beforeEach(async () => {
  store.clear(); failWrites = 0; writes = 0; inFlightPeak = 0; concurrent = 0;
  vi.resetModules();
  S = await import("../../src/state/storage");
  S._resetWriteState();
});
afterEach(() => S._resetWriteState());

describe("write cadence", () => {
  it("save() schedules; it does not write synchronously", async () => {
    const { demoDoc } = await import("../../src/state/document");
    S.save(demoDoc());
    expect(writes).toBe(0);
    expect(S.status().state).toBe("unsaved");
    await S.flush();
    expect(writes).toBe(1);
    expect(S.status().state).toBe("saved");
  });

  it("a burst of edits produces ONE write, not one per edit", async () => {
    const { demoDoc } = await import("../../src/state/document");
    const d = demoDoc();
    for (let i = 0; i < 25; i++) S.save({ ...d, cash: 100000 + i });
    await S.flush();
    expect(writes).toBe(1);
    expect(store.get("runway:doc").cash).toBe(100024);   // and it's the LATEST edit that lands
  });

  it("re-saving an unchanged document writes nothing", async () => {
    const { demoDoc } = await import("../../src/state/document");
    const d = demoDoc();
    S.save(d); await S.flush();
    expect(writes).toBe(1);
    S.save(d); await S.flush();
    expect(writes).toBe(1);                              // no second write
    expect(S.status().state).toBe("saved");
  });

  it("never runs two writes at once", async () => {
    const { demoDoc } = await import("../../src/state/document");
    const d = demoDoc();
    S.save({ ...d, cash: 1 });
    const a = S.flush();
    S.save({ ...d, cash: 2 });
    const b = S.flush();
    await Promise.all([a, b]);
    expect(inFlightPeak).toBe(1);
  });

  it("a failed write keeps the document pending and reports the error", async () => {
    const { demoDoc } = await import("../../src/state/document");
    failWrites = 1;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    S.save(demoDoc());
    await S.flush();
    expect(S.status().state).toBe("error");
    expect(S.hasUnsavedWork()).toBe(true);               // NOT discarded
    spy.mockRestore();
  });

  it("recovers on the next flush after a failure, losing nothing", async () => {
    const { demoDoc } = await import("../../src/state/document");
    failWrites = 1;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    S.save({ ...demoDoc(), cash: 777 });
    await S.flush();
    expect(writes).toBe(0);
    await S.flush();                                     // retry
    expect(writes).toBe(1);
    expect(store.get("runway:doc").cash).toBe(777);
    expect(S.status().state).toBe("saved");
    spy.mockRestore();
  });

  it("an edit arriving mid-write is not lost", async () => {
    const { demoDoc } = await import("../../src/state/document");
    const d = demoDoc();
    S.save({ ...d, cash: 10 });
    const first = S.flush();
    S.save({ ...d, cash: 20 });        // lands while the first write is in flight
    await first;
    expect(S.hasUnsavedWork()).toBe(true);
    await S.flush();
    expect(store.get("runway:doc").cash).toBe(20);
  });

  it("subscribers see the state transitions", async () => {
    const { demoDoc } = await import("../../src/state/document");
    const seen = [];
    const off = S.subscribe(s => seen.push(s.state));
    S.save(demoDoc());
    await S.flush();
    off();
    expect(seen).toContain("unsaved");
    expect(seen).toContain("saving");
    expect(seen[seen.length - 1]).toBe("saved");
  });
});
