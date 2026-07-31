// Account-level operations: which companies you belong to, creating and renaming them, and the profile
// row that records whether you have a password.
//
// Same shape as the document backend — plain fetch against PostgREST, no SDK, every write through a
// SECURITY DEFINER function. Takes the same injected `auth` adapter, so it is fully testable without a
// network.

import { BackendError, ERR_FORBIDDEN, ERR_UNREACHABLE } from "./backends/errors.js";
import { track } from "./funnel.js";
import { assembleFromStorage } from "./sections.js";

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
    /** `checkout_completed` is recorded HERE, on a subscription that reads active — not on the redirect
     *  back from Stripe, which is a URL the browser could have typed. The webhook is the only thing
     *  that can make this true, so this is the only honest place to count a purchase. */
    /** The plan for ONE COMPANY (024). `my_plan()` is gone: a person can be in several companies on
     *  several plans, so "what am I paying for" stopped having a single answer. */
    async companyPlan(companyId) {
      const out = await rpc("company_plan", { p_company_id: companyId });
      const row = unwrapOne(out) || { plan: "none", status: "none", seats: 0, used: 0, pending: 0 };
      // A LIVE SUBSCRIPTION IS THE ONLY HONEST DEFINITION OF A COMPLETED PURCHASE. Recording it on the
      // redirect back from Stripe would count a URL the browser could have typed; `active` here can
      // only have been caused by the webhook, which required Stripe to have charged a card.
      // `active` or `past_due` only. NOT `trialing`: this product's trial is computed from the signup
      // timestamp with no card, so counting it would report purchases that never happened. `past_due`
      // means a card succeeded once and has since failed, which is still a completed checkout.
      if (row.status === "active" || row.status === "past_due") void track("checkout_completed");
      return row;
    },

    /** Start a hosted Checkout. Returns a URL to send the browser to — we never touch card fields,
     *  which keeps this out of PCI scope entirely. */
    /** `checkout_started` fires here rather than on the click, because the click is an intent and this
     *  is a Stripe session that actually exists. `checkout_completed` cannot be recorded from the
     *  browser at all — the browser is told by a redirect it could fabricate — so it is recorded when
     *  the SUBSCRIPTION reads active, which only the webhook can cause. */
    /** Buy an ADVISOR plan — for yourself, so there is no company and no permission to check. */
    async checkoutAdvisor(plan) {
      const r = await doFetch(`${base}/functions/v1/stripe-checkout`, {
        method: "POST", headers: await headers(),
        body: JSON.stringify({ plan, kind: "advisor" }),
      });
      if (!r.ok) throw new BackendError(ERR_UNREACHABLE, `checkout failed (${r.status})`);
      void track("checkout_started");
      return (await r.json()).url;
    },

    async advisorPortal() {
      const r = await doFetch(`${base}/functions/v1/stripe-portal`, {
        method: "POST", headers: await headers(), body: JSON.stringify({ kind: "advisor" }),
      });
      if (r.status === 404) throw new BackendError(ERR_FORBIDDEN, "no_subscription");
      if (!r.ok) throw new BackendError(ERR_UNREACHABLE, `portal failed (${r.status})`);
      return (await r.json()).url;
    },

    async advisorPlan() {
      const rows = await rpc("advisor_usage", {});
      return unwrapOne(rows) || { companies: 0, allowed: 0 };
    },

    async checkout(companyId, plan) {
      const r = await doFetch(`${base}/functions/v1/stripe-checkout`, {
        method: "POST", headers: await headers(), body: JSON.stringify({ plan, company_id: companyId }),
      });
      if (!r.ok) throw new BackendError(ERR_UNREACHABLE, `checkout failed (${r.status})`);
      void track("checkout_started");
      return (await r.json()).url;
    },

    /** Open the Stripe Customer Portal: change plan, update card, cancel, download invoices.
     *  None of it built by us, which is the point. */
    async billingPortal(companyId) {
      const r = await doFetch(`${base}/functions/v1/stripe-portal`, {
        method: "POST", headers: await headers(), body: JSON.stringify({ company_id: companyId }),
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
    // ---- team ---------------------------------------------------------------

    async listMembers(companyId) {
      const rows = await rpc("list_members", { p_company_id: companyId });
      return Array.isArray(rows) ? rows : [];
    },

    /** Returns the invite LINK, once. The raw token exists only in this response — nothing stores it,
     *  and `list_invitations` deliberately cannot return it. Re-invite to issue a new one. */
    async inviteMember(companyId, email, role = "editor") {
      const token = await rpc("invite_member",
        { p_company_id: companyId, p_email: String(email || "").trim(), p_role: role });
      const raw = typeof token === "string" ? token : unwrapOne(token);
      if (!raw) throw new BackendError(ERR_UNREACHABLE, "Could not create the invitation.");
      // Built against the CURRENT origin rather than a configured one: an invite link that points at
      // the wrong deployment is worse than no link, and the person inviting is standing in the right
      // place by definition.
      return { token: raw, url: `${globalThis.location?.origin ?? ""}/?invite=${encodeURIComponent(raw)}` };
    },

    async listInvitations(companyId) {
      const rows = await rpc("list_invitations", { p_company_id: companyId });
      return Array.isArray(rows) ? rows : [];
    },

    async revokeInvitation(id) {
      await rpc("revoke_invitation", { p_id: id });
    },

    async acceptInvitation(token) {
      const out = await rpc("accept_invitation", { p_token: String(token || "") });
      return unwrapOne(out) || null;
    },

    /** The INVITEE says no. Distinct from revoking, which is the inviter withdrawing it: only one of
     *  those means stop asking, and the audit trail should be able to tell them apart. */
    async declineInvitation(token) {
      await rpc("decline_invitation", { p_token: String(token || "") });
    },

    async setMemberRole(companyId, userId, role) {
      await rpc("set_member_role", { p_company_id: companyId, p_user_id: userId, p_role: role });
    },

    async removeMember(companyId, userId) {
      await rpc("remove_member", { p_company_id: companyId, p_user_id: userId });
    },

    /** Which tabs this company does not use. Every member reads it; only an owner may set it. */
    async companyTabs(companyId) {
      const out = await rpc("company_tabs", { p_company_id: companyId });
      return Array.isArray(out) ? out : (Array.isArray(out?.company_tabs) ? out.company_tabs : []);
    },

    async setCompanyTabs(companyId, hidden) {
      await rpc("set_company_tabs", { p_company_id: companyId, p_hidden: hidden || [] });
    },

    /** Every company you are in, for the advisor portfolio. Deliberately carries NO figures — runway is
     *  computed by the engine from each document, and a server-side projection would be a second answer
     *  to "when do we run out". */
    async listAdvisedCompanies() {
      const rows = await rpc("list_advised_companies");
      return Array.isArray(rows) ? rows : [];
    },

    /** Your own advisor plan and how much of it is used. */
    async advisorUsage() {
      const out = await rpc("advisor_usage", {});
      return unwrapOne(out) || { companies: 0, allowed: 0 };
    },

    /** My own standing in this company: role, advisor, seat. One call, and it is what makes the tab
     *  gate real — it has been failing open because nothing told it who was looking. */
    async myMembership(companyId) {
      const out = await rpc("my_membership", { p_company_id: companyId });
      return unwrapOne(out) || null;
    },

    async offeredScenarios(companyId) {
      const rows = await rpc("offered_scenarios", { p_company_id: companyId });
      return Array.isArray(rows) ? rows : [];
    },

    async decideScenario(id, accept) {
      await rpc("decide_scenario", { p_id: id, p_accept: !!accept });
    },

    async myScenarios(companyId) {
      const rows = await rpc("my_scenarios", { p_company_id: companyId });
      return Array.isArray(rows) ? rows : [];
    },

    async saveScenario(companyId, name, body, id = null) {
      const out = await rpc("save_scenario",
        { p_company_id: companyId, p_name: name, p_body: body, p_id: id });
      return typeof out === "string" ? out : unwrapOne(out);
    },

    async shareScenario(id) { await rpc("share_scenario", { p_id: id }); },
    async unshareScenario(id) { await rpc("unshare_scenario", { p_id: id }); },
    async deleteScenario(id) { await rpc("delete_scenario", { p_id: id }); },

    /** Another company's document, for the portfolio.
     *
     *  THROUGH `load_document`, NOT A DIRECT READ. It was a direct select on `documents.body`, which
     *  was correct until migration 037 took `projects` out of the blob — after which this would have
     *  computed every client's runway from a document missing 44% of its model and reported the answer
     *  with no indication anything was wrong. On the one screen whose entire purpose is to be trusted.
     *
     *  Nothing would have caught it: the read still succeeds, the document still parses, the engine
     *  still projects, and the number is simply wrong. */
    async readCompanyDocument(companyId) {
      const rows = await rpc("load_document", { p_company_id: companyId });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row || row.body == null) return null;
      return assembleFromStorage(row.body, { projects: row.projects });
    },

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
