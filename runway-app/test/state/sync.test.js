// Turning hosted sync on, and — more importantly — what happens when it is only half turned on.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, keys: async () => [], clear: async () => {} }));

let S, sync;
beforeEach(async () => {
  vi.resetModules();
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  S._resetWriteState();
});

const full = { VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_ANON_KEY: "anon" };
const getSession = async () => ({ access_token: "jwt" });

describe("enableHostedSync", () => {
  it("switches to the hosted backend when fully configured", () => {
    const r = sync.enableHostedSync({ getSession, env: full, fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) });
    expect(r.enabled).toBe(true);
    expect(S.backendName()).toBe("supabase");
  });

  it("stays LOCAL when the flag is off, and says why", () => {
    const r = sync.enableHostedSync({ getSession, env: { ...full, VITE_SYNC_ENABLED: "false" } });
    expect(r.enabled).toBe(false);
    expect(S.backendName()).toBe("local");
  });

  it("stays LOCAL when the key is missing — half-configured must never stand in for working", () => {
    const r = sync.enableHostedSync({ getSession, env: { ...full, VITE_SUPABASE_ANON_KEY: "" } });
    expect(r.enabled).toBe(false);
    expect(S.backendName()).toBe("local");
  });

  it("stays LOCAL when no getSession is supplied, rather than failing on the first write", () => {
    const r = sync.enableHostedSync({ env: full });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/getSession/);
    expect(S.backendName()).toBe("local");
  });

  it("with nothing configured at all, the app is simply local", () => {
    const r = sync.enableHostedSync({ env: {} });
    expect(r.enabled).toBe(false);
    expect(S.backendName()).toBe("local");
  });
});

describe("the diagnostic names what is missing", () => {
  it("distinguishes an unset flag from a wrong one, and warns about build-time inlining", async () => {
    const { syncConfigReport } = await import("../../src/state/storage.js");
    const unset = syncConfigReport({ VITE_SUPABASE_URL: "u", VITE_SUPABASE_ANON_KEY: "k" });
    expect(unset.ok).toBe(false);
    expect(unset.missing.join(" ")).toMatch(/BUILD time/);        // the trap you cannot see from outside

    const wrong = syncConfigReport({ VITE_SYNC_ENABLED: "false", VITE_SUPABASE_URL: "u", VITE_SUPABASE_ANON_KEY: "k" });
    expect(wrong.missing.join(" ")).toMatch(/got "false"/);       // says what it actually got
  });

  it("names each empty value separately, not one vague failure", async () => {
    const { syncConfigReport } = await import("../../src/state/storage.js");
    const r = syncConfigReport({ VITE_SYNC_ENABLED: "true" });
    expect(r.missing).toHaveLength(2);
    expect(r.missing.join(" ")).toMatch(/VITE_SUPABASE_URL/);
    expect(r.missing.join(" ")).toMatch(/VITE_SUPABASE_ANON_KEY/);
  });

  it("reports ok when all three are present", async () => {
    const { syncConfigReport } = await import("../../src/state/storage.js");
    expect(syncConfigReport(full).ok).toBe(true);
    expect(syncConfigReport(full).missing).toEqual([]);
  });
});
