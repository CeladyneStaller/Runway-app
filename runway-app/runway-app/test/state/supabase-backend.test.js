// The hosted backend, exercised without a network. What matters here is not that the happy path works
// but that each failure is told apart correctly: "no document yet" must never look like "couldn't
// reach the server", and a conflict must never look like a retryable blip.
import { describe, it, expect, vi } from "vitest";
import { createSupabaseBackend } from "../../src/state/backends/supabase.js";
import {
  BackendError, ERR_CONFLICT, ERR_FORBIDDEN, ERR_STALE_CLIENT, ERR_UNREACHABLE, isRetryable,
} from "../../src/state/backends/errors.js";

const auth = { getAccessToken: async () => "jwt-abc", getCompanyId: async () => "co-1" };
const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const bad = (status, payload) => ({ ok: false, status, json: async () => payload });

const make = (fetchImpl) => createSupabaseBackend({
  url: "https://proj.supabase.co/", anonKey: "anon-key", auth, fetchImpl,
});

describe("reading", () => {
  it("returns null when the company has no document yet — that is not an error", async () => {
    const b = make(async () => ok([]));
    expect(await b.read()).toBeNull();
  });

  it("returns the document and remembers the version", async () => {
    const b = make(async () => ok([{ body: { cash: 42 }, schema_version: 3, version: 7 }]));
    const r = await b.read();
    expect(r.raw).toEqual({ cash: 42 });
    expect(r.meta.version).toBe(7);
    expect(b._version()).toBe(7);
  });

  it("sends the anon key and the user's token, scoped to the company", async () => {
    let seen;
    const b = make(async (u, i) => { seen = { u, i }; return ok([]); });
    await b.read();
    expect(seen.u).toContain("/rest/v1/documents");
    expect(seen.u).toContain("company_id=eq.co-1");
    expect(seen.i.headers.apikey).toBe("anon-key");
    expect(seen.i.headers.Authorization).toBe("Bearer jwt-abc");
  });

  it("a network failure is UNREACHABLE, never an empty document", async () => {
    const b = make(async () => { throw new TypeError("Failed to fetch"); });
    await expect(b.read()).rejects.toMatchObject({ kind: ERR_UNREACHABLE });
  });
});

describe("writing", () => {
  it("goes through the RPC carrying the version it loaded", async () => {
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("/documents")) return ok([{ body: {}, schema_version: 3, version: 4 }]);
      sent = JSON.parse(i.body);
      return ok([{ out_version: 5, out_updated_at: "2026-07-23T00:00:00Z" }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3, cash: 1 });
    expect(sent.p_company_id).toBe("co-1");
    expect(sent.p_schema_version).toBe(3);
    expect(sent.p_base_version).toBe(4);       // the precondition — this is what stops a blind write
    expect(b._version()).toBe(5);              // and it advances
  });

  it("a first write for a new company carries a null base version", async () => {
    let sent;
    const b = make(async (u, i) => {
      if (u.includes("/documents")) return ok([]);
      sent = JSON.parse(i.body);
      return ok([{ out_version: 1 }]);
    });
    await b.read();
    await b.write({ schemaVersion: 3 });
    expect(sent.p_base_version).toBeNull();
  });

  it("P0002 is a CONFLICT, and conflicts are not retryable", async () => {
    const b = make(async () => bad(400, { code: "P0002", message: "conflict" }));
    const e = await b.write({ schemaVersion: 3 }).catch(x => x);
    expect(e).toBeInstanceOf(BackendError);
    expect(e.kind).toBe(ERR_CONFLICT);
    expect(isRetryable(e)).toBe(false);        // retrying would overwrite the other device's work
  });

  it("P0001 is a STALE_CLIENT, and is not retryable", async () => {
    const b = make(async () => bad(400, { code: "P0001", message: "stale_client" }));
    const e = await b.write({ schemaVersion: 2 }).catch(x => x);
    expect(e.kind).toBe(ERR_STALE_CLIENT);
    expect(isRetryable(e)).toBe(false);
  });

  it("401/403 is FORBIDDEN, and is not retryable", async () => {
    for (const status of [401, 403]) {
      const b = make(async () => bad(status, { message: "no" }));
      const e = await b.write({ schemaVersion: 3 }).catch(x => x);
      expect(e.kind).toBe(ERR_FORBIDDEN);
      expect(isRetryable(e)).toBe(false);
    }
  });

  it("a dropped connection IS retryable — that one is just a blip", async () => {
    const b = make(async () => { throw new TypeError("Failed to fetch"); });
    const e = await b.write({ schemaVersion: 3 }).catch(x => x);
    expect(e.kind).toBe(ERR_UNREACHABLE);
    expect(isRetryable(e)).toBe(true);
  });
});

describe("configuration", () => {
  it("refuses to construct without a url and key, rather than silently doing nothing", () => {
    expect(() => createSupabaseBackend({ auth })).toThrow();
    expect(() => createSupabaseBackend({ url: "https://x", auth })).toThrow();
  });

  it("tolerates a trailing slash on the url", async () => {
    let seen;
    const b = make(async (u) => { seen = u; return ok([]); });
    await b.read();
    expect(seen).not.toContain("//rest");
  });
});

describe("syncConfigured", () => {
  it("is opt-in: all three of flag, url and key, or it stays local", async () => {
    const { syncConfigured } = await import("../../src/state/storage.js");
    expect(syncConfigured({})).toBe(false);
    expect(syncConfigured({ VITE_SUPABASE_URL: "u", VITE_SUPABASE_ANON_KEY: "k" })).toBe(false);
    expect(syncConfigured({ VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "u" })).toBe(false);
    expect(syncConfigured({ VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "u", VITE_SUPABASE_ANON_KEY: "k" })).toBe(true);
  });
});
