// ── What leaves the browser when somebody sends feedback ──────────────────────────────────────────
//
// ⚠️ ONE FUNCTION DECIDES THIS, AND IT IS A SECURITY BOUNDARY. Everything else in the feedback feature
// is a form; this is the part that could leak a financial model. Collecting context at the call site
// would mean the answer to "what is sent?" lives in as many places as there are call sites, and the
// one added later would be the one nobody checked.
//
// **The rule is an ALLOW-LIST, never a redaction.** Copying the document and deleting the sensitive
// keys is the version that leaks the field somebody adds next year. Nothing from the document is read
// here except the company's name.

import { subtabsOf } from "./tabprefs";

const APP_VERSION = "2026.08.18";

/**
 * @param where  { view, subtab }        — where the person is in the app
 * @param who    { plan, companyName }   — nothing else about the company
 */
export function collectContext(where = {}, who = {}) {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const win = typeof window !== "undefined" ? window : {};
  return {
    tab: where.view || null,
    subtab: where.subtab || null,
    plan: who.plan || null,
    // The NAME only, so a reply can say which model without the reply containing the model.
    company: who.companyName || null,
    app: APP_VERSION,
    ua: String(nav.userAgent || "").slice(0, 200),
    viewport: win.innerWidth ? `${win.innerWidth}×${win.innerHeight}` : null,
    lang: nav.language || null,
    at: new Date().toISOString(),
  };
}

/** The three kinds, and the example each one shows in the empty message box.
 *
 *  ⚠️ AN EXAMPLE OUTPERFORMS AN INSTRUCTION. "Please describe the issue in detail" produces one line;
 *  a sentence in the voice of a real report produces a real report, because it demonstrates the LEVEL
 *  of detail rather than asking for it.
 *
 *  Placeholder, never prefilled — prefilled text gets sent by somebody in a hurry, and you receive
 *  your own example back.
 */
export const FEEDBACK_KINDS = Object.freeze([
  { id: "broken", label: "Report something broken",
    hint: "My data does not appear to affect the runway." },
  { id: "suggestion", label: "Feature suggestion",
    hint: "I would like to compare two grant budgets side by side." },
  { id: "question", label: "Question or concern",
    hint: "I am not sure what cost share does to my runway." },
]);

export const hintFor = (kind) =>
  FEEDBACK_KINDS.find(k => k.id === kind)?.hint || "";

/** Sub-tabs for the tab picker.
 *
 *  ⚠️ TABS THE PERSON HAS HIDDEN ARE STILL OFFERED. A report about a tab they turned off is a
 *  legitimate report — and filtering to their visible tabs makes "I cannot find X" impossible to file.
 */
export const subtabChoices = (view) => subtabsOf(view);

/** Send it. Returns { ok } — the caller does not need to know how it failed, only whether to say so. */
export async function sendFeedback(payload, { url, anonKey, token, fetchImpl = fetch } = {}) {
  if (!url) return { ok: false, error: "not_configured" };
  try {
    const res = await fetchImpl(`${url}/functions/v1/feedback`, {
      method: "POST",
      // ⚠️ `Authorization` IS ALWAYS SENT, FALLING BACK TO THE ANON KEY. Supabase's gateway checks it
      // before the function runs, so omitting it on the anonymous path returns 401 and **the function
      // never executes** — which is why the failure looked nothing like the code inside it.
      //
      // `account.js` has always sent both headers unconditionally. I wrote a second, weaker version
      // instead of copying the one that works.
      headers: {
        "Content-Type": "application/json",
        ...(anonKey ? { apikey: anonKey } : {}),
        Authorization: `Bearer ${token || anonKey || ""}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) return { ok: false, error: "failed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "offline" };
  }
}
