// The OAuth `state` parameter, signed.
//
// THE CALLBACK IS THE ONLY UNAUTHENTICATED ENTRY POINT IN THIS PRODUCT. Intuit sends the browser
// there as a top-level redirect: no session, no `Authorization` header, no CORS preflight, nothing
// that identifies the caller except what we put in `state` and get back. So `state` has to carry the
// company being connected AND be impossible to forge — otherwise anyone who can make somebody's
// browser hit the callback can attach THEIR QuickBooks to YOUR company, or yours to theirs.
//
// Signed rather than stored. A pending-state table would work and would need its own row lifecycle,
// its own cleanup, and its own RLS; an HMAC needs a secret we already have to have. The payload is
// not secret — it is a company id the user already knows — it only has to be unforgeable and fresh.
//
// Plain `.js` alongside `stripe-signature.js`, for the same reason: this is a security boundary and
// an `index.ts` cannot be reached by the test suite. Tested in `test/engine/oauth-state.test.js`.

import { timingSafeEqual } from "./stripe-signature.js";

const enc = new TextEncoder();

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64url = (s) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" },
                                            false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** `{companyId, userId}` -> `payload.signature`, valid for `ttlSeconds`. */
export async function signState(payload, secret, { ttlSeconds = 600, now = Date.now } = {}) {
  if (!secret) throw new Error("signState needs a secret");
  const body = { ...payload, exp: Math.floor(now() / 1000) + ttlSeconds };
  const json = b64url(enc.encode(JSON.stringify(body)));
  return `${json}.${b64url(await hmac(secret, json))}`;
}

/** Returns `{ ok: true, payload }` or `{ ok: false, reason }`. Never throws on bad input: this is
 *  called with whatever arrived in a query string. */
export async function verifyState(state, secret, { now = Date.now } = {}) {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (typeof state !== "string" || !state.includes(".")) return { ok: false, reason: "malformed" };

  const [json, sig] = state.split(".");
  if (!json || !sig) return { ok: false, reason: "malformed" };

  let expected;
  try {
    expected = b64url(await hmac(secret, json));
  } catch { return { ok: false, reason: "malformed" }; }

  // CONSTANT TIME, and the signature is checked BEFORE the payload is parsed. Parsing first would
  // mean acting on attacker-controlled JSON — and leaking, through timing, how far it got.
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "bad_signature" };

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(unb64url(json))); }
  catch { return { ok: false, reason: "malformed" }; }

  // SHORT-LIVED ON PURPOSE. A signed state that never expires is a replayable authorization link
  // sitting in a browser history and a server log, and ten minutes is longer than any consent screen.
  if (!payload?.exp || payload.exp * 1000 < now()) return { ok: false, reason: "expired" };
  if (!payload.companyId) return { ok: false, reason: "no_company" };

  return { ok: true, payload };
}
