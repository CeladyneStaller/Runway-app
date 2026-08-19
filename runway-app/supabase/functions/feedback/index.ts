// Edge Function: feedback
//
// Takes a message from the app and does two things with it, IN THIS ORDER:
//
//   1. Writes a row to `feedback`
//   2. Emails it to the support address
//
// ⚠️ THE ORDER IS THE DESIGN. If the mail provider is down, the feedback is still recorded and can be
// read from the table. The reverse — mail first, insert second — loses the message entirely when the
// insert fails, and **a support channel that silently drops messages is worse than no channel**,
// because the person believes they have been heard.
//
// ⚠️ ANONYMOUS CALLS ARE ALLOWED. Somebody in the demo who hits a wall is exactly who we want to hear
// from and they have no account. That makes rate limiting load-bearing rather than decorative.
//
// Secrets: supabase secrets set ALLOWED_ORIGINS=https://app.waterline-runway.com
//          supabase secrets set FEEDBACK_TO=info@waterline-runway.com
//          supabase secrets set RESEND_API_KEY=...            (optional; without it, table only)
//
// ⚠️ ALLOWED_ORIGINS IS REQUIRED AND FAILS CLOSED. `delete-account` shipped correct and silently
// broken for a day because this secret was never set. Unset here means every browser call is refused.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, parseOrigins } from "../_shared/cors.js";

const ALLOWED_ORIGINS = parseOrigins(Deno.env.get("ALLOWED_ORIGINS"));
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO") ?? "info@waterline-runway.com";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

if (ALLOWED_ORIGINS.length === 0) {
  console.error("[feedback] ALLOWED_ORIGINS is not set — every browser call will be refused.");
}

const cors = (origin: string | null) => corsHeaders(origin, ALLOWED_ORIGINS);

const KINDS = new Set(["broken", "suggestion", "question"]);

// A few per window per caller. Held in memory: an isolate restart resets it, which is acceptable for
// a nuisance control and avoids a table write on every request.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 6;
const seen = new Map<string, number[]>();

const overLimit = (key: string) => {
  const now = Date.now();
  const hits = (seen.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  hits.push(now);
  seen.set(key, hits);
  return hits.length > MAX_PER_WINDOW;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const head = cors(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: head });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }),
      { status: 405, headers: { ...head, "Content-Type": "application/json" } });
  }
  if (!head["Access-Control-Allow-Origin"]) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }),
      { status: 403, headers: { "Content-Type": "application/json" } });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "bad_json" }),
      { status: 400, headers: { ...head, "Content-Type": "application/json" } });
  }

  const kind = String(payload.kind ?? "");
  const body = String(payload.body ?? "").trim();
  const replyEmail = payload.reply_email ? String(payload.reply_email).trim() : null;
  const context = (payload.context && typeof payload.context === "object") ? payload.context : {};
  const tab = payload.tab ? String(payload.tab).slice(0, 40) : null;
  const subtab = payload.subtab ? String(payload.subtab).slice(0, 40) : null;

  if (!KINDS.has(kind) || body.length < 1 || body.length > 4000) {
    return new Response(JSON.stringify({ error: "invalid" }),
      { status: 400, headers: { ...head, "Content-Type": "application/json" } });
  }

  // ⚠️ THE USER COMES FROM THE JWT, NEVER FROM THE BODY. Same rule as `delete-account`: a body-supplied
  // id would let any caller file feedback as somebody else, which is a small harm with a large smell.
  let userId: string | null = null;
  let companyId: string | null = null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    try {
      const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: auth } } });
      const { data } = await asCaller.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch { userId = null; }
  }
  if (payload.company_id && userId) companyId = String(payload.company_id);

  const limitKey = userId ?? (req.headers.get("x-forwarded-for") ?? "anon");
  if (overLimit(limitKey)) {
    return new Response(JSON.stringify({ error: "rate_limited" }),
      { status: 429, headers: { ...head, "Content-Type": "application/json" } });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── 1 · record it ───────────────────────────────────────────────────────────────────────────────
  const { data: row, error } = await admin.from("feedback")
    .insert({ user_id: userId, company_id: companyId, kind, tab, subtab,
              body, reply_email: replyEmail, context })
    .select("id").single();

  if (error) {
    console.error("[feedback] insert failed:", error.message);
    return new Response(JSON.stringify({ error: "not_recorded" }),
      { status: 500, headers: { ...head, "Content-Type": "application/json" } });
  }

  // ── 2 · tell somebody ───────────────────────────────────────────────────────────────────────────
  // ⚠️ A FAILURE HERE IS NOT A FAILURE OF THE REQUEST. The message is already safe in the table, so
  // the person is told it was received — because it was. Logging is how we find out the mail is down.
  if (RESEND_KEY) {
    try {
      const lines = [
        `Kind: ${kind}`,
        tab ? `Where: ${tab}${subtab ? " / " + subtab : ""}` : null,
        replyEmail ? `Reply to: ${replyEmail}` : "Reply to: (not given)",
        userId ? `User: ${userId}` : "User: (not signed in)",
        "",
        body,
        "",
        `Context: ${JSON.stringify(context)}`,
      ].filter(Boolean).join("\n");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Waterline <no-reply@waterline-runway.com>",
          to: [FEEDBACK_TO],
          reply_to: replyEmail || undefined,
          subject: `[${kind}] ${body.slice(0, 60).replace(/\s+/g, " ")}`,
          text: lines,
        }),
      });
      if (!res.ok) console.error("[feedback] mail failed:", res.status, await res.text());
    } catch (e) {
      console.error("[feedback] mail threw:", (e as Error)?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, id: row.id }),
    { status: 200, headers: { ...head, "Content-Type": "application/json" } });
});
