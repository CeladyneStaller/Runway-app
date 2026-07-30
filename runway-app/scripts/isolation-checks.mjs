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
  // Every check appends `{name, pass, detail}`. `seededA` is read below; ESLint's no-unused-vars is on,
  // so a seed whose result is never consulted would be flagged rather than silently ignored — which is
  // how the original lost track of one.
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

  // SEED BOTH, AND CHECK THE SEEDS LANDED.
  //
  // This is the part that made the whole suite capable of passing for the wrong reason. The original
  // seeded B and never inspected the result, under a comment correctly noting that without a seed "a
  // passing result could just mean B has no data, which proves nothing" — which is exactly what an
  // unchecked seed permits. `save_document` has since gained ways to refuse that did not exist when
  // this was written, and the likeliest one is mundane: A TEST ACCOUNT AGES OUT OF ITS 14-DAY TRIAL,
  // `company_entitled` returns false, `payment_required` is raised, no document is written, and the
  // headline probe reports isolation working perfectly against an empty table.
  const seed = async (label, id, token, marker) => {
    const res = await client.rpc("save_document",
      { p_company_id: id, p_schema_version: 3, p_body: { marker }, p_base_version: null }, token);
    const why = res.ok ? "" :
      String(JSON.stringify(res.body)).includes("payment_required")
        ? " — payment_required: this test account's trial has expired, so nothing was written and every " +
          "read-isolation check below would pass against an empty table"
        : ` — ${JSON.stringify(res.body).slice(0, 160)}`;
    check(`${label} can save its own document (the suite is meaningless without this)`, res.ok,
      `status ${res.status}${why}`);
    return res.ok;
  };

  const seededA = await seed("A", idA, tokenA, "A-ONLY-SECRET");
  const seededB = await seed("B", idB, tokenB, "B-ONLY-SECRET");

  // 1. A reads its own document, and THE MARKER IS THERE. Asserting only the status would pass on a
  //    200 with an empty array — a locked door proves nothing if the key never worked, and the
  //    original checked that the key turned rather than that the door opened.
  const ownRead = await client.get(`/rest/v1/documents?select=body&company_id=eq.${idA}`, tokenA);
  const ownMarker = Array.isArray(ownRead.body) ? ownRead.body[0]?.body?.marker : undefined;
  check("A can read A's own document, and it contains A's data",
    seededA && ownRead.ok && ownMarker === "A-ONLY-SECRET",
    `status ${ownRead.status}, marker ${JSON.stringify(ownMarker)}`);

  // 2. THE MAIN EVENT. RLS returns ZERO ROWS rather than an error, so an empty array is the pass —
  //    which is why it only means anything once B's document is known to exist.
  const crossRead = await client.get(`/rest/v1/documents?select=body&company_id=eq.${idB}`, tokenA);
  const leaked = Array.isArray(crossRead.body) ? crossRead.body.length : 1;
  check("A reading B's document returns nothing (and B's document exists)",
    seededB && crossRead.ok && leaked === 0,
    `seeded ${seededB}, status ${crossRead.status}, rows ${leaked}`);

  // 3. B's document versions are not readable either. A document body can be denied while its history
  //    is not — two tables, two policies, and only one of them is the obvious one to remember.
  const crossVersions = await client.get(
    `/rest/v1/document_versions?select=body,document_id&limit=50`, tokenA);
  const foreignVersions = Array.isArray(crossVersions.body)
    ? crossVersions.body.filter(r => JSON.stringify(r.body ?? {}).includes("B-ONLY-SECRET")).length
    : 1;
  check("A cannot read B's document history", seededB && foreignVersions === 0,
    `status ${crossVersions.status}, rows carrying B's marker ${foreignVersions}`);

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
