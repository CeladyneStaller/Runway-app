// Disconnect. Revoke at Intuit FIRST, then delete our copy.
//
// THAT ORDER IS THE WHOLE FUNCTION. Deleting our copy of a credential is not revoking it: a token we
// have thrown away stays valid at Intuit, and we no longer hold it to revoke later. So revocation is
// attempted first — and if it fails we delete anyway and log it loudly, because keeping a usable
// token for somebody who asked to disconnect is the worse of the two failures.
//
// Deploy: supabase functions deploy qbo-disconnect   (verify_jwt = false, caller verified below)
import { corsHeaders } from "../_shared/cors.js";
import { revokeToken } from "../_shared/qbo-intuit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";

const cors = corsHeaders(SITE_URL, [SITE_URL]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const { company_id: companyId } = await req.json().catch(() => ({}));
  if (!companyId) return json({ error: "company_required" }, 400);

  // Read the token with the SERVICE key, delete with the CALLER's — so the permission decision is
  // made by `qbo_disconnect`, which checks membership, rather than by this function.
  const stored = await fetch(`${SUPABASE_URL}/rest/v1/rpc/qbo_refresh_token`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_company_id: companyId }),
  });
  const token = stored.ok ? await stored.json() : null;

  if (token) {
    const revoked = await revokeToken(token, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    if (!revoked.ok) {
      console.error(`[qbo-disconnect] Intuit revoke failed (${revoked.status}) for ${companyId} — ` +
                    "deleting our copy anyway. The token may remain valid at Intuit until it expires.");
    }
  }

  const gone = await fetch(`${SUPABASE_URL}/rest/v1/rpc/qbo_disconnect`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_company_id: companyId }),
  });
  if (!gone.ok) return json({ error: "forbidden" }, 403);

  return json({ disconnected: true });
});
