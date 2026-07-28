#!/usr/bin/env node
// Send a correctly-signed subscription event straight at the deployed webhook.
//
//   WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/stripe-webhook \
//   STRIPE_WEBHOOK_SECRET=whsec_... \
//   TEST_USER_ID=<supabase user uuid> \
//   TEST_PRICE_ID=price_...            \
//   node scripts/stripe-test-event.mjs [status] [--print]
//
// `--print` emits the body and the matching Stripe-Signature INSTEAD of sending, for pasting into
// Dashboard -> Edge Functions -> stripe-webhook -> the test panel. WEBHOOK_URL is not needed then.
// Via npm the flag needs a separator: `npm run stripe:test-event -- --print`.
//
// WHY THIS EXISTS. `stripe trigger` sends a generic subscription with NO metadata.user_id, because
// that field is attached by our own checkout function — so it exercises everything except the
// database write, which is the part most likely to be wrong. This builds the payload our handler
// actually expects, signs it the way Stripe does, and posts it.
//
// It is a TEST TOOL, not part of the app. It proves the round trip: signature accepted, event
// parsed, row upserted, entitlement recomputed.
import { createHmac } from "node:crypto";
// The SAME verifier the deployed function runs, imported rather than reimplemented. This script signs
// with node's `createHmac` while production verifies with WebCrypto, so the two could drift and the
// only symptom would be a tool that hands you pairs the server rejects — indistinguishable from a
// misconfigured secret, which is the thing this script exists to rule out. It self-checks below.
import { verifyStripeSignature } from "../supabase/functions/_shared/stripe-signature.js";

const args = process.argv.slice(2);
const PRINT = args.includes("--print");
// First non-flag argument, so `--print canceled` and `canceled --print` both work.
const status = args.find((a) => !a.startsWith("-")) || "active";

// UNKNOWN FLAGS ARE FATAL. `-print` with one dash is not `--print`: the parser would treat it as a
// flag, silently leave PRINT false, and SEND the event — the failure being guarded against here, one
// keystroke away and quieter.
const UNKNOWN = args.filter((a) => a.startsWith("-") && a !== "--print");
if (UNKNOWN.length) {
  console.error(`Unknown option: ${UNKNOWN.join(" ")}`);
  console.error("This script accepts --print, and npm needs a separator:");
  console.error("  npm run stripe:test-event -- --print");
  process.exit(2);
}

// VALIDATE THE STATUS TOO, for the reason the UUID check above exists: an unrecognised value is not
// rejected anywhere downstream. `p_status` is a plain text column, so a typo — or an unsupported flag
// falling through to this positional, which is how `status=--print` once reached the database — is
// stored verbatim and read back by the billing UI. It does not even break entitlement, because
// `company_entitled` also accepts `current_period_end > now()`, so the junk sits there looking fine.
const STRIPE_STATUSES = ["active", "past_due", "unpaid", "canceled", "incomplete",
                         "incomplete_expired", "trialing", "paused"];
if (!STRIPE_STATUSES.includes(status)) {
  console.error(`Not a Stripe subscription status: ${status}`);
  if (status.startsWith("-")) {
    console.error("That looks like a flag. This script accepts --print, and npm needs a separator:");
    console.error("  npm run stripe:test-event -- --print");
  }
  console.error(`Valid: ${STRIPE_STATUSES.join(", ")}`);
  process.exit(2);
}

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };

// Not needed when printing: there is nowhere to send it. Demanding it anyway would make the offline
// half of this tool require the one value you do not have until the function is deployed.
const url = PRINT ? null : need("WEBHOOK_URL");
const secret = need("STRIPE_WEBHOOK_SECRET");
const userId = need("TEST_USER_ID");

