// Hosted backend: the company's document in Postgres, reached over PostgREST.
//
// NO SDK DEPENDENCY, deliberately. The document layer needs exactly two calls — read the row, call the
// save RPC — and doing them with fetch keeps this file dependency-free, testable without a network, and
// adds nothing to the bundle for anyone running local-only.
//
// AUTH IS NOT THIS FILE'S JOB. Magic links, OAuth redirects and refresh rotation are genuinely hard and
// are exactly what @supabase/supabase-js is good at, so they sit behind the `auth` interface:
//
//   auth.getAccessToken() -> Promise<string>   the current user's JWT
//   auth.getCompanyId()   -> Promise<string>   which company's document to read/write
//
// Every write goes through the save_document RPC rather than a bare PATCH. That is what makes the
// version precondition and the schema-skew refusal unskippable: there is no code path here that can
// blind-write over a newer document, because this file cannot issue one.

import {
  BackendError, ERR_CONFLICT, ERR_FORBIDDEN, ERR_STALE_CLIENT, ERR_UNREACHABLE,
} from "./errors.js";

// PostgREST surfaces a raised exception's SQLSTATE, which is how the RPC's three refusals are told
// apart from an ordinary failure. The message is a fallback for gateways that drop the code.
function classify(status, payload) {
  const code = payload?.code || "";
  const msg = String(payload?.message || "");
  if (code === "P0002" || msg.includes("conflict")) return ERR_CONFLICT;
  if (code === "P0001" || msg.includes("stale_client")) return ERR_STALE_CLIENT;
  if (code === "42501" || status === 401 || status === 403) return ERR_FORBIDDEN;
  return ERR_UNREACHABLE;
}

async function body(res) {
  try { return await res.json(); } catch { return null; }
}

export function createSupabaseBackend({ url, anonKey, auth, fetchImpl }) {
  if (!url || !anonKey) throw new Error("Supabase backend needs a url and an anon key");
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(url).replace(/\/+$/, "");

  // The version this client last saw. It is the precondition on every write: if the row has moved on,
  // the RPC refuses rather than overwriting whatever the other device wrote.
  let version = null;

  async function headers() {
    const token = await auth.getAccessToken();
    return {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function call(path, init) {
    let res;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch (e) {
      // Offline, DNS, TLS — never let this look like "there is no document".
      throw new BackendError(ERR_UNREACHABLE, "Could not reach the server", e);
    }
    if (!res.ok) {
      const payload = await body(res);
      throw new BackendError(classify(res.status, payload), payload?.message || `HTTP ${res.status}`, payload);
    }
    return body(res);
  }

  return {
    name: "supabase",

    async read() {
      const companyId = await auth.getCompanyId();
      const rows = await call(
        `/rest/v1/documents?company_id=eq.${encodeURIComponent(companyId)}&select=body,schema_version,version&limit=1`,
        { method: "GET", headers: await headers() },
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        version = null;
        return null;                       // no document yet — a new company, not a failure
      }
      version = rows[0].version ?? null;
      return { raw: rows[0].body, meta: { version, schemaVersion: rows[0].schema_version } };
    },

    async write(raw) {
      const companyId = await auth.getCompanyId();
      const out = await call(`/rest/v1/rpc/save_document`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          p_company_id: companyId,
          p_schema_version: raw.schemaVersion,
          p_body: raw,
          p_base_version: version,
        }),
      });
      // The RPC returns a single row: the new version and when it landed.
      const row = Array.isArray(out) ? out[0] : out;
      version = row?.out_version ?? row?.version ?? version;
      return { meta: { version } };
    },

    // Nothing to park: a document the client cannot read is still intact on the server, and
    // document_versions holds every predecessor regardless.
    async park() {},

    // Exposed so a conflict resolution can adopt the server's version before rewriting.
    _setVersion(v) { version = v; },
    _version() { return version; },
  };
}
