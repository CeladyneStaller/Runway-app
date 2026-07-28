// CORS for the Edge Functions the browser calls directly.
//
// PLAIN .js, like `stripe-signature.js` and for the same reason: a rule this consequential should be
// unit-testable by the ordinary suite. `index.ts` files import Deno globals and remote modules from
// esm.sh, so nothing in them can be reached from vitest — which is exactly how the bug below survived
// review. Tested in `test/engine/cors.test.js`.
//
// IT FAILS CLOSED, and that is the whole point of the module. The version this replaces read:
//
//     const allow = origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))
//                 ? origin : "";
//
// — so an UNSET `ALLOWED_ORIGINS` secret echoed whatever origin asked, which is the opposite of what
// the comment two lines above it promised, and the state every deployment starts in. An allow-list
// that permits everything until configured is not an allow-list; it is a deferred decision that
// nobody comes back to, because nothing is broken while it is wrong.
//
// WE NEVER SEND `*`. A wildcard would let any page on the internet call these endpoints, and
// `delete-account` deletes an account. Note that CORS is not the load-bearing control there — the
// caller still needs a bearer token a cross-origin page cannot read — but a control that contradicts
// its own comment is worse than no control, because it is the one people stop checking.

/** `"https://a.com, https://b.com"` -> `["https://a.com", "https://b.com"]`.
 *
 *  Trailing slashes are stripped and the value is lower-cased, because an ORIGIN has no path and is
 *  case-insensitive in scheme and host — so `https://App.Example.com/` and `https://app.example.com`
 *  are the same origin, while a string comparison says otherwise. `.env.example` already records this
 *  trap for Supabase's own redirect allow-list, where the failure is likewise silent. */
export function parseOrigins(raw) {
  return String(raw ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase().replace(/\/+$/, ""))
    // A literal `*` is DROPPED rather than honoured. It is not an origin, and somebody who sets
    // `ALLOWED_ORIGINS=*` means "allow everything" — which is the one answer this module exists to
    // refuse. Dropping it lands on an empty list, so the deployment is loudly refused (the caller
    // logs that the secret is unset) instead of quietly wide open. Found by the test that asserts a
    // wildcard is never sent, for any input, which failed on exactly this.
    .filter(s => s && s !== "*");
}

/** The origin to echo back, or "" for "send no CORS header at all".
 *
 *  Empty list -> nothing is allowed. Missing origin -> nothing to allow. */
export function allowedOrigin(origin, allowList) {
  if (!origin || !Array.isArray(allowList) || allowList.length === 0) return "";
  const o = String(origin).trim().toLowerCase().replace(/\/+$/, "");
  // The no-wildcard rule is enforced HERE as well as in `parseOrigins`, because this is the function
  // that decides what goes in the header and an allow-list can be built without the parser. A test
  // asserting "never a wildcard, for any input" failed against the parse-time check alone.
  if (o === "*") return "";
  return allowList.includes(o) ? origin : "";
}

/** Headers for a browser-facing function. The `Access-Control-Allow-Origin` key is ABSENT rather than
 *  empty when the origin is refused: an empty header value is a header, and browsers treat the two
 *  differently. `Vary: Origin` is always sent so a proxy cannot cache one caller's answer for another. */
export function corsHeaders(origin, allowList, methods = "POST, OPTIONS") {
  const allow = allowedOrigin(origin, allowList);
  return {
    ...(allow ? { "Access-Control-Allow-Origin": allow } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
}
