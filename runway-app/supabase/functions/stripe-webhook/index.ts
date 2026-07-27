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
// PARSED DEFENSIVELY, because this runs at MODULE SCOPE. A bare JSON.parse here throws before
// Deno.serve is ever reached, so one malformed character in a secret kills the whole function with an
// opaque WORKER_ERROR — no logs, no signature check, nothing to debug against. A bad map should cost
// you correct plan names, not the endpoint.
function readPriceMap(): Record<string, string> {
  const raw = Deno.env.get("STRIPE_PRICE_MAP");
  if (!raw) { console.warn("[stripe] STRIPE_PRICE_MAP unset — every plan will read as 'solo'"); return {}; }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, string>;
  } catch (e) {
    console.error("[stripe] STRIPE_PRICE_MAP is not valid JSON, ignoring it:", (e as Error).message);
    console.error('[stripe] expected: {"price_123":"solo","price_456":"advisor"}');
    return {};
  }
}
const PRICE_MAP = readPriceMap();

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
        // An unrecognised price means a product created without updating the map, or an event from
        // a price we do not sell. Falling back silently bills somebody as Solo and looks like it
        // worked; say so instead.
        const plan = PRICE_MAP[priceId];
        if (!plan) console.error("[stripe] price not in STRIPE_PRICE_MAP, defaulting to solo:", priceId);
        const periodEnd = obj.current_period_end
          ? new Date(obj.current_period_end * 1000).toISOString() : null;

        // `deleted` means gone now, whatever the object says.
        const status = event.type === "customer.subscription.deleted" ? "canceled" : obj.status;

        // APPLIED THROUGH AN RPC, not a table upsert. An earlier version put the staleness guard in
        // a PostgREST `or=` filter on the insert — filters do not apply to INSERTs, so PostgREST
        // rejected every event and the handler 500'd. Postgres's `on conflict do update ... where`
        // is the right tool and does it atomically.
        const res = await sql("rpc/apply_subscription_event", {
          method: "POST",
          body: JSON.stringify({
            p_user_id: userId,
            p_status: status,
            p_plan: plan || "solo",
            p_period_end: periodEnd,
            p_customer_id: obj.customer ?? null,
            p_sub_id: obj.id ?? null,
            p_event_id: event.id,
            p_event_at: new Date(event.created * 1000).toISOString(),
          }),
        });
        if (!res.ok) throw new Error(`apply failed ${res.status}: ${await res.text()}`);
        // `false` means the event was older than what we hold and was correctly ignored. Still a 200:
        // returning an error would make Stripe retry a duplicate forever.
        if ((await res.json()) === false) console.log("[stripe] ignored stale event", event.id);
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
