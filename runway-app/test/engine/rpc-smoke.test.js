// The RPC smoke script's reasoning, tested offline. The script itself needs a database; what it
// DECIDES does not, and deciding wrongly is how a smoke test reports green while a function is broken.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { rpcSurface, parseParams, argFor, argsFor, classify, SKIP, BROKEN }
  from "../../scripts/rpc-smoke-checks.mjs";

const files = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()
  .map(name => ({ name, sql: readFileSync(`supabase/migrations/${name}`, "utf8") }));

describe("what it decides to call", () => {
  it("finds the functions actually granted to a client role", () => {
    const surface = rpcSurface(files);
    const names = surface.map(f => f.name);
    for (const expected of ["accept_invitation", "invite_member", "list_members", "company_plan",
                            "my_membership", "list_advised_companies"]) {
      expect(names, `${expected} is granted but not discovered`).toContain(expected);
    }
  });

  it("reads GRANTS, not definitions — an ungranted function cannot break a customer", () => {
    const names = rpcSurface(files).map(f => f.name);
    // Internal helpers with no grant to any client role.
    expect(names).not.toContain("log_audit");
    expect(names).not.toContain("qbo_drop_secret");
  });

  it("covers everything a new migration adds, without a list to maintain", () => {
    // The point of parsing rather than enumerating: 033 was written after this script and is found.
    expect(rpcSurface(files).map(f => f.name)).toContain("my_membership");
  });
});

describe("what it passes", () => {
  it("skips parameters that already have a default", () => {
    // A default is a value the author chose. Guessing over it is how a smoke test starts testing its
    // own guesses rather than the function.
    const ps = parseParams("p_company_id uuid, p_role member_role default 'editor'");
    expect(ps.map(p => p.name)).toEqual(["p_company_id"]);
  });

  it("handles every type this schema actually uses", () => {
    expect(argFor("uuid")).toMatch(/^[0-9a-f-]{36}$/);
    expect(argFor("text")).toBe("rpc-smoke");
    expect(argFor("text[]")).toEqual([]);
    expect(argFor("boolean")).toBe(false);
    expect(argFor("jsonb")).toEqual({});
    expect(argFor("member_role")).toBe("viewer");
    expect(argFor("int")).toBe(0);
    expect(typeof argFor("timestamptz")).toBe("string");
  });

  it("passes a uuid that matches nothing, so a refusal is the expected answer", () => {
    const fn = { name: "delete_company", params: parseParams("p_company_id uuid") };
    const args = argsFor(fn);
    expect(args.p_company_id).toMatch(/^0{8}-0000-4000-8000-/);
  });
});

describe("what it refuses to call at all", () => {
  it("names a reason for every skip", () => {
    for (const [name, why] of SKIP) {
      expect(why, `${name} is skipped without a reason`).toBeTruthy();
      expect(why.length).toBeGreaterThan(10);
    }
  });

  it("skips everything that would change data regardless of its arguments", () => {
    // A random uuid protects you from a function that takes an id. It does not protect you from
    // `delete_my_data()`, which takes none.
    for (const dangerous of ["delete_my_data", "purge_deleted_companies", "create_company",
                             "record_funnel_event", "set_advisor"]) {
      expect(SKIP.has(dangerous), `${dangerous} is not skipped`).toBe(true);
    }
  });
});

describe("telling broken from refused — the whole point", () => {
  it("treats a refusal as SUCCESS, because the function ran", () => {
    // `delete_company` on an id you do not own raises `forbidden`. That is the function parsing,
    // planning and executing, which is the only question being asked.
    expect(classify({ ok: false, status: 403, body: { code: "42501", message: "forbidden" } }).verdict)
      .toBe("refused");
    expect(classify({ ok: false, status: 409, body: { code: "P0010" } }).verdict).toBe("refused");
  });

  it("catches THE BUG THIS SCRIPT EXISTS FOR", () => {
    // `accept_invitation` shipped and could not be called: an OUT parameter named `company_id`
    // shadowed the column in `on conflict (user_id, company_id)`. Created without complaint, because
    // plpgsql resolves names at CALL time. Only calling it finds this.
    const r = classify({ ok: false, status: 400,
                         body: { code: "42702", message: 'column reference "company_id" is ambiguous' } });
    expect(r.verdict).toBe("broken");
    expect(r.detail).toMatch(/OUT parameter shadowing/i);
  });

  it("catches the other two failures this schema has actually had", () => {
    expect(classify({ ok: false, status: 400, body: { code: "42703" } }).verdict).toBe("broken");
    expect(classify({ ok: false, status: 400, body: { code: "42P13" } }).verdict).toBe("broken");
  });

  it("treats a missing function as broken, not as a refusal", () => {
    // The most likely thing after a migration somebody forgot to apply.
    const r = classify({ ok: false, status: 404, body: {} });
    expect(r.verdict).toBe("broken");
    expect(r.detail).toMatch(/migration not applied/i);
  });

  it("does not quietly pass an error it does not recognise", () => {
    expect(classify({ ok: false, status: 500, body: { code: "XX000" } }).verdict).toBe("unknown");
  });

  it("every broken code carries an explanation somebody can act on", () => {
    for (const [code, text] of Object.entries(BROKEN)) {
      expect(text.length, `${code} has no explanation`).toBeGreaterThan(8);
    }
  });
});

describe("a function that was deliberately removed is not reported as broken", () => {
  const surface = rpcSurface(files).map(f => f.name);

  it("drops it from the surface", () => {
    // `my_plan` was dropped in 024 on purpose — "what am I paying for" stopped having one answer when
    // subscriptions moved to the company. An earlier `grant execute` kept it on the list and the smoke
    // run reported it BROKEN, which is a scanner crying wolf about correct work.
    expect(surface).not.toContain("my_plan");
    expect(surface).not.toContain("plan_company_allowance");
  });

  it("but keeps one that was dropped and recreated", () => {
    // The reason the walk has to be ordered rather than set-based: several functions are dropped
    // precisely so they can be recreated with a new shape.
    for (const name of ["list_companies", "list_members", "apply_subscription_event",
                        "accept_invitation"]) {
      expect(surface, `${name} was dropped and recreated, and should still be callable`).toContain(name);
    }
  });

  it("uses the LATEST definition's parameters, not the first", () => {
    // `list_members` gained two OUT columns in 032 and `invite_member` changed twice; calling either
    // with an old signature would be a 404 reported as a missing migration.
    const fn = rpcSurface(files).find(f => f.name === "accept_invitation");
    expect(fn.file).toBe("031_advisor_billing.sql");
  });
});
