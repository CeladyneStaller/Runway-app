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

**Supabase verifies a JWT on every function call by default, and it must be OFF for ALL FOUR of
these functions.** Not just the webhook. This is the setting that will cost you an afternoon.

**Stripe does not send a JWT**, so a webhook deployed normally returns 401 to every event Stripe ever
sends. In the Stripe dashboard that looks like the endpoint failing, and it retries for days. The
signature verification never runs, because the request is rejected before reaching your code.

**Browsers do not send one either — on the PREFLIGHT.** This is the part that is easy to get wrong,
because the reasoning that leads there sounds right: checkout and portal need to know who is asking,
so surely leave the check on? No. A CORS preflight is an `OPTIONS` request that by specification
carries no `Authorization` header, so the gateway rejects it with a 401 before your `OPTIONS` handler
runs, and the browser reports:

```
Response to preflight request doesn't pass access control check: It does not have HTTP ok status.
```

The function is then unreachable from the browser entirely. Nothing appears in its logs, because
nothing ran.

**Turning the gateway check off does not make these functions unauthenticated.** Each one verifies
the caller itself, against `/auth/v1/user`, and returns 401 without a valid token — see `callerId()`
in `stripe-checkout` and the equivalent in `stripe-portal` and `delete-account`. That check is
STRONGER than the gateway's, which only proves *some* valid token was presented; these need to know
*which user*, and they have to ask anyway. All the gateway adds is a preflight that cannot pass.

**In `supabase/config.toml`** — add these to your existing file, do not replace it. This repo does
not ship a `config.toml` on purpose: yours contains your `project_id`, and an archive that overwrote
it would unlink your project.

```toml
[functions.stripe-webhook]
verify_jwt = false

[functions.stripe-checkout]
verify_jwt = false

[functions.stripe-portal]
verify_jwt = false

[functions.delete-account]
verify_jwt = false

[functions.qbo-connect]
verify_jwt = false

[functions.qbo-callback]
verify_jwt = false

[functions.qbo-sync]
verify_jwt = false

[functions.qbo-disconnect]
verify_jwt = false

[functions.qbo-refresh]
verify_jwt = false
```

**`qbo-callback` and `qbo-refresh` are off for DIFFERENT reasons than the rest**, and it is worth
knowing which is which. The browser-facing ones verify the caller against `/auth/v1/user` themselves.
`qbo-callback` has NO caller to verify — Intuit redirects a browser there with no session — and is
guarded instead by an HMAC-signed `state` it issued itself (`_shared/oauth-state.js`).
`qbo-refresh` is not user-facing at all: it is gated by `x-cron-secret`, has no CORS headers on
purpose, and fails closed if the secret is unset.

**Per deploy** — works, but a flag is a thing somebody forgets on the next deploy, and the failure is
silent until somebody cannot pay you:

```bash
supabase functions deploy stripe-checkout --no-verify-jwt
```

**Or right now, without a redeploy:** Dashboard → Edge Functions → the function → Details →
turn off *Enforce JWT Verification*.

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

## hub-status

Serves **Waterline HQ**, a separate Vercel project — not part of the customer app, and not shipped in
its bundle.

⚠️ **IT AUTHENTICATES WITH THE CALLER'S SESSION, NOT A SHARED SECRET.** An earlier version read
`HUB_TOKEN` from a header, which meant anyone with the URL and the string was staff. It now reads the
same `Authorization` header every other function here reads and calls `is_staff()` — so **revoking
somebody is `delete from staff where user_id = ...`** rather than rotating a secret and telling
everybody.

`HUB_TOKEN` is no longer read by anything. Leave it or remove it.

⚠️ **DEPLOY `048_is_staff.sql` FIRST.** The function calls that RPC on every request; without it, every
call returns 401 and nothing in the response says why.

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

**POWERSHELL EATS THE QUOTES IN JSON SECRETS. Use an env file instead.** Windows PowerShell strips
embedded double quotes when passing arguments to a native executable, so

