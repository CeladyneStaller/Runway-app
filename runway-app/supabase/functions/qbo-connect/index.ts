// Start (or RESTART) a QuickBooks connection. Returns Intuit's authorize URL for the browser to
// visit; it does not redirect, so the client can open a popup or a tab as it prefers.
//
// CONNECT AND RECONNECT ARE THE SAME CALL. That is the whole handling of the five-year ceiling: a
// refresh token cannot outlive five years from the original consent however often it rotates, and on
// that day the only repair is the customer authorising again. `qbo_connect` upserts, so this path
// works identically whether a connection exists or not — and the saved column mapping survives it.
//
// Deploy: supabase functions deploy qbo-connect
// verify_jwt = false, with the caller verified below. A CORS preflight carries no Authorization
// header, so leaving the gateway check on makes this unreachable from a browser with empty logs.
import { corsHeaders } from "../_shared/cors.js";
import { signState } from "../_shared/oauth-state.js";
import { authorizeUrl } from "../_shared/qbo-intuit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const REDIRECT_URI = Deno.env.get("QBO_REDIRECT_URI")!;
const STATE_SECRET = Deno.env.get("QBO_STATE_SECRET")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";

const cors = corsHeaders(SITE_URL, [SITE_URL]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Who is asking — verified against Auth, not decoded from a claim. */
async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: ANON_KEY },
  });
  if (!res.ok) return null;
  return (await res.json())?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!STATE_SECRET) {
    console.error("[qbo-connect] QBO_STATE_SECRET is not set — refusing to issue an unsigned state");
    return json({ error: "not_configured" }, 500);
  }

  const userId = await callerId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const { company_id: companyId } = await req.json().catch(() => ({}));
  if (!companyId) return json({ error: "company_required" }, 400);

  // MEMBERSHIP IS CHECKED HERE, NOT AT THE CALLBACK. The callback is a redirect from Intuit with no
  // session to check anything against, so this is the only moment at which anybody can prove they
  // are entitled to connect this company. The signed state is what carries that proof forward.
  const member = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_edit`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: req.headers.get("Authorization")!,
               "Content-Type": "application/json" },
    body: JSON.stringify({ c: companyId }),
  });
  if (!member.ok || (await member.json()) !== true) return json({ error: "forbidden" }, 403);

  const state = await signState({ companyId, userId }, STATE_SECRET);
  return json({ url: authorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, state }) });
});
