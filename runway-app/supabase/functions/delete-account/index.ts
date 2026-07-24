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
// Secrets: supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim()).filter(Boolean);

function cors(origin: string | null) {
  // Echo the origin only when it is one we know; otherwise send no CORS header at all rather than "*",
  // which would let any page on the internet call this with a stolen token.
  const allow = origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) ? origin : "";
  return {
    ...(allow ? { "Access-Control-Allow-Origin": allow } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

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