// VALIDATE BEFORE SENDING. `user_id` is a uuid column with a foreign key, so anything malformed comes
// back as an opaque 500 from the handler's catch — which looks like a webhook bug and is not one.
// The specific trap: pasting the placeholder brackets from the instructions along with the value.
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
  console.error(`TEST_USER_ID is not a UUID: ${userId}`);
  if (/^<.*>$/.test(userId)) console.error("It still has the < > placeholder brackets around it.");
  console.error("Copy it from Supabase -> Authentication -> Users, with no surrounding characters.");
  process.exit(2);
}
const priceId = process.env.TEST_PRICE_ID || "price_test_placeholder";
const now = Math.floor(Date.now() / 1000);
const event = {
  id: `evt_test_${now}`,
  object: "event",
  api_version: "2024-06-20",
  created: now,
  type: status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated",
  data: {
    object: {
      id: `sub_test_${userId.slice(0, 8)}`,
      object: "subscription",
      customer: `cus_test_${userId.slice(0, 8)}`,
      status,
      // THE FIELD `stripe trigger` CANNOT PRODUCE. Our checkout function sets it so that renewals
      // months later — which never mention the checkout session — remain attributable to a user.
      metadata: { user_id: userId },
      current_period_end: now + 30 * 86400,
      items: { object: "list", data: [{ id: "si_test", price: { id: priceId } }] },
    },
  },
};

const body = JSON.stringify(event);
const sig = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");

// SELF-CHECK. Refuse to hand over a pair that will not verify: an invalid signature printed here
// would be debugged as a server problem, in the one place where the server is not involved yet.
const check = await verifyStripeSignature(body, `t=${now},v1=${sig}`, secret);
if (!check.ok) {
  console.error(`Refusing to emit an unverifiable signature: ${check.reason}`);
  process.exit(1);
}

if (PRINT) {
  console.log("--- BODY (one line, paste EXACTLY — any reformatting breaks the signature) ---");
  console.log(body);
  console.log("\n--- HEADERS ---");
  console.log("Content-Type: application/json");
  console.log(`Stripe-Signature: t=${now},v1=${sig}`);
  console.log("\n--- NOTES ---");
  console.log("Method POST. No query parameters. No Authorization header (verify_jwt is off).");
  // The pair is perishable, and a stale one fails with `timestamp_outside_tolerance` — which reads
  // like a broken secret to anyone who has not been told this.
  console.log(`This pair EXPIRES at ${new Date((now + 300) * 1000).toLocaleTimeString()} ` +
              "(5-minute replay window). Re-run for a fresh one.");
  console.log(`Expect: 200 {"received":true}   status=${status} user=${userId}`);
  process.exit(0);
}

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${now},v1=${sig}` },
  body,
});

console.log(`${res.status}  ${await res.text()}`);
console.log(`\nsent ${event.type} status=${status} user=${userId}`);

if (res.status === 200) {
  console.log("\nAccepted. Now confirm the row landed:");
  console.log(`  select * from subscriptions where user_id = '${userId}';`);
  console.log(`  select company_entitled(id), name from companies;`);
} else if (res.status === 401) {
  console.log("\n401 means verify_jwt is still ON. Redeploy with --no-verify-jwt.");
} else if (res.status === 500 && /WORKER_ERROR/.test(await Promise.resolve(""))) {
} else if (res.status === 500) {
  console.log("\nIf the body says WORKER_ERROR, the function CRASHED AT LOAD — before any of our");
  console.log("code ran, so this says nothing about the signature. Usual cause: a secret that is");
  console.log("read at module scope is malformed (STRIPE_PRICE_MAP must be valid JSON).");
  console.log("\nIf the body says handler_failed, the signature VERIFIED and the handler ran —");
  console.log("It failed at the database. Look at Supabase -> Edge Functions -> stripe-webhook -> Logs");
  console.log("for the real error. Usual causes: migration 009 not applied, or the user does not exist.");
} else if (res.status === 400) {
  console.log("\n400 means the signature was refused — check STRIPE_WEBHOOK_SECRET matches the");
  console.log("endpoint you are testing. Live, test and `stripe listen` each have a DIFFERENT one.");
}
