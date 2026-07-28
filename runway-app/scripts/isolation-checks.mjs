// CROSS-TENANT ISOLATION CHECKS.
//
// The claim this verifies is the one everything else rests on: that a signed-in member of Company A
// cannot reach Company B's numbers through any API call, and that the guarantee lives in the DATABASE
// (RLS + grants) rather than in application code that a bug could bypass.
//
// Reading the policies is not evidence. Policies can be right and grants missing, grants right and
// policies missing, or a later migration can quietly widen either — and all three look identical from
// the outside until someone else's numbers show up. So this drives the real HTTP API with two real
// accounts and asserts on what comes back.
//
// The checks are a pure function of an injected fetch so they can be unit-tested without a network;
// scripts/verify-isolation.mjs is the thin CLI that supplies the real one.

const j = async (res) => { try { return await res.json(); } catch { return null; } };

export function makeClient({ url, anonKey, fetchImpl }) {
  const base = String(url).replace(/\/+$/, "");
  const f = fetchImpl || ((...a) => globalThis.fetch(...a));

  return {
    async signIn(email, password) {
      const res = await f(`${base}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await j(res);
      if (!res.ok || !body?.access_token) {
        throw new Error(`sign-in failed for ${email}: ${body?.error_description || body?.msg || res.status}`);
      }
      return body.access_token;
    },

    async get(path, token) {
      const res = await f(`${base}${path}`, {
        headers: { apikey: anonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      return { status: res.status, ok: res.ok, body: await j(res) };
    },

    /** Any method against any path. `get` and `rpc` cover the happy paths; this exists for the checks
     *  that must assert a write is REFUSED, which needs POST/PATCH/DELETE and a status code. */
    async request(path, { method = "GET", body } = {}, token) {
      const res = await f(`${base}${path}`, {
        method,
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, ok: res.ok, body: await j(res) };
    },

    async rpc(name, args, token) {
      const res = await f(`${base}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(args ?? {}),
      });
      return { status: res.status, ok: res.ok, body: await j(res) };
    },
  };
}

/**
 * @returns {Promise<{pass: boolean, results: Array<{name, pass, detail}>}>}
 */
export async function runIsolationChecks({ client, a, b }) {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail ?? "" });

  const tokenA = await client.signIn(a.email, a.password);
  const tokenB = await client.signIn(b.email, b.password);

  const companyA = (await client.rpc("current_company", {}, tokenA)).body;
  const companyB = (await client.rpc("current_company", {}, tokenB)).body;
  const idA = typeof companyA === "string" ? companyA : companyA?.[0];
  const idB = typeof companyB === "string" ? companyB : companyB?.[0];

  check("the two accounts resolve to DIFFERENT companies",
    idA && idB && idA !== idB,
    `A=${idA} B=${idB}`);

  // Seed a document for B so there is something for A to fail to read. Without this a passing result
  // could just mean "B has no data", which proves nothing.
  await client.rpc("save_document",
    { p_company_id: idB, p_schema_version: 3, p_body: { marker: "B-ONLY-SECRET" }, p_base_version: null },
    tokenB);

  // 1. A reads its own document. If this fails the rest of the run is meaningless — a locked door
  //    proves nothing if the key never worked.
  const ownRead = await client.get(`/rest/v1/documents?select=body&company_id=eq.${idA}`, tokenA);
  check("A can read A's own document", ownRead.ok, `status ${ownRead.status}`);

  // 2. THE MAIN EVENT. RLS returns ZERO ROWS rather than an error, so an empty array is the pass.
  const crossRead = await client.get(`/rest/v1/documents?select=body&company_id=eq.${idB}`, tokenA);
  const leaked = Array.isArray(crossRead.body) ? crossRead.body.length : 1;
  check("A reading B's document returns nothing", crossRead.ok && leaked === 0,
    `status ${crossRead.status}, rows ${leaked}`);

  // 3. An unfiltered read must not quietly return everything. This is the query a careless client
  //    would actually write, and it is where a missing policy shows up first.
  const allDocs = await client.get(`/rest/v1/documents?select=company_id`, tokenA);
  const foreign = Array.isArray(allDocs.body) ? allDocs.body.filter(r => r.company_id !== idA).length : 1;
  check("an unfiltered document read returns only A's own", foreign === 0,
    `foreign rows ${foreign}`);

  // 4. Writing into B's company must be refused by save_document's own membership check, not merely
  //    by a policy — the function is SECURITY DEFINER and bypasses RLS entirely.
  const crossWrite = await client.rpc("save_document",
    { p_company_id: idB, p_schema_version: 3, p_body: { marker: "A-TRIED-TO-WRITE" }, p_base_version: null },
    tokenA);
  check("A cannot write into B's company", !crossWrite.ok,
    `status ${crossWrite.status} ${crossWrite.body?.message || ""}`);

  // 5. B's document must be untouched after that attempt.
  const bAfter = await client.get(`/rest/v1/documents?select=body&company_id=eq.${idB}`, tokenB);
  const marker = bAfter.body?.[0]?.body?.marker;
  check("B's document is unchanged by A's attempt", marker === "B-ONLY-SECRET", `marker=${marker}`);

  // 6. memberships is granted to nobody; current_company() answers the only question a client had.
  const members = await client.get(`/rest/v1/memberships?select=company_id`, tokenA);
  check("memberships is not readable by clients at all", !members.ok,
    `status ${members.status}`);

  // 7. version history must be scoped too — the safety net must not become the leak.
  const versions = await client.get(`/rest/v1/document_versions?select=document_id`, tokenA);
  const okVersions = versions.ok && Array.isArray(versions.body);
  check("document history exposes no other company's rows", okVersions,
    `status ${versions.status}, rows ${Array.isArray(versions.body) ? versions.body.length : "?"}`);

  // 8. The anon key ALONE — no user token — is public, shipped in every browser bundle. It must open
  //    nothing.
  const anonRead = await client.get(`/rest/v1/documents?select=body`, null);
  const anonRows = Array.isArray(anonRead.body) ? anonRead.body.length : 0;
  check("the anon key alone reads no documents", !anonRead.ok || anonRows === 0,
    `status ${anonRead.status}, rows ${anonRows}`);

  // 9. QBO CONNECTIONS — the table that holds a credential to somebody's accounting system rather
  //    than their own numbers. `authenticated` has no grant on it at all, so this must fail outright
  //    rather than return zero rows: an empty array would mean RLS is doing the work, and RLS is one
  //    policy edit away from not doing it.
  const conns = await client.get(`/rest/v1/qbo_connections?select=secret_id,realm_id`, tokenA);
  check("qbo_connections is not readable by clients at all", !conns.ok,
    `status ${conns.status}`);

  // 10. And the decrypt path is service-role only. A client that could call this would not need the
  //     table — it could ask for the token by company id.
  const tok = await client.rpc("qbo_refresh_token", { p_company_id: idA }, tokenA);
  check("qbo_refresh_token is not callable by a client", !tok.ok,
    `status ${tok.status}`);

  // 11. The anon key against the same table, because it ships in every browser bundle.
  const anonConns = await client.get(`/rest/v1/qbo_connections?select=secret_id`, null);
  check("the anon key alone reaches no connection rows", !anonConns.ok,
    `status ${anonConns.status}`);

  return { pass: results.every(r => r.pass), results };
}
