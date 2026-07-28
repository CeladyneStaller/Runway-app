// Edge Function: delete-account
//
// The ONLY thing here that needs the service key is removing the `auth.users` row — nothing else can do
// it. Everything about which data belongs to whom stays in SQL (`delete_my_data()`), running as the
// caller, so the dangerous credential is used for exactly one narrow, unambiguous act.
//
// SECURITY NOTES, in the order they matter:
//
//   1. The user is identified from the JWT, NEVER from the request body. A body-supplied user id would
//      let any authenticated caller delete anybody. There is no user id in the request at all.
//   2. The service client is created AFTER the JWT is verified, and is used only for admin.deleteUser
//      on the id that verification returned.
//   3. Data is deleted BEFORE the auth row. If the order were reversed and the second step failed, the
//      person would have no way to sign in and their data would be stranded, unreachable by anyone.
//   4. SUPABASE_SERVICE_ROLE_KEY comes from function secrets and never leaves this process.
//
// Deploy:  supabase functions deploy delete-account
// Secrets: supabase secrets set ALLOWED_ORIGINS=https://your-app-origin
//          (SUPABASE_URL and the keys are injected by the platform — do not set them yourself.)
//
// ALLOWED_ORIGINS IS REQUIRED, not optional. The allow-list fails CLOSED: unset means every browser
// call is refused. It used to fail open — an empty list allowed any origin — which is the state every
// fresh deployment starts in and the opposite of what this file claimed to do. See `_shared/cors.js`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, parseOrigins } from "../_shared/cors.js";

const ALLOWED_ORIGINS = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));

// SAID OUT LOUD, ONCE PER ISOLATE, because the failure it describes is otherwise invisible from the
// server side: the browser reports a CORS error, the function logs a clean 200 on the preflight, and
// the two never meet. A line in the log is the only place these can be connected.
if (ALLOWED_ORIGINS.length === 0) {
  console.error("[delete-account] ALLOWED_ORIGINS is not set — every browser call will be refused. " +
                "Set it to the app's origin, e.g. https://your-app.example.com");
}

const cors = (origin: string | null) => corsHeaders(origin, ALLOWED_ORIGINS);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json" };

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return new Response(JSON.stringify({ error: "not_configured" }), { status: 500, headers });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "not_authenticated" }), { status: 401, headers });
  }

  // (1) Identify the caller from the token, and from nothing else.
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "not_authenticated" }), { status: 401, headers });
  }

  // (3) Data first, as the caller, under the rules already written in SQL.
  const { data: wiped, error: wipeErr } = await asUser.rpc("delete_my_data");
  if (wipeErr) {
    return new Response(JSON.stringify({ error: "data_delete_failed", detail: wipeErr.message }),
      { status: 500, headers });
  }

  // (2) The one privileged act.
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    // The data is already gone. Say so plainly rather than reporting a clean success — the person needs
    // to know their sign-in still exists so they can ask for it to be removed.
    return new Response(JSON.stringify({
      error: "auth_delete_failed",
      detail: delErr.message,
      dataDeleted: true,
    }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true, ...(wiped?.[0] ?? {}) }), { status: 200, headers });
});
