// Intuit sends the browser here after consent. THE ONLY UNAUTHENTICATED ENTRY POINT IN THIS PRODUCT.
//
// No session, no Authorization header, no CORS preflight — this is a top-level navigation, so the
// only thing identifying the request is the `state` signed in qbo-connect and handed back. Everything
// this function trusts, it trusts because of that signature.
//
// It answers with a REDIRECT rather than JSON: a person is looking at this, not a fetch call.
//
// Deploy: supabase functions deploy qbo-callback   (verify_jwt = false — Intuit sends no JWT)
import { verifyState } from "../_shared/oauth-state.js";
import { exchangeCode, apiBase } from "../_shared/qbo-intuit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const REDIRECT_URI = Deno.env.get("QBO_REDIRECT_URI")!;
const STATE_SECRET = Deno.env.get("QBO_STATE_SECRET")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";
const QBO_ENV = Deno.env.get("QBO_ENV") || "sandbox";

/** Back to the app with a result the UI can read. It NEVER carries the reason a signature failed:
 *  somebody probing this endpoint should learn nothing from the redirect they get back. */
const back = (status: string) =>
  new Response(null, { status: 302, headers: { Location: `${SITE_URL}/?qbo=${encodeURIComponent(status)}` } });

const rpc = (fn: string, args: unknown) =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");

  // Pressed Cancel on Intuit's consent screen. Not an error and not worth a loud log — that is
  // somebody changing their mind, which they are allowed to do.
  if (url.searchParams.get("error") === "access_denied") return back("cancelled");

  const s = await verifyState(state, STATE_SECRET);
  if (!s.ok) {
    console.error(`[qbo-callback] rejected state: ${s.reason}`);
    return back("failed");
  }
  if (!code || !realmId) return back("failed");

  const tokens = await exchangeCode(code, REDIRECT_URI,
                                    { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  if (!tokens.ok) {
    console.error(`[qbo-callback] code exchange failed: ${tokens.error} ${tokens.detail}`);
    return back("failed");
  }

  // The company's NAME, fetched before storing so the UI can show WHICH QuickBooks file this is. One
  // Intuit login can own several and this app is multi-company too, so the pairing is a thing a
  // person can get wrong silently; a name on screen is what makes it visible.
  let companyName: string | null = null;
  try {
    const info = await fetch(`${apiBase(QBO_ENV)}/v3/company/${realmId}/companyinfo/${realmId}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
    });
    if (info.ok) companyName = (await info.json())?.CompanyInfo?.CompanyName ?? null;
  } catch { /* a missing name is cosmetic; a failed connection is not */ }

  const saved = await rpc("qbo_connect", {
    p_company_id: s.payload.companyId,
    p_realm_id: realmId,
    p_refresh_token: tokens.refreshToken,
    p_company_name: companyName,
    p_refresh_expires_at: tokens.refreshExpiresAt,
  });
  if (!saved.ok) {
    console.error(`[qbo-callback] qbo_connect failed: ${saved.status} ${await saved.text()}`);
    return back("failed");
  }

  return back("connected");
});
