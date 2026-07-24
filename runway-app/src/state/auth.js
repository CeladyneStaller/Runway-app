// The auth adapter the hosted backend depends on. It supplies exactly two things:
//
//   getAccessToken() -> the signed-in user's JWT
//   getCompanyId()   -> which company's document to read and write
//
// THE SDK IS NOT IMPORTED HERE. `getSession` is injected — in the app that is a one-line wrapper around
// @supabase/supabase-js, and in tests it is a stub. Keeping the dependency out of this file means the
// whole auth path is testable without a network or a package install, and the SDK stays confined to the
// single place that genuinely needs it: session handling and refresh rotation, which are worth a library
// and which nothing here tries to reimplement.
//
// Calling getSession() on every request is deliberate and cheap: the SDK caches the session and refreshes
// it when it is close to expiry, so this is how a rotated token reaches the backend without any
// refresh logic living here.

import { BackendError, ERR_FORBIDDEN, ERR_UNREACHABLE } from "./backends/errors.js";

export function createSupabaseAuth({ url, anonKey, getSession, fetchImpl, companyId: fixedCompanyId }) {
  if (!url || !anonKey) throw new Error("Auth adapter needs a url and an anon key");
  if (typeof getSession !== "function") throw new Error("Auth adapter needs a getSession() function");

  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(url).replace(/\/+$/, "");
  let cachedCompanyId = fixedCompanyId || null;

  async function getAccessToken() {
    let session;
    try {
      session = await getSession();
    } catch (e) {
      throw new BackendError(ERR_UNREACHABLE, "Could not read the session", e);
    }
    const token = session?.access_token;
    // No session is FORBIDDEN, not UNREACHABLE — it must not be retried in a loop, it needs a sign-in.
    if (!token) throw new BackendError(ERR_FORBIDDEN, "Not signed in");
    return token;
  }

  async function headers() {
    return {
      apikey: anonKey,
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
    };
  }

  async function call(path, init) {
    let res;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch (e) {
      throw new BackendError(ERR_UNREACHABLE, "Could not reach the server", e);
    }
    if (!res.ok) {
      let payload = null;
      try { payload = await res.json(); } catch { /* non-JSON error body */ }
      const kind = res.status === 401 || res.status === 403 ? ERR_FORBIDDEN : ERR_UNREACHABLE;
      throw new BackendError(kind, payload?.message || `HTTP ${res.status}`, payload);
    }
    try { return await res.json(); } catch { return null; }
  }

  async function getCompanyId() {
    if (cachedCompanyId) return cachedCompanyId;

    // RLS scopes this to the caller's own memberships, so no user filter is needed or trusted here.
    // Ordered so a user who belongs to several companies resolves to the SAME one every load rather
    // than whichever row the planner happened to return — a company switcher is a later phase, but
    // silently hopping between documents would be a data-integrity bug now.
    const rows = await call(`/rest/v1/memberships?select=company_id&order=created_at.asc&limit=1`,
      { method: "GET", headers: await headers() });

    if (Array.isArray(rows) && rows.length && rows[0].company_id) {
      cachedCompanyId = rows[0].company_id;
      return cachedCompanyId;
    }

    // A signed-in user with no membership is a brand-new account. bootstrap_company creates the company
    // and the owner membership in one transaction, so there is never an account with nowhere to put a
    // document.
    const created = await call(`/rest/v1/rpc/bootstrap_company`, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ p_name: "My company" }),
    });
    const id = typeof created === "string" ? created : created?.[0] ?? created?.bootstrap_company;
    if (!id) throw new BackendError(ERR_UNREACHABLE, "Could not create a company for this account");
    cachedCompanyId = id;
    return cachedCompanyId;
  }

  return {
    getAccessToken,
    getCompanyId,
    /** Forget the resolved company — call on sign-out, or the next user inherits the last one's document. */
    reset() { cachedCompanyId = fixedCompanyId || null; },
  };
}
