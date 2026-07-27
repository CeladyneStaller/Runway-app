// Webhook signature verification. This is the security boundary of billing: anyone on the internet
// can POST to the endpoint, and if this is wrong somebody grants themselves a subscription by
// sending us JSON. Everything downstream trusts what it returns.
import { describe, it, expect } from "vitest";
import { verifyStripeSignature, parseSignatureHeader, timingSafeEqual }
  from "../../supabase/functions/_shared/stripe-signature.js";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"customer.subscription.updated"}';
const NOW = 1793000000000;   // fixed clock
const at = (ms) => () => ms;

async function sign(body, secret, t) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const header = async (body = BODY, secret = SECRET, t = Math.floor(NOW / 1000)) =>
  `t=${t},v1=${await sign(body, secret, t)}`;

describe("accepting a genuine event", () => {
  it("verifies a correctly signed body", async () => {
    expect(await verifyStripeSignature(BODY, await header(), SECRET, { now: at(NOW) }))
      .toEqual({ ok: true });
  });

  it("accepts when ANY listed v1 matches — Stripe sends several during a secret rotation", async () => {
    const good = await sign(BODY, SECRET, Math.floor(NOW / 1000));
    const h = `t=${Math.floor(NOW / 1000)},v1=deadbeef,v1=${good}`;
    expect((await verifyStripeSignature(BODY, h, SECRET, { now: at(NOW) })).ok).toBe(true);
  });
});

describe("rejecting a forged one", () => {
  it("rejects a body signed with a different secret", async () => {
    const h = await header(BODY, "whsec_attacker");
    expect(await verifyStripeSignature(BODY, h, SECRET, { now: at(NOW) }))
      .toMatchObject({ ok: false, reason: "no_matching_signature" });
  });

  it("rejects a body that was altered after signing", async () => {
    const h = await header(BODY);
    const tampered = BODY.replace("evt_1", "evt_2");
    expect((await verifyStripeSignature(tampered, h, SECRET, { now: at(NOW) })).ok).toBe(false);
  });

  it("rejects a REPLAY outside the tolerance window", async () => {
    // Without this a signature captured once stays valid forever and can re-apply an old event —
    // for instance re-granting a subscription that was later cancelled.
    const h = await header(BODY, SECRET, Math.floor(NOW / 1000) - 400);
    expect(await verifyStripeSignature(BODY, h, SECRET, { now: at(NOW) }))
      .toMatchObject({ ok: false, reason: "timestamp_outside_tolerance" });
  });

  it("rejects a malformed or absent header rather than throwing", async () => {
    for (const h of ["", null, "garbage", "t=123", "v1=abc"]) {
      expect((await verifyStripeSignature(BODY, h, SECRET, { now: at(NOW) })).ok).toBe(false);
    }
  });

  it("refuses to verify at all when the endpoint secret is missing", async () => {
    // A misconfigured function must FAIL CLOSED. Treating an absent secret as "skip verification" is
    // how an endpoint ends up accepting anything anyone sends it.
    expect(await verifyStripeSignature(BODY, await header(), "", { now: at(NOW) }))
      .toMatchObject({ ok: false, reason: "no_secret" });
    expect((await verifyStripeSignature(BODY, await header(), undefined, { now: at(NOW) })).ok).toBe(false);
  });
});

describe("the primitives", () => {
  it("parses multiple schemes out of the header", () => {
    expect(parseSignatureHeader("t=1,v1=aa,v0=bb,v1=cc")).toEqual({ t: 1, v1: ["aa", "cc"] });
  });

  it("compares in constant time, and still compares correctly", () => {
    // A plain === leaks how many leading characters matched, which is enough to forge a signature
    // one byte at a time given enough attempts.
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
