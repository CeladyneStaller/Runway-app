#!/usr/bin/env node
// Send a correctly-signed subscription event straight at the deployed webhook.
//
//   WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/stripe-webhook \
//   STRIPE_WEBHOOK_SECRET=whsec_... \
//   TEST_USER_ID=<supabase user uuid> \
//   TEST_PRICE_ID=price_...            \
//   node scripts/stripe-test-event.mjs [status]
//
// WHY THIS EXISTS. `stripe trigger` sends a generic subscription with NO metadata.user_id, because
// that field is attached by our own checkout function — so it exercises everything except the
// database write, which is the part most likely to be wrong. This builds the payload our handler
// actually expects, signs it the way Stripe does, and posts it.
//
// It is a TEST TOOL, not part of the app. It proves the round trip: signature accepted, event
// parsed, row upserted, entitlement recomputed.
import { createHmac } from "node:crypto";

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };

const url = need("WEBHOOK_URL");
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
const status = process.argv[2] || "active";

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
} else if (res.status === 500) {
  console.log("\n500 means the signature VERIFIED and the handler ran — everything hard is working.");
  console.log("It failed at the database. Look at Supabase -> Edge Functions -> stripe-webhook -> Logs");
  console.log("for the real error. Usual causes: migration 009 not applied, or the user does not exist.");
} else if (res.status === 400) {
  console.log("\n400 means the signature was refused — check STRIPE_WEBHOOK_SECRET matches the");
  console.log("endpoint you are testing. Live, test and `stripe listen` each have a DIFFERENT one.");
}