```powershell
supabase secrets set STRIPE_PRICE_IDS='{"solo":"price_123"}'      # DO NOT
```

stores `{solo:price_123}`. In `stripe-webhook` that parses defensively and every subscription
SILENTLY lands on `solo`; in `stripe-checkout` it used to throw at module scope, so the function never
booted and the browser reported it as a CORS failure. Two very different symptoms, one cause.

Put them in a file, where no shell touches them:

```
# stripe-secrets.env  — delete it afterwards; it is gitignored
STRIPE_PRICE_IDS={"solo":"price_123","advisor":"price_456","connected":"price_789"}
STRIPE_PRICE_MAP={"price_123":"solo","price_456":"advisor","price_789":"connected"}
```

```powershell
supabase secrets set --env-file stripe-secrets.env
```

The one-liner escape (`'{\"solo\":\"price_123\"}'`) also works and is easy to get subtly wrong.

**You cannot read a secret back** — `supabase secrets list` shows names and a digest, not values — so
verify by what the function LOGS on boot, never by inspecting the secret.

PowerShell also does not take the backslash continuations above — put it on one line, or use backticks.

**Which function reads what**, since they differ and a missing one fails in its own way:

| Secret | Used by | Missing means |
|---|---|---|
| `STRIPE_SECRET_KEY` | checkout, portal | 500 from the function |
| `STRIPE_WEBHOOK_SECRET` | webhook | every event rejected, logged `no_secret` — it FAILS CLOSED |
| `STRIPE_PRICE_IDS` | checkout | the plan cannot be priced; checkout refuses |
| `STRIPE_PRICE_MAP` | webhook | subscriptions silently land on `solo`, logged loudly |
| `SITE_URL` | checkout, portal | also the CORS origin — see below |
| `STRIPE_KEY` | hub-status | the hub's Stripe panel is empty |
| `VERCEL_TOKEN` | hub-status | the hub's deploy panel is empty |
| `VERCEL_PROJECT` | hub-status | as above |
| `VERCEL_TEAM_ID` | hub-status | as above |
| `ALLOWED_ORIGINS` | **delete-account** | **every browser call refused** — see below |

**QuickBooks secrets** (Stage 5 of `QBO-PLAN.md`):

**Three of these come FROM Intuit and three do not**, which is not obvious from a list of names.

| Secret | Where it comes from | Used by | Missing means |
|---|---|---|---|
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | **Intuit** — app → Keys & credentials, per environment | all five | `invalid_client` on every token call |
| `QBO_REDIRECT_URI` | **Intuit** — must match a registered redirect URI exactly | connect, callback | Intuit rejects the authorize request |
| `QBO_STATE_SECRET` | **you generate it** — see below | connect, callback | connect refuses to issue an unsigned state (500) |
| `QBO_CRON_SECRET` | **you generate it** | refresh | the keep-alive refuses everything — it FAILS CLOSED |
| `QBO_ENV` | **you choose** — `sandbox` or `production` | callback, sync | defaults to sandbox |

The two you generate are just long random strings:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`base64url` on purpose — no `+`, `/` or `=`, so no shell or env file can mangle them.

**The keep-alive needs THREE secrets in GITHUB, not in Supabase** — it is a scheduled job that calls
in from outside: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the same `QBO_CRON_SECRET` value you
set in Supabase. Repository → Settings → Secrets and variables → Actions. The workflow is
`.github/workflows/qbo-keepalive.yml`; run it once with **Run workflow** rather than waiting a month
to discover a typo.

**Supabase secrets are PROJECT-WIDE, not per-function.** `qbo-connect` signs the state and
`qbo-callback` verifies it, and both read the same `QBO_STATE_SECRET` from one `secrets set` — they
cannot drift apart. Rotating it fails any authorization already in flight (a ten-minute window) and
nothing else.

