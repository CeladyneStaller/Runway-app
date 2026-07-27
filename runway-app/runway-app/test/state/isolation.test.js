// The isolation checks are the thing that proves tenant separation, so they get tested themselves —
// a check that cannot fail is not a check. Driven with a fake API that behaves correctly, then with
// ones that leak, to confirm each assertion actually catches its own failure.
import { describe, it, expect } from "vitest";
import { makeClient, runIsolationChecks } from "../../scripts/isolation-checks.mjs";

const A = { email: "a@x.com", password: "pw" };
const B = { email: "b@x.com", password: "pw" };

// A stand-in Supabase that enforces isolation properly.
function fakeApi({ leakCrossRead = false, leakUnfiltered = false, allowCrossWrite = false,
                   exposeMemberships = false, leakAnon = false } = {}) {
  const docs = { "co-a": { marker: "A" }, "co-b": { marker: "B-ONLY-SECRET" } };
  const tokenToCo = { "tok-a@x.com": "co-a", "tok-b@x.com": "co-b" };

  return async (url, init = {}) => {
    const auth = init.headers?.Authorization;
    const token = auth ? auth.replace("Bearer ", "") : null;
    const me = token ? tokenToCo[token] : null;
    const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

    if (url.includes("/auth/v1/token")) {
      const { email } = JSON.parse(init.body);
      return ok({ access_token: `tok-${email}` });
    }
    if (url.includes("rpc/current_company")) return ok(me);
    if (url.includes("rpc/save_document")) {
      const args = JSON.parse(init.body);
      if (args.p_company_id !== me && !allowCrossWrite) return ok({ message: "forbidden" }, 403);
      docs[args.p_company_id] = args.p_body;
      return ok([{ out_version: 1 }]);
    }
    if (url.includes("/memberships")) {
      return exposeMemberships ? ok([{ company_id: me }]) : ok({ message: "permission denied for table memberships" }, 403);
    }
    if (url.includes("/document_versions")) return ok([]);
    if (url.includes("/documents")) {
      if (!me) return leakAnon ? ok([{ body: docs["co-a"] }]) : ok([], 200);
      const m = url.match(/company_id=eq\.([\w-]+)/);
      if (m) {
        const asked = m[1];
        if (asked !== me && !leakCrossRead) return ok([]);
        return ok([{ body: docs[asked] }]);
      }
      // unfiltered
      return ok(leakUnfiltered
        ? Object.keys(docs).map(c => ({ company_id: c, body: docs[c] }))
        : [{ company_id: me, body: docs[me] }]);
    }
    return ok(null, 404);
  };
}

const run = (opts) => runIsolationChecks({
  client: makeClient({ url: "https://p.supabase.co", anonKey: "anon", fetchImpl: fakeApi(opts) }),
  a: A, b: B,
});

describe("a correctly isolated project", () => {
  it("passes every check", async () => {
    const { pass, results } = await run();
    const failed = results.filter(r => !r.pass).map(r => r.name);
    expect(failed).toEqual([]);
    expect(pass).toBe(true);
  });
});

describe("each check actually catches its own failure", () => {
  it("catches a cross-tenant READ", async () => {
    const { pass, results } = await run({ leakCrossRead: true });
    expect(pass).toBe(false);
    expect(results.find(r => /reading B's document/.test(r.name)).pass).toBe(false);
  });

  it("catches an unfiltered read returning everything", async () => {
    const { pass, results } = await run({ leakUnfiltered: true });
    expect(pass).toBe(false);
    expect(results.find(r => /unfiltered/.test(r.name)).pass).toBe(false);
  });

  it("catches a cross-tenant WRITE, and notices B's document changed", async () => {
    const { pass, results } = await run({ allowCrossWrite: true });
    expect(pass).toBe(false);
    expect(results.find(r => /cannot write into B/.test(r.name)).pass).toBe(false);
    expect(results.find(r => /unchanged by A's attempt/.test(r.name)).pass).toBe(false);
  });

  it("catches memberships being readable", async () => {
    const { pass, results } = await run({ exposeMemberships: true });
    expect(pass).toBe(false);
    expect(results.find(r => /memberships is not readable/.test(r.name)).pass).toBe(false);
  });

  it("catches the public anon key opening documents", async () => {
    const { pass, results } = await run({ leakAnon: true });
    expect(pass).toBe(false);
    expect(results.find(r => /anon key alone/.test(r.name)).pass).toBe(false);
  });
});
