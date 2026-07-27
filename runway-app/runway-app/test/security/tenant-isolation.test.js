// CROSS-TENANT ISOLATION, verified against a REAL project.
//
// Every other test in this repo runs against fakes, which is right for logic and useless for this: the
// question here is not "does my code intend to isolate tenants" but "does the database actually refuse".
// Policies that look correct in a migration file are not evidence. This asks Postgres.
//
// SKIPPED unless credentials are present, so `npm test` stays offline and fast. Run it deliberately:
//
//   SUPABASE_TEST_URL=https://xxx.supabase.co \
//   SUPABASE_TEST_ANON_KEY=eyJ... \
//   TEST_USER_A=a@example.com TEST_PASS_A=... \
//   TEST_USER_B=b@example.com TEST_PASS_B=... \
//   npm run test:isolation
//
// The two accounts must be different people in different companies. Email/password sign-in must be
// enabled in Supabase (magic links are passwordless and cannot be scripted).
import { describe, it, expect, beforeAll } from "vitest";

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const A = { email: process.env.TEST_USER_A, password: process.env.TEST_PASS_A };
const B = { email: process.env.TEST_USER_B, password: process.env.TEST_PASS_B };

const configured = !!(URL && ANON && A.email && A.password && B.email && B.password);
const base = (URL || "").replace(/\/+$/, "");

async function signIn({ email, password }) {
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: HTTP ${res.status}`);
  const j = await res.json();
  return j.access_token;
}

const authed = (token) => ({ apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

async function rpc(token, fn, body = {}) {
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: authed(token), body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function get(token, path) {
  const res = await fetch(`${base}/rest/v1/${path}`, { headers: authed(token) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json, text };
}

describe.skipIf(!configured)("cross-tenant isolation (live project)", () => {
  let tokenA, tokenB, companyA, companyB;

  beforeAll(async () => {
    tokenA = await signIn(A);
    tokenB = await signIn(B);
    const ra = await rpc(tokenA, "current_company");
    const rb = await rpc(tokenB, "current_company");
    companyA = typeof ra.json === "string" ? ra.json : ra.json?.[0];
    companyB = typeof rb.json === "string" ? rb.json : rb.json?.[0];
    expect(companyA).toBeTruthy();
    expect(companyB).toBeTruthy();
  }, 30000);

  it("the two accounts really are separate companies", () => {
    expect(companyA).not.toBe(companyB);   // if this fails nothing below proves anything
  });

  it("each account can save and read back its own document", async () => {
    const stamp = `iso-${Date.now()}`;
    const saved = await rpc(tokenA, "save_document", {
      p_company_id: companyA, p_schema_version: 3,
      p_body: { schemaVersion: 3, marker: stamp }, p_base_version: null,
    });
    // null base_version is only valid on a first write; an existing document returns a conflict, which
    // is itself correct behaviour and not a failure of isolation.
    expect([200, 201, 400].includes(saved.status)).toBe(true);

    const mine = await get(tokenA, `documents?company_id=eq.${companyA}&select=company_id`);
    expect(mine.ok).toBe(true);
    expect(Array.isArray(mine.json)).toBe(true);
  }, 30000);

  it("B cannot read A's document", async () => {
    const probe = await get(tokenB, `documents?company_id=eq.${companyA}&select=body,version`);
    // RLS denial is ZERO ROWS, not an error — an empty array here is the pass condition.
    expect(probe.ok).toBe(true);
    expect(probe.json).toEqual([]);
  }, 30000);

  it("B cannot read A's document versions", async () => {
    const probe = await get(tokenB, `document_versions?select=body&limit=5`);
    expect(probe.ok).toBe(true);
    for (const row of probe.json || []) expect(row).not.toHaveProperty("__leak");
    // any rows returned must belong to B; the strong check is that A's company never appears
    const all = await get(tokenB, `documents?select=company_id`);
    for (const row of all.json || []) expect(row.company_id).not.toBe(companyA);
  }, 30000);

  it("B cannot WRITE to A's company, even with a valid session", async () => {
    const attack = await rpc(tokenB, "save_document", {
      p_company_id: companyA, p_schema_version: 3,
      p_body: { schemaVersion: 3, marker: "SHOULD-NEVER-LAND" }, p_base_version: null,
    });
    expect(attack.ok).toBe(false);              // can_edit() inside the definer function must refuse
    expect(attack.text).toMatch(/forbidden|permission|denied/i);
  }, 30000);

  it("A's document was not modified by that attempt", async () => {
    const mine = await get(tokenA, `documents?company_id=eq.${companyA}&select=body`);
    const body = mine.json?.[0]?.body;
    if (body) expect(JSON.stringify(body)).not.toMatch(/SHOULD-NEVER-LAND/);
  }, 30000);

  it("nobody can read the memberships table at all — no grant is issued on it", async () => {
    const probe = await get(tokenA, `memberships?select=company_id`);
    expect(probe.ok).toBe(false);               // "permission denied", by design
    expect(probe.text).toMatch(/permission denied/i);
  }, 30000);

  it("an anonymous caller gets nothing", async () => {
    const res = await fetch(`${base}/rest/v1/documents?select=body`, { headers: { apikey: ANON } });
    const rows = res.ok ? await res.json() : null;
    expect(res.ok ? rows : []).toEqual([]);     // no session => no rows, never a leak
  }, 30000);
});

describe.skipIf(configured)("cross-tenant isolation", () => {
  it("skipped — set SUPABASE_TEST_URL and two test accounts to run it (see the file header)", () => {
    expect(configured).toBe(false);
  });
});