`QBO_REDIRECT_URI` must match the callback URL registered in the Intuit app EXACTLY —
`https://<ref>.supabase.co/functions/v1/qbo-callback`. `QBO_STATE_SECRET` should be a long random
string; it is the only thing standing between a stranger and attaching their QuickBooks to somebody
else's company.

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

**THE ADVISOR PLANS HAVE THEIR OWN MAPS**, and the separation is what routes a webhook event to the
right table. A company plan lands in `subscriptions` keyed on `company_id`; an advisor plan in
`advisor_subscriptions` keyed on `user_id`. One map holding both would force the kind to be inferred
from a plan NAME, and a rename would quietly start writing to the wrong table.

```
STRIPE_ADVISOR_PRICE_IDS={"advisor":"price_D","advisor_unlimited":"price_E"}
STRIPE_ADVISOR_PRICE_MAP={"price_D":"advisor","price_E":"advisor_unlimited"}
```

`stripe-checkout` and `stripe-portal` take a `kind` of `company` (default) or `advisor`. The advisor
path takes no company and skips the `can_edit` check — you are buying for yourself, so the verified
caller IS the authorisation.

**A price in BOTH maps is a misconfiguration.** The webhook checks the advisor map first, so it would be
billed as an advisor plan. Keep them disjoint.

**PRICE MAP KEYS CHANGED IN 024: `advisor` is now `collaborative`.** An advisor became a user attribute
rather than a plan, so the tier was renamed. Both maps and the Stripe products need the new key, or
checkout refuses with `not_configured` and the webhook silently files subscriptions as `solo`:

```
STRIPE_PRICE_IDS={"solo":"price_A","collaborative":"price_B","connected":"price_C"}
STRIPE_PRICE_MAP={"price_A":"solo","price_B":"collaborative","price_C":"connected"}
```

`plan_seats()` still answers 3 for a literal `advisor`, so an existing live subscription is not reduced
to zero seats by the rename — but nothing new should be sold under it.

**Checkout and the portal now take a `company_id`** and refuse without one, because a subscription
belongs to a company. Both verify `can_edit` first: otherwise anybody could open a session against any
company id and pay for a stranger's subscription, which is harmless to them and inexplicable forever
afterwards.

**The two price maps point in opposite directions on purpose.** The webhook receives a price ID and
needs the plan name; checkout receives a plan name and needs the price ID. One map would mean
inverting it at runtime in both directions, which is a lookup that can silently return `undefined`
and quietly downgrade somebody to `solo`.

---

## After every migration: `npm run verify:rpc`

Calls every RPC the migrations grant to a client role, once, with arguments that reach the body and
match nothing. **A refusal is a pass** — `delete_company` on a random uuid raising `forbidden` means the
function parsed, planned and executed, which is the only question. What it is hunting is the other kind
of answer: `42702` ambiguous column, `42703` undefined column, `42883` undefined function, a 404 meaning
the migration was never applied.

It exists because `test/engine/migrations.test.js` reads SQL and cannot catch anything that only
happens when a function RUNS. `accept_invitation` was created without complaint and failed on its first
call — an OUT parameter shadowing a column — because plpgsql resolves names at call time. Nothing short
of calling it would have found that.

Eleven functions are skipped by name, each with a reason, because a random uuid does not protect you
from a function that takes no id.

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

**`preflight ... does not have HTTP ok status` in the browser, with nothing in the function logs, is
the same fault** wearing different clothes: the gateway refused the `OPTIONS` request. Distinguish it
from a genuine origin mismatch by whether the function logged anything at all — if it ran and merely
refused the origin, the request appears in the logs; if `verify_jwt` blocked it, nothing does.

A **CORS error in the browser with clean function logs** is the mirror image of that, and means an
origin mismatch: `ALLOWED_ORIGINS` for `delete-account`, `SITE_URL` for checkout and portal. The
request reached the function and the answer was thrown away on the doorstep.
