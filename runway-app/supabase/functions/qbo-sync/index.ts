// Pull a QuickBooks report and hand back the GRID the existing import screen already eats.
//
// It returns `{headers, rows}` and stops. It does not decide which column is the code, whether an
// amount is revenue or cost, or what gets merged — `applyProfile` and the mapping screen do that,
// because those answers differ per company. Stage 1 established that the hard way: an account-coded
// landscaper and a Class-coded nonprofit need different mappings and identical code.
//
// Deploy: supabase functions deploy qbo-sync   (verify_jwt = false, caller verified below)
import { corsHeaders } from "../_shared/cors.js";
import { refreshTokens, apiBase } from "../_shared/qbo-intuit.js";
import { quickbooksSource, mergeGrids, dateWindows } from "../_shared/qbo-report.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";
const QBO_ENV = Deno.env.get("QBO_ENV") || "sandbox";

const COLUMNS = "tx_date,txn_type,doc_num,name,memo,subt_nat_amount,klass_name";
const cors = corsHeaders(SITE_URL, [SITE_URL]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const rpc = (fn: string, args: unknown) =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const { company_id: companyId, since, until } = await req.json().catch(() => ({}));
  if (!companyId) return json({ error: "company_required" }, 400);

  // The CALLER's own token is used for the permission check, so the answer comes from `can_edit`
  // under their identity rather than from anything this function decides on their behalf.
  const allowed = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_edit`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ c: companyId }),
  });
  if (!allowed.ok || (await allowed.json()) !== true) return json({ error: "forbidden" }, 403);

  // ONE CALL FOR EVERYTHING THIS FUNCTION NEEDS FROM THE DATABASE. It used to fetch the token by RPC
  // and then read `realm_id` from the table — two round trips and two permission surfaces, and the
  // second one was missing a grant that turned a permission error into `undefined` and reported it as
  // impossible data. A function that already has an RPC has no business also reaching into a table.
  const ctxRes = await rpc("qbo_sync_context", { p_company_id: companyId });
  const ctxBody = ctxRes.ok ? await ctxRes.json().catch(() => null) : await ctxRes.text();
  if (!ctxRes.ok) {
    console.error(`[qbo-sync] qbo_sync_context failed for ${companyId}: ${ctxRes.status} ${ctxBody}`);
    return json({ error: "not_connected" }, 409);
  }
  const ctx = Array.isArray(ctxBody) ? ctxBody[0] : ctxBody;
  const refreshToken = ctx?.refresh_token ?? null;
  const realmId = ctx?.realm_id ?? null;
  if (!refreshToken || !realmId) {
    // SAID OUT LOUD. This returned a bare 409 and logged nothing, so a connection that looked fine in
    // the UI failed with a status code and no explanation anywhere on the server. The three causes
    // below are entirely different repairs, and the RPC's own status is what tells them apart.
    console.error(`[qbo-sync] incomplete connection for ${companyId}: ` +
                  `realm=${realmId ? "yes" : "no"} token=${refreshToken ? "yes" : "no"} — ` +
                  "no row, or a secret_id pointing at a Vault secret that cannot be read");
    return json({ error: "not_connected" }, 409);
  }

  const tokens = await refreshTokens(refreshToken, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  if (!tokens.ok) {
    // TERMINAL FAILURES SET `needs_reauth`; everything else is left alone to be retried. Marking a
    // transient network blip as needing re-authorisation would nag a working connection; treating a
    // dead token as transient retries it forever and nobody is ever told.
    console.error(`[qbo-sync] refresh failed for ${companyId}: ${tokens.error} ${tokens.detail}` +
      (tokens.terminal
        ? "  TERMINAL — the stored refresh token is dead. Usually because something else refreshed " +
          "the same authorization since (Intuit invalidates the previous token on rotation), or it " +
          "sat unused past ~100 days. Only the customer reconnecting fixes it."
        : "  transient — worth retrying"));
    await rpc("qbo_mark_error", { p_company_id: companyId, p_error: `${tokens.error} ${tokens.detail}`.trim(),
                                  p_terminal: tokens.terminal });
    return json({ error: tokens.terminal ? "needs_reauth" : "refresh_failed" }, tokens.terminal ? 409 : 502);
  }
  // STORED BEFORE THE ACCESS TOKEN IS USED FOR ANYTHING. Intuit invalidates the previous refresh
  // token the moment it issues a new one, so a rotation fetched and not stored is a dead connection.
  //
  // AND THE WRITE IS CHECKED. It was fire-and-forget: if `qbo_rotate` failed, Intuit had already
  // killed the old token while the database still held it, the sync carried on and reported success,
  // and the connection was dead from that moment with nothing anywhere saying so. The next sync would
  // fail with `invalid_grant` and look like a QuickBooks problem.
  //
  // Failing here is the honest outcome: the customer sees an error and reconnects, instead of finding
  // out weeks later that their numbers stopped updating.
  const rotated = await rpc("qbo_rotate", { p_company_id: companyId, p_refresh_token: tokens.refreshToken,
                                            p_refresh_expires_at: tokens.refreshExpiresAt });
  if (!rotated.ok) {
    console.error(`[qbo-sync] COULD NOT STORE THE ROTATED TOKEN for ${companyId}: ${rotated.status} ` +
                  `${await rotated.text()} — the connection is now dead at Intuit's end and must be ` +
                  "reconnected. This is the one failure in this function that cannot be retried away.");
    await rpc("qbo_mark_error", { p_company_id: companyId,
                                  p_error: "rotated token could not be stored", p_terminal: true });
    return json({ error: "needs_reauth" }, 409);
  }

  const end = until || new Date().toISOString().slice(0, 10);
  const start = since || `${new Date().getFullYear() - 1}-01-01`;

  // WIDE WINDOWS, SPLIT WHEN PUNISHED. The Reports API caps a response at 400,000 cells, does not
  // paginate, and signals the cap by appending a sentence to a 200. So truncation has to be detected
  // and re-requested smaller, and a window that is STILL truncated is an error rather than a warning:
  // it means the rows returned are a partial year that would import as if it were a whole one.
  const grids: unknown[] = [];
  let requests = 0, unresolved = 0;

  async function pull(w: { start: string; end: string }, depth = 0): Promise<void> {
    const q = new URLSearchParams({ start_date: w.start, end_date: w.end, columns: COLUMNS });
    const res = await fetch(`${apiBase(QBO_ENV)}/v3/company/${realmId}/reports/ProfitAndLossDetail?${q}`,
                            { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" } });
    requests += 1;
    if (!res.ok) throw new Error(`report ${res.status}`);
    const report = await res.json();

    if (JSON.stringify(report).includes("Unable to display more data")) {
      const months = (Number(w.end.slice(0, 4)) - Number(w.start.slice(0, 4))) * 12
                   + (Number(w.end.slice(5, 7)) - Number(w.start.slice(5, 7))) + 1;
      const halves = dateWindows(w.start, w.end, Math.max(1, Math.floor(months / 2)));
      if (depth >= 4 || halves.length < 2) { unresolved += 1; grids.push(quickbooksSource(report)); return; }
      for (const h of halves) await pull(h, depth + 1);
      return;
    }
    grids.push(quickbooksSource(report));
  }

  try {
    for (const w of dateWindows(start, end, 12)) await pull(w);
  } catch (e) {
    await rpc("qbo_mark_error", { p_company_id: companyId, p_error: String((e as Error).message),
                                  p_terminal: false });
    return json({ error: "report_failed" }, 502);
  }

  const grid = mergeGrids(grids) as { headers: string[]; rows: unknown[][] };
  if (unresolved) {
    console.error(`[qbo-sync] ${unresolved} window(s) still truncated for ${companyId}`);
    await rpc("qbo_mark_error", { p_company_id: companyId,
                                  p_error: `${unresolved} window(s) exceeded the report cell limit`,
                                  p_terminal: false });
    return json({ error: "truncated", requests }, 502);
  }

  await rpc("qbo_record_sync", { p_company_id: companyId, p_rows: grid.rows.length });
  return json({ grid, requests, start, end });
});
