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
  STRIPE_PRICE_MAP='{"price_AAA":"solo","price_BBB":"advisor","price_CCC":"connected"}' \
  STRIPE_PRICE_IDS='{"solo":"price_AAA","advisor":"price_BBB","connected":"price_CCC"}'
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically —
do not set them yourself.

**The two price maps point in opposite directions on purpose.** The webhook receives a price ID and
needs the plan name; checkout receives a plan name and needs the price ID. One map would mean
inverting it at runtime in both directions, which is a lookup that can silently return `undefined`
and quietly downgrade somebody to `solo`.

---

## Testing the webhook

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
