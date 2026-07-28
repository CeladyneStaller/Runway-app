// Opens the Stripe Customer Portal so people manage their own subscription — change plan, update a
// card, cancel, download invoices. Nothing here is built by us; that is the point.
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";

const cors = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!jwt) return new Response("unauthorized", { status: 401, headers: cors });

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!who.ok) return new Response("unauthorized", { status: 401, headers: cors });
  const userId = (await who.json())?.id;

  // THE CUSTOMER ID COMES FROM OUR DATABASE, never from the request. Accepting one from the client
  // would let anybody open a portal session for anybody else's billing account.
  const row = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?select=stripe_customer_id&user_id=eq.${userId}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const customer = (await row.json())?.[0]?.stripe_customer_id;
  if (!customer) return new Response("no_subscription", { status: 404, headers: cors });

  const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ customer, return_url: `${SITE_URL}/#account` }),
  });
  if (!r.ok) {
    console.error("[stripe] portal failed", await r.text());
    return new Response("portal_failed", { status: 502, headers: cors });
  }
  return new Response(JSON.stringify({ url: (await r.json()).url }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
