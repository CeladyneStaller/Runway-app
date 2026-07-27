// Stripe webhook signature verification, by hand.
//
// NO STRIPE SDK, for the same reason we do not use @sentry/browser: the SDK's `constructEvent` uses
// synchronous Node crypto and does not run in Deno, and its async twin has a different name that is
// easy to get wrong silently. The algorithm is twenty lines and documented, so verifying it ourselves
// removes a dependency, a runtime incompatibility, and a class of misconfiguration.
//
// THIS IS THE SECURITY BOUNDARY OF THE ENTIRE BILLING SYSTEM. Anyone on the internet can POST to a
// webhook endpoint. If this function is wrong, somebody grants themselves a subscription by sending
// us JSON. Everything downstream trusts what this returns.

const enc = new TextEncoder();

/** `t=1699999999,v1=abc...,v0=def...` -> { t, v1: [...] }. Multiple v1 signatures appear while an
 *  endpoint secret is being rotated, and ANY of them matching is a valid event. */
export function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header || "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") out.t = Number(v);
    else if (k === "v1") out.v1.push(v);
  }
  return out;
}

const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

/** CONSTANT TIME. A plain === leaks how many leading characters matched, which is enough to forge a
 *  signature one byte at a time given enough attempts. Length is compared first and the loop always
 *  runs to completion. */
export function timingSafeEqual(a, b) {
  const A = enc.encode(String(a)), B = enc.encode(String(b));
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

/**
 * Verify a Stripe webhook.
 *
 * @param rawBody  the request body EXACTLY as sent — never a re-serialised object. JSON.stringify of
 *                 a parsed body reorders keys and changes whitespace, and the signature then fails
 *                 for a completely legitimate event.
 * @param header   the `Stripe-Signature` header
 * @param secret   the endpoint's `whsec_...`
 * @param toleranceSec  replay window. Stripe's own default is 5 minutes: without it, a signature
 *                 captured once stays valid forever and can be replayed to re-apply an old event.
 */
export async function verifyStripeSignature(rawBody, header, secret, {
  toleranceSec = 300, now = () => Date.now(),
} = {}) {
  if (!secret) return { ok: false, reason: "no_secret" };
  const { t, v1 } = parseSignatureHeader(header);
  if (!t || !Number.isFinite(t) || v1.length === 0) return { ok: false, reason: "malformed_header" };

  const ageSec = Math.abs(now() / 1000 - t);
  if (ageSec > toleranceSec) return { ok: false, reason: "timestamp_outside_tolerance" };

  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));

  // Any listed v1 may match — Stripe sends several during a secret rotation.
  for (const sig of v1) if (timingSafeEqual(sig, expected)) return { ok: true };
  return { ok: false, reason: "no_matching_signature" };
}
