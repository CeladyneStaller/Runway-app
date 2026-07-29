// The OAuth state parameter. The callback that consumes this has no session, no auth header and no
// CORS to hide behind — a forged state means attaching somebody's QuickBooks to the wrong company —
// so the assertions that matter here are the refusals.
import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../../supabase/functions/_shared/oauth-state.js";

const SECRET = "state_signing_secret_value";
const NOW = 1793000000000;
const at = (ms) => () => ms;
const payload = { companyId: "co-1", userId: "user-1" };

describe("signState / verifyState", () => {
  it("round-trips the company it was issued for", async () => {
    const s = await signState(payload, SECRET, { now: at(NOW) });
    const r = await verifyState(s, SECRET, { now: at(NOW) });
    expect(r.ok).toBe(true);
    expect(r.payload).toMatchObject(payload);
  });

  it("refuses a state signed with a different secret", async () => {
    const s = await signState(payload, "someone_elses_secret", { now: at(NOW) });
    expect(await verifyState(s, SECRET, { now: at(NOW) }))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a TAMPERED company id even though the shape is still valid", async () => {
    // The attack this exists to stop: same structure, different company.
    const s = await signState(payload, SECRET, { now: at(NOW) });
    const [json] = s.split(".");
    const evil = btoa(JSON.stringify({ companyId: "co-victim", exp: 99999999999 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(json).not.toBe(evil);
    const r = await verifyState(`${evil}.${s.split(".")[1]}`, SECRET, { now: at(NOW) });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("expires, so a signed link cannot be replayed out of a browser history", async () => {
    const s = await signState(payload, SECRET, { ttlSeconds: 600, now: at(NOW) });
    expect((await verifyState(s, SECRET, { now: at(NOW + 599_000) })).ok).toBe(true);
    expect(await verifyState(s, SECRET, { now: at(NOW + 601_000) }))
      .toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a state with no company, however well signed", async () => {
    const s = await signState({ userId: "user-1" }, SECRET, { now: at(NOW) });
    expect(await verifyState(s, SECRET, { now: at(NOW) }))
      .toEqual({ ok: false, reason: "no_company" });
  });

  it("never throws on whatever arrives in a query string", async () => {
    for (const junk of [undefined, null, "", "...", "a.b", "%%%.%%%", 42, {}, "a".repeat(5000)]) {
      const r = await verifyState(junk, SECRET, { now: at(NOW) });
      expect(r.ok).toBe(false);
      expect(typeof r.reason).toBe("string");
    }
  });

  it("refuses everything when no secret is configured, rather than accepting everything", async () => {
    const s = await signState(payload, SECRET, { now: at(NOW) });
    expect(await verifyState(s, "", { now: at(NOW) })).toEqual({ ok: false, reason: "no_secret" });
    expect(await verifyState(s, undefined, { now: at(NOW) })).toEqual({ ok: false, reason: "no_secret" });
  });

  it("will not sign without a secret either", async () => {
    await expect(signState(payload, "")).rejects.toThrow();
  });

  it("produces a URL-safe token", async () => {
    const s = await signState({ companyId: "co/with+chars=" }, SECRET, { now: at(NOW) });
    expect(s).toBe(encodeURIComponent(s).replace(/%2E/g, "."));
  });
});
