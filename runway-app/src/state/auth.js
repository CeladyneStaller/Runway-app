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

    // ONE call. current_company() resolves the caller's company and creates one atomically if this is a
    // brand-new account, all as SECURITY DEFINER — so the client needs no privilege on `memberships` at
    // all, and the create-if-missing path cannot race against the same user signing in on two devices.
    // (The earlier version read memberships directly, which needed a table grant this schema
    // deliberately does not hand out.)
    const out = await call(`/rest/v1/rpc/current_company`, {
      method: "POST",
      headers: await headers(),
      body: "{}",
    });
    const id = typeof out === "string" ? out : out?.[0] ?? out?.current_company;
    if (!id) throw new BackendError(ERR_UNREACHABLE, "Could not resolve a company for this account");
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
