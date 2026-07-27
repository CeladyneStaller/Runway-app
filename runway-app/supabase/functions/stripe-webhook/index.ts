// Stripe -> Postgres. The only thing that writes `subscriptions`.
//
// Runs on the SERVICE ROLE, which bypasses RLS. That is deliberate and is why `subscriptions` has no
// insert or update policy at all: a user cannot grant themselves a plan even having found the table.
//
// THREE THINGS THIS MUST GET RIGHT:
//   1. VERIFY FIRST. Anyone can POST here. Nothing is parsed or trusted before the signature checks.
//   2. BE IDEMPOTENT. Stripe retries on any non-2xx, and at-least-once delivery is guaranteed while
//      exactly-once is not. Applying the same event twice must be harmless.
//   3. IGNORE STALE EVENTS. Delivery order is NOT guaranteed. A `subscription.updated` from before a
//      cancellation can arrive after it, and applying it blindly resurrects a dead subscription.
//      Every write compares `event.created` against what is stored and drops anything older.
import { verifyStripeSignature } from "../_shared/stripe-signature.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// Which Stripe price maps to which of our plans. Set as a JSON object in the function's secrets:
//   {"price_1AAA":"solo","price_1BBB":"advisor","price_1CCC":"connected"}
// Kept OUT of the code so adding an annual price is a config change, not a deploy.
const PRICE_MAP: Record<string, string> = JSON.parse(Deno.env.get("STRIPE_PRICE_MAP") || "{}");

const sql = async (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

/** Our user id, from whichever place Checkout put it. `client_reference_id` is set on the Checkout
 *  Session; `metadata.user_id` is copied onto the subscription itself so later lifecycle events —
 *  which never mention the session — can still be attributed. */
const userIdOf = (obj: any) =>
  obj?.metadata?.user_id || obj?.client_reference_id || null;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // RAW BODY, unmodified. Re-serialising a parsed object reorders keys and changes whitespace, and
  // the signature then fails for a perfectly legitimate event.
  const raw = await req.text();
  const check = await verifyStripeSignature(raw, req.headers.get("Stripe-Signature"), WEBHOOK_SECRET);
  if (!check.ok) {
    console.warn("[stripe] rejected:", check.reason);
    // 400, not 500: this is not retryable and Stripe should stop.
    return new Response(JSON.stringify({ error: check.reason }), { status: 400 });
  }

  const event = JSON.parse(raw);
  const obj = event?.data?.object ?? {};

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const userId = userIdOf(obj);
        if (!userId) {
          // Nothing to attribute this to. 200 so Stripe stops retrying something that will never
          // succeed, but loud, because it means Checkout was created without the metadata.
          console.error("[stripe] subscription with no user_id", obj.id);
          break;
        }

        const priceId = obj.items?.data?.[0]?.price?.id;
        const plan = PRICE_MAP[priceId] || "solo";
        const periodEnd = obj.current_period_end
          ? new Date(obj.current_period_end * 1000).toISOString() : null;

        // `deleted` means gone now, whatever the object says.
        const status = event.type === "customer.subscription.deleted" ? "canceled" : obj.status;

        const row = {
          user_id: userId,
          status,
          plan,
          current_period_end: periodEnd,
          stripe_customer_id: obj.customer ?? null,
          stripe_subscription_id: obj.id ?? null,
          last_event_id: event.id,
          last_event_at: new Date(event.created * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        };

        // UPSERT, then drop if stale. `merge-duplicates` makes a replay harmless, and the
        // `last_event_at` guard in the query string makes an out-of-order delivery harmless too:
        // an older event simply does not match and writes nothing.
        const res = await sql(
          `subscriptions?on_conflict=user_id&or=(last_event_at.is.null,last_event_at.lt.${row.last_event_at})`,
          { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(row) });
        if (!res.ok) throw new Error(`upsert failed ${res.status}: ${await res.text()}`);
        break;
      }

      // Dunning is Stripe's job (Smart Retries). We only care that the STATUS moved, which arrives
      // as a subscription.updated — so these are acknowledged and otherwise ignored on purpose.
      case "invoice.payment_failed":
      case "invoice.paid":
      case "customer.subscription.trial_will_end":
        break;

      default:
        // Unknown types are a 200. Returning an error makes Stripe retry forever for an event we
        // were never going to act on.
        break;
    }
  } catch (e) {
    // 500 so Stripe RETRIES. A database blip must not silently lose a subscription change.
    console.error("[stripe] handler failed", event.type, e);
    return new Response(JSON.stringify({ error: "handler_failed" }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
