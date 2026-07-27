// Creates a Stripe Checkout Session for the signed-in user.
//
// Called from the browser with the user's Supabase JWT. The SECRET KEY never leaves this function.
// We do not build card fields: Checkout is hosted, which keeps this out of PCI scope entirely.
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";
const PRICE_MAP: Record<string, string> = JSON.parse(Deno.env.get("STRIPE_PRICE_IDS") || "{}");

const cors = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, content-type",
};

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

  const { plan } = await req.json().catch(() => ({}));
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
    // attributed to a user. Without it, a renewal three months from now is unattributable.
    client_reference_id: userId,
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
