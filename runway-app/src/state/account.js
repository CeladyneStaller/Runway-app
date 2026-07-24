// Account-level operations: which companies you belong to, creating and renaming them, and the profile
// row that records whether you have a password.
//
// Same shape as the document backend — plain fetch against PostgREST, no SDK, every write through a
// SECURITY DEFINER function. Takes the same injected `auth` adapter, so it is fully testable without a
// network.

import { BackendError, ERR_FORBIDDEN, ERR_UNREACHABLE } from "./backends/errors.js";

export function createAccountApi({ url, anonKey, auth, fetchImpl }) {
  if (!url || !anonKey) throw new Error("Account API needs a url and an anon key");
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(url).replace(/\/+$/, "");

  async function headers() {
    return {
      apikey: anonKey,
      Authorization: `Bearer ${await auth.getAccessToken()}`,
      "Content-Type": "application/json",
    };
  }

  async function rpc(fn, body = {}) {
    let res;
    try {
      res = await doFetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST", headers: await headers(), body: JSON.stringify(body),
      });
    } catch (e) {
      throw new BackendError(ERR_UNREACHABLE, "Could not reach the server", e);
    }
    if (!res.ok) {
      let payload = null;
      try { payload = await res.json(); } catch { /* non-JSON */ }
      const kind = res.status === 401 || res.status === 403 ? ERR_FORBIDDEN : ERR_UNREACHABLE;
      throw new BackendError(kind, payload?.message || `HTTP ${res.status}`, payload);
    }
    try { return await res.json(); } catch { return null; }
  }

  const unwrapOne = (out) => (Array.isArray(out) ? out[0] : out);

  return {
    /** Everything the switcher needs, including the headline number per company. */
    async listCompanies() {
      const rows = await rpc("list_companies");
      return Array.isArray(rows) ? rows : [];
    },

    /** Creates an EMPTY company — no document row, so the app renders a blank model. */
    async createCompany(name) {
      const out = await rpc("create_company", { p_name: String(name || "").trim() });
      const id = typeof out === "string" ? out : unwrapOne(out)?.create_company ?? unwrapOne(out);
      if (!id) throw new BackendError(ERR_UNREACHABLE, "Could not create the company");
      return id;
    },

    async renameCompany(companyId, name) {
      await rpc("rename_company", { p_company_id: companyId, p_name: String(name || "").trim() });
    },

    async setLastCompany(companyId) {
      await rpc("set_last_company", { p_company_id: companyId });
    },

    async deleteCompany(companyId) {
      await rpc("delete_company", { p_company_id: companyId });
    },

    /** `{ password_set_at, last_company_id }` — creates the row on first read. */
    async profile() {
      const out = await rpc("my_profile");
      return unwrapOne(out) || { password_set_at: null, last_company_id: null };
    },

    /** Records that a password now exists. The password itself never comes near this call. */
    async markPasswordSet() {
      return rpc("mark_password_set");
    },
  };
}
