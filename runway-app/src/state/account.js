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

    /** Exclude a company from the aggregate statistics we publish. Owner-only, enforced in the RPC.
     *  The job applies this in its QUERY, so an opted-out company's document is never read at all. */
    async setStatsOptout(companyId, optout) {
      await rpc("set_stats_optout", { p_company_id: companyId, p_optout: !!optout });
    },

    /** Plan, status and allowance for the signed-in account. One call, so the billing UI needs no
     *  second round trip to work out what to show. */
    async myPlan() {
      const out = await rpc("my_plan", {});
      return unwrapOne(out) || { plan: "none", status: "none", companies_allowed: 0 };
    },

    /** Start a hosted Checkout. Returns a URL to send the browser to — we never touch card fields,
     *  which keeps this out of PCI scope entirely. */
    async checkout(plan) {
      const r = await doFetch(`${base}/functions/v1/stripe-checkout`, {
        method: "POST", headers: await headers(), body: JSON.stringify({ plan }),
      });
      if (!r.ok) throw new BackendError(ERR_UNREACHABLE, `checkout failed (${r.status})`);
      return (await r.json()).url;
    },

    /** Open the Stripe Customer Portal: change plan, update card, cancel, download invoices.
     *  None of it built by us, which is the point. */
    async billingPortal() {
      const r = await doFetch(`${base}/functions/v1/stripe-portal`, {
        method: "POST", headers: await headers(),
      });
      if (r.status === 404) throw new BackendError(ERR_FORBIDDEN, "no_subscription");
      if (!r.ok) throw new BackendError(ERR_UNREACHABLE, `portal failed (${r.status})`);
      return (await r.json()).url;
    },

    /** SOFT delete since 016 — recoverable for `company_purge_window()`, then purged for real. */
    async deleteCompany(companyId) {
      await rpc("delete_company", { p_company_id: companyId });
    },

    /** What is still recoverable, with when it stops being. Owner-only, enforced in the RPC.
     *  `restores_in_window` is there so the UI can show a company that keeps coming back. */
    async listDeletedCompanies() {
      const rows = await rpc("list_deleted_companies");
      return Array.isArray(rows) ? rows : [];
    },

    // ---- QuickBooks -------------------------------------------------------
    // The Edge Functions live behind the same base as billing, so they share this file's headers and
    // its honest-failure handling rather than growing a second client with its own idea of what a
    // 404 means.

    /** Null when there is no connection. Never returns a token — the RPC cannot see one. */
    async qboStatus(companyId) {
      const rows = await rpc("qbo_connection_status", { p_company_id: companyId });
      return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
    },

    /** Returns Intuit's authorize URL. The CALLER navigates — this deliberately does not, so a popup
     *  and a full-page redirect are both the caller's choice rather than this file's. */
    async qboConnect(companyId) {
      const r = await doFetch(`${base}/functions/v1/qbo-connect`, {
        method: "POST", headers: await headers(), body: JSON.stringify({ company_id: companyId }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.url) {
        throw new BackendError(ERR_UNREACHABLE,
          body.error === "not_configured" ? "QuickBooks is not configured on the server yet."
                                          : "Could not start the QuickBooks connection.");
      }
      return body.url;
    },

    /** Returns a Grid for the existing import screen — headers and rows, nothing interpreted. */
    async qboSync(companyId, { since, until } = {}) {
      const r = await doFetch(`${base}/functions/v1/qbo-sync`, {
        method: "POST", headers: await headers(),
        body: JSON.stringify({ company_id: companyId, since, until }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) return body;
      // These three are told apart because they need DIFFERENT ACTIONS from the person reading them:
      // reconnect, wait, or narrow the range. One generic failure message would send all three to
      // support.
      if (body.error === "needs_reauth") throw new BackendError(ERR_UNREACHABLE, "needs_reauth");
      if (body.error === "truncated") throw new BackendError(ERR_UNREACHABLE, "truncated");
      if (body.error === "not_connected") throw new BackendError(ERR_UNREACHABLE, "not_connected");
      throw new BackendError(ERR_UNREACHABLE, "Could not reach QuickBooks. Try again shortly.");
    },

    async qboDisconnect(companyId) {
      const r = await doFetch(`${base}/functions/v1/qbo-disconnect`, {
        method: "POST", headers: await headers(), body: JSON.stringify({ company_id: companyId }),
      });
      if (!r.ok) throw new BackendError(ERR_UNREACHABLE, "Could not disconnect QuickBooks.");
    },

    async restoreCompany(companyId) {
      await rpc("restore_company", { p_company_id: companyId });
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

    /** Delete the account: every sole-owned company, plus the sign-in itself.
     *
     *  Goes through the delete-account Edge Function rather than an RPC because removing an
     *  `auth.users` row needs the service key, which cannot exist in a browser. The function identifies
     *  the caller from this token alone — no user id is sent, because a body-supplied id would let any
     *  authenticated caller delete anybody. */
    async deleteAccount() {
      let res;
      try {
        res = await doFetch(`${base}/functions/v1/delete-account`, {
          method: "POST", headers: await headers(), body: "{}",
        });
      } catch (e) {
        throw new BackendError(ERR_UNREACHABLE, "Could not reach the server", e);
      }
      let payload = null;
      try { payload = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        // The function reports this specifically: the data is gone but the sign-in survived. Saying
        // "deleted" here would be false, and a false claim about deletion is the worst kind.
        if (payload?.error === "auth_delete_failed") {
          throw new BackendError(ERR_UNREACHABLE,
            "Your data was deleted, but your sign-in could not be removed. Contact support to finish it.");
        }
        if (payload?.error === "not_configured") {
          throw new BackendError(ERR_UNREACHABLE,
            "Account deletion isn't set up on this deployment yet. Nothing has been changed.");
        }
        const kind = res.status === 401 || res.status === 403 ? ERR_FORBIDDEN : ERR_UNREACHABLE;
        throw new BackendError(kind, payload?.detail || payload?.error || `HTTP ${res.status}`);
      }
      return payload || { ok: true };
    },
  };
}
