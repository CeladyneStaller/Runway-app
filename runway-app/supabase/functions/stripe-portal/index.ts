// Opens the Stripe Customer Portal so people manage their own subscription — change plan, update a
// card, cancel, download invoices. Nothing here is built by us; that is the point.
import { corsHeaders } from "../_shared/cors.js";
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";

const cors = corsHeaders(SITE_URL, [SITE_URL]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!jwt) return new Response("unauthorized", { status: 401, headers: cors });

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!who.ok) return new Response("unauthorized", { status: 401, headers: cors });
  const userId = (await who.json())?.id;

  // A SUBSCRIPTION BELONGS TO A COMPANY (024), so the portal is opened for one — and the caller must be
  // able to edit it. Without that check, anybody could name any company id and reach the billing
  // account of whoever pays for it.
  const { company_id: companyId, kind = "company" } = await req.json().catch(() => ({}));
  const advisor = kind === "advisor";

  // AN ADVISOR MANAGES THEIR OWN PLAN, so there is no company and nothing to be permitted: the verified
  // caller IS the subject. The company path below needs the check because it opens somebody else's
  // billing account.
  if (advisor) {
    const row = await fetch(`${SUPABASE_URL}/rest/v1/rpc/advisor_stripe_customer`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
                 "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: userId }),
    });
    const customer = row.ok ? await row.json() : null;
    if (!customer || typeof customer !== "string") {
      return new Response("no_subscription", { status: 404, headers: cors });
    }
    return await openPortal(customer);
  }

  if (!companyId) return new Response("company_required", { status: 400, headers: cors });

  const allowed = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_edit`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: req.headers.get("Authorization")!,
               "Content-Type": "application/json" },
    body: JSON.stringify({ c: companyId }),
  });
  if (!allowed.ok || (await allowed.json()) !== true) {
    return new Response("forbidden", { status: 403, headers: cors });
  }

  // THE CUSTOMER ID COMES FROM OUR DATABASE, never from the request. Accepting one from the client
  // would let anybody open a portal session for anybody else's billing account.
  //
  // Read through an RPC rather than off the table, for the reason `qbo-sync` learned the hard way: a
  // direct PostgREST read depends on a grant that a later `revoke` can quietly remove, and the failure
  // arrives as an error object that `?.[0]` turns into "no subscription".
  const row = await fetch(`${SUPABASE_URL}/rest/v1/rpc/company_stripe_customer`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               "Content-Type": "application/json" },
    body: JSON.stringify({ p_company_id: companyId }),
  });
  const customer = row.ok ? await row.json() : null;
  if (!customer || typeof customer !== "string") {
    console.error(`[stripe-portal] no customer for ${companyId}: ${row.status}`);
    return new Response("no_subscription", { status: 404, headers: cors });
  }

  return await openPortal(customer);
});

/** One place that talks to Stripe, because a company plan and an advisor plan open the SAME portal —
 *  only the customer differs. Two copies would be two chances for the return URL to drift. */
async function openPortal(customer: string) {
  const cors2 = cors;
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
    return new Response("portal_failed", { status: 502, headers: cors2 });
  }
  return new Response(JSON.stringify({ url: (await r.json()).url }), {
    headers: { ...cors2, "Content-Type": "application/json" },
  });
}
