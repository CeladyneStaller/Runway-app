// WHICH FAILURES MAY BE RETRIED. This is the difference between resilience and data loss:
// retrying a dropped connection is right; retrying a conflict overwrites whatever the other device
// wrote, and retrying a stale-client push writes a document this build no longer fully understands.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendError, ERR_CONFLICT, ERR_FORBIDDEN, ERR_STALE_CLIENT, ERR_UNREACHABLE } from "../../src/state/backends/errors.js";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, keys: async () => [], clear: async () => {} }));

let S;
let writes;
let failWith;

const fakeBackend = () => ({
  name: "fake",
  async read() { return null; },
  async write() {
    writes += 1;
    if (failWith) throw new BackendError(failWith, failWith);
    return { meta: {} };
  },
  async park() {},
});

beforeEach(async () => {
  vi.resetModules();
  S = await import("../../src/state/storage.js");
  S._resetWriteState();
  writes = 0; failWith = null;
  S.setBackend(fakeBackend());
});
afterEach(() => S._resetWriteState());

const doc = () => ({ schemaVersion: 3, cash: 1, employees: [] });

describe("retry policy", () => {
  it("a conflict stops and asks — it does not retry over the other device's work", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    failWith = ERR_CONFLICT;
    S.save(doc());
    await S.flush();
    expect(S.status().state).toBe("conflict");
    expect(S.hasUnsavedWork()).toBe(true);          // the user's work is still held
    const after = writes;
    await new Promise(r => setTimeout(r, 900));     // well past the first retry delay
    expect(writes).toBe(after);                     // and nothing was retried
    spy.mockRestore();
  });

  it("a stale client stops — it must reload, not write", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    failWith = ERR_STALE_CLIENT;
    S.save(doc());
    await S.flush();
    expect(S.status().state).toBe("stale");
    const after = writes;
    await new Promise(r => setTimeout(r, 900));
    expect(writes).toBe(after);
    spy.mockRestore();
  });

  it("forbidden stops, and still does not discard the document", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    failWith = ERR_FORBIDDEN;
    S.save(doc());
    await S.flush();
    expect(S.status().state).toBe("error");
    expect(S.hasUnsavedWork()).toBe(true);
    spy.mockRestore();
  });

  it("an unreachable server IS retried, and recovers when it comes back", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    failWith = ERR_UNREACHABLE;
    S.save(doc());
    await S.flush();
    expect(S.status().state).toBe("error");
    expect(S.hasUnsavedWork()).toBe(true);
    failWith = null;                                 // the network comes back
    await S.flush();
    expect(S.status().state).toBe("saved");
    expect(S.hasUnsavedWork()).toBe(false);
    spy.mockRestore();
  });

  it("the backend is swappable, and swapping does not carry over what the last one had written", async () => {
    S.save(doc());
    await S.flush();
    expect(S.status().state).toBe("saved");
    S.setBackend(fakeBackend());                     // a different store may hold something different
    S.save(doc());                                   // same document...
    expect(S.status().state).toBe("unsaved");        // ...must still be written to the new backend
    await S.flush();
    expect(writes).toBe(2);
  });
});

describe("resolving a halt", () => {
  it("editing during a halt keeps the newest work but does not sneak a retry through", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    failWith = ERR_CONFLICT;
    S.save(doc());
    await S.flush();
    const after = writes;
    S.save({ ...doc(), cash: 999 });          // user keeps typing while the question is open
    await new Promise(r => setTimeout(r, 700));
    expect(writes).toBe(after);               // still no write
    expect(S.isHalted()).toBe(true);
    spy.mockRestore();
  });

  it("resuming writes the newest version, not the one that failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let lastWritten = null;
    S.setBackend({
      name: "fake", async read() { return null; }, async park() {},
      async write(d) { writes += 1; if (failWith) throw new BackendError(failWith, failWith); lastWritten = d; return { meta: {} }; },
    });
    failWith = ERR_CONFLICT;
    S.save(doc());
    await S.flush();
    S.save({ ...doc(), cash: 4242 });
    failWith = null;                          // the user picked "keep mine"
    S.resumeAfterHalt();
    await S.flush();
    expect(lastWritten.cash).toBe(4242);
    expect(S.status().state).toBe("saved");
    spy.mockRestore();
  });
});
