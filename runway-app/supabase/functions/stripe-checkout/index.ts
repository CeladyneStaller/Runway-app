// Creates a Stripe Checkout Session for the signed-in user.
//
// Called from the browser with the user's Supabase JWT. The SECRET KEY never leaves this function.
// We do not build card fields: Checkout is hosted, which keeps this out of PCI scope entirely.
import { corsHeaders } from "../_shared/cors.js";
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";

// PARSED DEFENSIVELY, like the webhook's `readPriceMap` — this was a bare `JSON.parse` and should
// never have been. A THROW AT MODULE SCOPE MEANS THE FUNCTION NEVER BOOTS, so every request fails,
// including the CORS preflight, and the browser reports a CORS error with nothing in the function
// logs. A JSON typo in a secret then presents as a deployment or CORS problem — three plausible
// causes for one symptom, distinguishable only by curling the endpoint by hand.
function readPriceIds(): Record<string, string> {
  const raw = Deno.env.get("STRIPE_PRICE_IDS");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, string>;
  } catch (e) {
    console.error("[checkout] STRIPE_PRICE_IDS is not valid JSON, ignoring it:", (e as Error).message);
    console.error('[checkout] expected: {"solo":"price_123","advisor":"price_456"}');
    return {};
  }
}
const PRICE_MAP: Record<string, string> = readPriceIds();

// ONE definition of the CORS rules, shared with the other browser-facing functions and unit-tested
// in `test/engine/cors.test.js`. Hand-writing this header set per function is what produced three
// different CORS failures in a row, each a separate omission from a separate literal.
const cors = corsHeaders(SITE_URL, [SITE_URL]);

/** Who is calling? Verified against Supabase Auth rather than trusted from the request body — a
 *  user_id in a POST is a claim, not an identity, and this one decides who gets billed. */
async function callerId(req: Request): Promise<string | null> {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!jwt) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return null;
  return (await r.json())?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const userId = await callerId(req);
  if (!userId) return new Response("unauthorized", { status: 401, headers: cors });

  const { plan, company_id: companyId } = await req.json().catch(() => ({}));
  if (!companyId) return new Response("company_required", { status: 400, headers: cors });

  // ONLY SOMEBODY WHO COULD USE IT MAY BUY IT. Without this check anyone could open a Checkout session
  // against any company id and pay for a stranger's subscription — harmless to them and confusing
  // forever afterwards, since the webhook would attach it and nobody would know why.
  const allowed = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_edit`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: req.headers.get("Authorization")!,
               "Content-Type": "application/json" },
    body: JSON.stringify({ c: companyId }),
  });
  if (!allowed.ok || (await allowed.json()) !== true) {
    return new Response("forbidden", { status: 403, headers: cors });
  }
  // Told apart on purpose. An EMPTY map is a deployment that was never finished; a missing KEY is a
  // plan this deployment does not sell. Reporting both as "unknown plan" sends you to look at the
  // client for a server-side omission.
  if (Object.keys(PRICE_MAP).length === 0) {
    console.error("[checkout] STRIPE_PRICE_IDS is unset or empty — no plan can be priced");
    return new Response("not_configured", { status: 500, headers: cors });
  }
  const price = PRICE_MAP[plan];
  if (!price) return new Response("unknown plan", { status: 400, headers: cors });

  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${SITE_URL}/#account?checkout=success`,
    cancel_url: `${SITE_URL}/#account?checkout=cancelled`,
    // BOTH, deliberately. `client_reference_id` identifies the session; the metadata is copied onto
    // the SUBSCRIPTION, so later lifecycle events — which never mention the session — can still be
    // attributed. Without it, a renewal three months from now is unattributable.
    //
    // THE COMPANY IS WHAT A SUBSCRIPTION BELONGS TO now, so that is what the session and the
    // subscription are both stamped with. `user_id` rides along as WHO PAID, which the billing portal
    // still needs because a Stripe customer is a person rather than a company.
    client_reference_id: companyId,
    "subscription_data[metadata][company_id]": companyId,
    "subscription_data[metadata][user_id]": userId,
    // Lets Checkout collect a billing address, which Stripe Tax needs if it is ever switched on.
    billing_address_collection: "auto",
    allow_promotion_codes: "true",
  });

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Idempotency: a double-clicked button must not create two sessions.
      "Idempotency-Key": `checkout:${userId}:${plan}:${Math.floor(Date.now() / 60000)}`,
    },
    body: form,
  });

  if (!r.ok) {
    console.error("[stripe] checkout failed", await r.text());
    return new Response("checkout_failed", { status: 502, headers: cors });
  }
  const session = await r.json();
  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
