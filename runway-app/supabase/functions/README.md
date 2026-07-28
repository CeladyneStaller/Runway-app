# Edge Functions

Each directory here becomes one function. Directories starting with `_` do not — `_shared/` is
imported by the others and is bundled automatically.

| Function | Called by | JWT |
|---|---|---|
| `delete-account` | the app | required |
| `stripe-checkout` | the app | required |
| `stripe-portal` | the app | required |
| `stripe-webhook` | **Stripe** | **must be OFF** |

---

## The one that will catch you

**Supabase verifies a JWT on every function call by default. Stripe does not send one.**

So a webhook deployed normally returns **401 to every event Stripe ever sends**. In the Stripe
dashboard this looks like the endpoint failing, and it will keep retrying and failing for days. The
signature verification you are about to test never even runs, because the request is rejected before
reaching your code.

Two ways to switch it off. Prefer the config file — a deploy flag is a thing somebody forgets on the
next deploy, and the failure is silent until you check Stripe's event log.

**In `supabase/config.toml`** (add to your existing file, do not replace it):

```toml
[functions.stripe-webhook]
verify_jwt = false
```

**Or per deploy:**

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

Leave it ON for `stripe-checkout` and `stripe-portal`. Those are called by the browser and the JWT is
how they know who is asking — without it, anyone could open a checkout or a billing portal as anybody.

---

## Deploy

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy stripe-checkout
supabase functions deploy stripe-portal
```

They appear in **Dashboard → Edge Functions**, each with an invoke URL of the form:

```
https://<project-ref>.supabase.co/functions/v1/stripe-webhook
```

That URL is what you register in **Stripe → Developers → Webhooks**, subscribed to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`

---

## Secrets

Set once, in **Dashboard → Edge Functions → Secrets**, or:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  SITE_URL=https://runway-app-two.vercel.app \
  ALLOWED_ORIGINS=https://runway-app-two.vercel.app \
  STRIPE_PRICE_MAP='{"price_AAA":"solo","price_BBB":"advisor","price_CCC":"connected"}' \
  STRIPE_PRICE_IDS='{"solo":"price_AAA","advisor":"price_BBB","connected":"price_CCC"}'
```

PowerShell does not take the backslash continuations — put it on one line, or use backticks.

**Which function reads what**, since they differ and a missing one fails in its own way:

| Secret | Used by | Missing means |
|---|---|---|
| `STRIPE_SECRET_KEY` | checkout, portal | 500 from the function |
| `STRIPE_WEBHOOK_SECRET` | webhook | every event rejected, logged `no_secret` — it FAILS CLOSED |
| `STRIPE_PRICE_IDS` | checkout | the plan cannot be priced; checkout refuses |
| `STRIPE_PRICE_MAP` | webhook | subscriptions silently land on `solo`, logged loudly |
| `SITE_URL` | checkout, portal | also the CORS origin — see below |
| `ALLOWED_ORIGINS` | **delete-account** | **every browser call refused** — see below |

**`ALLOWED_ORIGINS` is REQUIRED for `delete-account`, comma-separated, no trailing slash.** The
allow-list FAILS CLOSED: unset means nothing is allowed, and the function logs
`[delete-account] ALLOWED_ORIGINS is not set` once per isolate. It used to fail OPEN — an empty list
echoed whatever origin asked — which is the state every fresh deployment starts in. A literal `*` is
dropped rather than honoured, so "allow everything" is not expressible. Rule and tests:
`_shared/cors.js`, `test/engine/cors.test.js`.

**`SITE_URL` does double duty** for checkout and portal: it is the redirect target AND the literal
`Access-Control-Allow-Origin`. If it does not exactly match the browser's origin — trailing slash, a
`www`, a per-deployment Vercel host — the function succeeds and the browser discards the response.
That presents as "the button does nothing", with clean function logs.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically —
do not set them yourself.

**The two price maps point in opposite directions on purpose.** The webhook receives a price ID and
needs the plan name; checkout receives a plan name and needs the price ID. One map would mean
inverting it at runtime in both directions, which is a lookup that can silently return `undefined`
and quietly downgrade somebody to `solo`.

---

## Testing the webhook

**Start with `npm run stripe:test-event`** — it builds the payload this handler expects, signs it the
way Stripe does, and posts it at the deployed URL. `stripe trigger` sends a subscription with NO
`metadata.user_id`, because that field is attached by our own checkout function, so it exercises
everything EXCEPT the database write. Needs `WEBHOOK_URL`, `STRIPE_WEBHOOK_SECRET`, `TEST_USER_ID`
and `TEST_PRICE_ID`; takes an optional status (`npm run stripe:test-event -- canceled`).

**`npm run stripe:test-event -- --print`** emits the body on one line plus a matching
`Stripe-Signature` instead of sending, for the Dashboard's function test panel. Method POST, no query
parameters, no `Authorization` header. Paste the body EXACTLY — the panel's editor reformatting it
changes the bytes and the signature no longer matches — and within five minutes, or it fails with
`timestamp_outside_tolerance`.

For real Stripe payload shapes:

```bash
stripe listen --forward-to https://<project-ref>.supabase.co/functions/v1/stripe-webhook
stripe trigger customer.subscription.created
```

**`stripe listen` prints its OWN signing secret, and it is not the one from the Dashboard endpoint.**
Using the wrong one is the most common cause of `no_matching_signature`. Set `STRIPE_WEBHOOK_SECRET`
to whichever source you are currently testing with.

Watch the logs in **Dashboard → Edge Functions → stripe-webhook → Logs**. Rejections are logged as
`[stripe] rejected: <reason>`, and the reason distinguishes a bad secret (`no_matching_signature`)
from a replay (`timestamp_outside_tolerance`) from a missing secret (`no_secret`).

A `401` in Stripe's event log and **nothing at all** in the function logs means `verify_jwt` is still on.

A **CORS error in the browser with clean function logs** is the mirror image of that, and means an
origin mismatch: `ALLOWED_ORIGINS` for `delete-account`, `SITE_URL` for checkout and portal. The
request reached the function and the answer was thrown away on the doorstep.
