// hub-status — status proxy for Waterline HQ
//
// Why this exists: the hub is a static file with no server. Stripe and Vercel
// both need secret credentials, and Stripe's secret-key endpoints reject
// browser calls, so neither can be queried from the page. This function holds
// the keys as Supabase secrets, calls both APIs server-side, and hands back a
// small summary the hub can render.
//
// Deploy:
//   supabase secrets set STRIPE_KEY=rk_live_...        # restricted, read-only
//   supabase secrets set VERCEL_TOKEN=...
//   supabase secrets set VERCEL_PROJECT=waterline      # project name or id
//   supabase secrets set VERCEL_TEAM_ID=team_...       # only if it's under a team
//   supabase functions deploy hub-status --no-verify-jwt
//
// --no-verify-jwt is deliberate: you never sign in to the hub, so there's no
// ⚠️ AUTHENTICATION IS THE CALLER'S SESSION. The hub signs in with the same Supabase project as the
// app, sends its access token, and this function asks `is_staff()`. There is no shared secret to
// rotate, and revoking somebody is `delete from staff where user_id = ...`.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

// Constant-time-ish compare so the token can't be guessed a byte at a time.

// ---------------------------------------------------------------- Stripe ----

// Monthly recurring revenue across active subscriptions, normalised to a
// monthly figure. Yearly plans divide by 12, weekly multiply by ~4.33.
async function getStripe(key: string) {
  const perMonth: Record<string, number> = {
    day: 30.44,
    week: 4.348,
    month: 1,
    year: 1 / 12,
  };

  let mrrCents = 0;
  let activeCount = 0;
  let currency = "usd";
  let startingAfter: string | null = null;

  // Paginate so this stays correct past 100 subscriptions.
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ status: "active", limit: "100" });
    if (startingAfter) qs.set("starting_after", startingAfter);

    const res = await fetch(`https://api.stripe.com/v1/subscriptions?${qs}`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`stripe ${res.status}: ${detail.slice(0, 180)}`);
    }

    const body = await res.json();

    for (const sub of body.data ?? []) {
      activeCount++;
      for (const item of sub.items?.data ?? []) {
        const price = item.price;
        if (!price?.recurring) continue;

        const unit = price.unit_amount ?? 0;
        const qty = item.quantity ?? 1;
        const per = perMonth[price.recurring.interval] ?? 1;
        const count = price.recurring.interval_count || 1;

        mrrCents += (unit * qty * per) / count;
        currency = price.currency || currency;
      }
    }

    if (!body.has_more || !body.data?.length) break;
    startingAfter = body.data[body.data.length - 1].id;
  }

  return { mrrCents: Math.round(mrrCents), activeCount, currency };
}

// ---------------------------------------------------------------- Vercel ----

async function getVercel(token: string, project: string, teamId: string) {
  const qs = new URLSearchParams({ limit: "1" });
  if (project) qs.set("app", project);
  if (teamId) qs.set("teamId", teamId);

  const res = await fetch(`https://api.vercel.com/v6/deployments?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`vercel ${res.status}: ${detail.slice(0, 180)}`);
  }

  const body = await res.json();
  const latest = body.deployments?.[0];
  if (!latest) return { state: "NONE", name: project, createdAt: null };

  return {
    state: latest.state || latest.readyState || "UNKNOWN",
    name: latest.name || project,
    createdAt: latest.created || latest.createdAt || null,
    url: latest.url ? `https://${latest.url}` : null,
  };
}

// ------------------------------------------------------------------- RPC ----

// Calls a Postgres function with the service key the platform provisions.
// Two things this gets right that cost time to learn: the newer sb_secret_ keys
// are NOT JWTs and must go on the apikey header only, while legacy service_role
// keys are JWTs and accept both. Sending a non-JWT as a bearer token is a common
// source of 401s, so Authorization is only added when the key actually is one.
async function rpc(name: string, args: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

  if (!url || !key) throw new Error("SUPABASE_URL / service key not provisioned");

  const headers: Record<string, string> = {
    apikey: key,
    "content-type": "application/json",
  };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${name} ${res.status}: ${detail.slice(0, 180)}`);
  }
  return await res.json();
}

const getFunnel = (windowDays: number) =>
  rpc("funnel_summary", { window_days: windowDays });

// --------------------------------------------------------------- Actions ----

// Write-back for the feedback tiles. Only these two actions are reachable — the
// action name is matched against a fixed map rather than passed through to rpc(),
// so a caller can't name an arbitrary Postgres function.
const ACTIONS: Record<string, string> = {
  address:   "mark_feedback_addressed",
  unaddress: "unmark_feedback_addressed",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleAction(req: Request) {
  let body: { action?: string; id?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json body" }, 400);
  }

  const fn = ACTIONS[String(body?.action ?? "")];
  if (!fn) return json({ ok: false, error: "unknown action" }, 400);

  const id = String(body?.id ?? "");
  if (!UUID_RE.test(id)) return json({ ok: false, error: "id must be a uuid" }, 400);

  try {
    return json(await rpc(fn, { feedback_id: id }));
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 502);
  }
}

// ------------------------------------------------------------------ Serve ----// ------------------------------------------------------------------ Serve ----

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // ⚠️ A SESSION, NOT A SHARED SECRET. `HUB_TOKEN` was typed into a settings field and kept in
  // localStorage, so **anyone with the URL and the string was staff** — no identity, no revocation, and
  // a secret that leaks by being pasted into a browser on a shared machine.
  //
  // The caller now sends the same `Authorization` header every other function in this project reads,
  // and `is_staff()` answers from the `staff` table. **Removing somebody is a DELETE rather than a
  // rotation everybody has to be told about.**
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const sbAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!sbUrl || !sbAnon) {
    return json({ error: "SUPABASE_URL / SUPABASE_ANON_KEY not provisioned" }, 500);
  }

  // ⚠️ THE RPC DECIDES, NOT THIS FUNCTION. `is_staff()` runs as its owner against a table with no RLS
  // policies, so the answer cannot be affected by what the caller can read — and the same answer is
  // available to any other surface that needs it later.
  const who = await fetch(`${sbUrl}/rest/v1/rpc/is_staff`, {
    method: "POST",
    headers: { apikey: sbAnon, Authorization: auth, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!who.ok || (await who.json()) !== true) {
    return json({ error: "unauthorized" }, 401);
  }

  // Write-back actions. Only POST reads a body — an earlier version of this
  // endpoint parsed one unconditionally and every GET died on empty input.
  if (req.method === "POST") return await handleAction(req);

  const stripeKey = Deno.env.get("STRIPE_KEY") ?? "";
  const vercelToken = Deno.env.get("VERCEL_TOKEN") ?? "";
  const vercelProject = Deno.env.get("VERCEL_PROJECT") ?? "";
  const vercelTeam = Deno.env.get("VERCEL_TEAM_ID") ?? "";

  // One slow or broken upstream shouldn't blank the whole strip, so each
  // side reports its own failure and the other still renders.
  const windowDays = Number(new URL(req.url).searchParams.get("days")) || 30;

  const [stripe, vercel, funnel] = await Promise.all([
    stripeKey
      ? getStripe(stripeKey).catch((e) => ({ error: String(e.message ?? e) }))
      : Promise.resolve(null),
    vercelToken
      ? getVercel(vercelToken, vercelProject, vercelTeam).catch((e) => ({
          error: String(e.message ?? e),
        }))
      : Promise.resolve(null),
    getFunnel(windowDays).catch((e) => ({ error: String(e.message ?? e) })),
  ]);

  return json({ stripe, vercel, funnel, generatedAt: new Date().toISOString() });
});
