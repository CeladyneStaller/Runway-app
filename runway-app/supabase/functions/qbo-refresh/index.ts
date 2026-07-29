// The keep-alive. Refreshes connections that have not rotated lately, so a customer who syncs once a
// quarter does not come back to a dead one.
//
// WHY THIS EXISTS AT ALL: a refresh token dies after ~100 idle days, and the clock belongs to the
// TOKEN rather than to the call — only a rotation issues one with a fresh window, and rotation is
// roughly daily. So running monthly catches a rotation with months to spare, and running annually
// would be a scheduled job pointed straight at a dead connection.
//
// NOT USER-FACING. Called by a scheduler with a shared secret, never from a browser: there is no CORS
// here on purpose, because nothing that runs in a browser should be able to trigger it.
//
// Deploy: supabase functions deploy qbo-refresh   (verify_jwt = false; the secret below is the gate)
import { refreshTokens } from "../_shared/qbo-intuit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const CRON_SECRET = Deno.env.get("QBO_CRON_SECRET")!;

const rpc = (fn: string, args: unknown) =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // FAILS CLOSED. An unset secret refuses everything rather than leaving an unauthenticated endpoint
  // that walks every connection in the database.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    console.error("[qbo-refresh] rejected: bad or missing x-cron-secret");
    return new Response("forbidden", { status: 403 });
  }

  const due = await rpc("qbo_due_for_keepalive", {});
  if (!due.ok) return new Response("could not list connections", { status: 500 });
  const rows = (await due.json()) ?? [];

  let rotated = 0, terminal = 0, failed = 0;
  for (const row of rows) {
    const stored = await rpc("qbo_refresh_token", { p_company_id: row.company_id });
    const token = stored.ok ? await stored.json() : null;
    if (!token) { failed += 1; continue; }

    const t = await refreshTokens(token, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    if (!t.ok) {
      // A TERMINAL FAILURE IS THE ONE WORTH WAKING SOMEBODY FOR. `needs_reauth` cannot be repaired by
      // retrying — only the customer can fix it, and until they are asked the sync is silently stale.
      // A silently dead sync is worse than no sync: the numbers look current and are not.
      if (t.terminal) terminal += 1; else failed += 1;
      console.error(`[qbo-refresh] ${row.company_id}: ${t.error} ${t.detail}` +
                    (t.terminal ? "  TERMINAL — customer must reconnect" : ""));
      await rpc("qbo_mark_error", { p_company_id: row.company_id,
                                    p_error: `${t.error} ${t.detail}`.trim(), p_terminal: t.terminal });
      continue;
    }
    await rpc("qbo_rotate", { p_company_id: row.company_id, p_refresh_token: t.refreshToken,
                              p_refresh_expires_at: t.refreshExpiresAt });
    rotated += 1;
  }

  const summary = { considered: rows.length, rotated, needs_reauth: terminal, failed };
  console.log(`[qbo-refresh] ${JSON.stringify(summary)}`);
  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
});
