// The auth adapter, without a network or an SDK. The cases that matter are the failure ones: a missing
// session must not be retried in a loop, and a brand-new account must end up with somewhere to put a
// document rather than a confusing empty state.
import { describe, it, expect, vi } from "vitest";
import { createSupabaseAuth } from "../../src/state/auth.js";
import { ERR_FORBIDDEN, ERR_UNREACHABLE, isRetryable } from "../../src/state/backends/errors.js";

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const bad = (status, payload) => ({ ok: false, status, json: async () => payload });
const session = { access_token: "jwt-xyz" };

const make = (fetchImpl, getSession = async () => session, extra = {}) =>
  createSupabaseAuth({ url: "https://proj.supabase.co/", anonKey: "anon", getSession, fetchImpl, ...extra });

describe("access token", () => {
  it("comes from the injected session getter on every call, so refreshes are picked up", async () => {
    let token = "first";
    const a = make(async () => ok([]), async () => ({ access_token: token }));
    expect(await a.getAccessToken()).toBe("first");
    token = "rotated";
    expect(await a.getAccessToken()).toBe("rotated");   // not cached — a rotated token must reach the backend
  });

  it("no session is FORBIDDEN, not a retryable blip", async () => {
    const a = make(async () => ok([]), async () => null);
    const e = await a.getAccessToken().catch(x => x);
    expect(e.kind).toBe(ERR_FORBIDDEN);
    expect(isRetryable(e)).toBe(false);                 // retrying a signed-out user forever helps nobody
  });

  it("a session lookup that throws is UNREACHABLE, and IS retryable", async () => {
    const a = make(async () => ok([]), async () => { throw new Error("network"); });
    const e = await a.getAccessToken().catch(x => x);
    expect(e.kind).toBe(ERR_UNREACHABLE);
    expect(isRetryable(e)).toBe(true);
  });
});

describe("company id", () => {
  it("comes from the caller's own membership, and is cached", async () => {
    let calls = 0;
    const a = make(async () => { calls += 1; return ok([{ company_id: "co-7" }]); });
    expect(await a.getCompanyId()).toBe("co-7");
    expect(await a.getCompanyId()).toBe("co-7");
    expect(calls).toBe(1);
  });

  it("resolves deterministically when a user belongs to several companies", async () => {
    let seen;
    const a = make(async (u) => { seen = u; return ok([{ company_id: "co-a" }]); });
    await a.getCompanyId();
    expect(seen).toContain("order=created_at.asc");     // same company every load, not planner roulette
    expect(seen).toContain("limit=1");
  });

  it("bootstraps a company for a brand-new account rather than showing an empty state", async () => {
    const urls = [];
    const a = make(async (u, i) => {
      urls.push(u);
      if (u.includes("/memberships")) return ok([]);        // no membership yet
      if (u.includes("bootstrap_company")) return ok("co-new");
      return ok(null);
    });
    expect(await a.getCompanyId()).toBe("co-new");
    expect(urls.some(u => u.includes("bootstrap_company"))).toBe(true);
  });

  it("passes the anon key and the user's token", async () => {
    let init;
    const a = make(async (u, i) => { init = i; return ok([{ company_id: "co-1" }]); });
    await a.getCompanyId();
    expect(init.headers.apikey).toBe("anon");
    expect(init.headers.Authorization).toBe("Bearer jwt-xyz");
  });

  it("a 403 is FORBIDDEN, not a missing company", async () => {
    const a = make(async () => bad(403, { message: "denied" }));
    const e = await a.getCompanyId().catch(x => x);
    expect(e.kind).toBe(ERR_FORBIDDEN);
  });

  it("reset() forgets the company, so the next user does not inherit the last one's document", async () => {
    let n = 0;
    const a = make(async () => ok([{ company_id: `co-${++n}` }]));
    expect(await a.getCompanyId()).toBe("co-1");
    a.reset();
    expect(await a.getCompanyId()).toBe("co-2");
  });

  it("an explicit companyId overrides discovery entirely", async () => {
    const a = make(async () => { throw new Error("should not be called"); }, async () => session, { companyId: "co-fixed" });
    expect(await a.getCompanyId()).toBe("co-fixed");
  });
});

describe("construction", () => {
  it("refuses to build half-configured rather than failing later", () => {
    expect(() => createSupabaseAuth({ anonKey: "k", getSession: async () => session })).toThrow();
    expect(() => createSupabaseAuth({ url: "u", anonKey: "k" })).toThrow();
  });
});
