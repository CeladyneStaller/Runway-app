// Billing enforcement, client side. The rule the whole design rests on: a lapsed subscription blocks
// WRITES and never reads. That is a promise the terms of service already make.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ERR_PAYMENT_REQUIRED, ERR_FORBIDDEN, isRetryable, kindOf } from "../../src/state/backends/errors";
import { createSupabaseBackend } from "../../src/state/backends/supabase";

const auth = { getAccessToken: async () => "jwt", getCompanyId: async () => "co-1" };
const backend = (respond) => createSupabaseBackend({
  url: "https://p.supabase.co", anonKey: "anon", auth, fetchImpl: respond,
});
const rpcFail = (payload, status = 400) => async () =>
  ({ ok: false, status, json: async () => payload, text: async () => JSON.stringify(payload) });

describe("telling 'you must pay' apart from 'you may not'", () => {
  it("classifies the RPC's payment_required by its SQLSTATE", async () => {
    const b = backend(rpcFail({ code: "P0003", message: "payment_required" }));
    await expect(b.write({ cash: 1 })).rejects.toMatchObject({ kind: ERR_PAYMENT_REQUIRED });
  });

  it("falls back to the message when a gateway drops the code", async () => {
    // Otherwise this lands on `forbidden` and tells somebody they lack permission when what they
    // lack is a subscription — two completely different sentences on screen.
    const b = backend(rpcFail({ message: 'exception: payment_required' }, 403));
    await expect(b.write({ cash: 1 })).rejects.toMatchObject({ kind: ERR_PAYMENT_REQUIRED });
  });

  it("still classifies a real permission failure as forbidden", async () => {
    const b = backend(rpcFail({ code: "42501", message: "forbidden" }, 403));
    await expect(b.write({ cash: 1 })).rejects.toMatchObject({ kind: ERR_FORBIDDEN });
  });
});

describe("what happens to the edit", () => {
  it("is NOT retried — paying is a decision, not a backoff", () => {
    expect(isRetryable({ kind: ERR_PAYMENT_REQUIRED })).toBe(false);
  });

  it("survives a module boundary, because kind is a string not a prototype", () => {
    expect(kindOf(structuredClone({ kind: ERR_PAYMENT_REQUIRED }))).toBe(ERR_PAYMENT_REQUIRED);
  });
});

describe("reads are never gated", () => {
  it("a read succeeds even when writes are refused for payment", async () => {
    // THE COMMITMENT. Terms of service section 5: a lapsed subscription still permits opening and
    // exporting. Nothing in migration 008 touches select, and this pins it from the client side.
    let saw = null;
    const b = createSupabaseBackend({
      url: "https://p.supabase.co", anonKey: "anon", auth,
      fetchImpl: async (u, i) => {
        saw = String(u);
        if (String(u).includes("save_document")) {
          return { ok: false, status: 400, json: async () => ({ code: "P0003", message: "payment_required" }) };
        }
        return { ok: true, status: 200, json: async () => [{ body: { cash: 5 }, version: 3, updated_at: "now" }] };
      },
    });
    const read = await b.read();
    expect(read.raw.cash).toBe(5);
    expect(saw).not.toContain("save_document");
    await expect(b.write({ cash: 6 })).rejects.toMatchObject({ kind: ERR_PAYMENT_REQUIRED });
  });
});

describe("a billing refusal must not trap you", () => {
  it("is not retryable, so the halt holds the edit rather than looping", () => {
    expect(isRetryable({ kind: ERR_PAYMENT_REQUIRED })).toBe(false);
  });

  it("switching away is allowed when the block is BILLING, not connectivity", async () => {
    // The flush-before-switch guard exists so a dropped connection cannot silently discard work.
    // payment_required is not transient — it refuses forever until somebody pays — so treating it
    // the same trapped people on the one company they could not edit, unable to reach a company they
    // could, or the page where they would pay.
    const S = await import("../../src/state/storage.js");
    S._resetWriteState();
    let saved = 0;
    S.setBackend({
      name: "unpaid",
      async read() { return { raw: { schemaVersion: 3, cash: 1 }, meta: {} }; },
      async write() {
        saved++;
        const e = new Error("payment_required"); e.kind = ERR_PAYMENT_REQUIRED; throw e;
      },
      async park() {},
    });
    await S.load();
    S.save({ schemaVersion: 3, cash: 2 });
    await S.flush();
    expect(saved).toBeGreaterThan(0);

    // The switch resolves rather than throwing "nothing was switched".
    const auth = { setActiveCompany() {}, activeCompany: () => "co-2", getAccessToken: async () => "jwt", getCompanyId: async () => "co-2" };
    await expect(S.switchCompany(auth, "co-2")).resolves.not.toThrow?.();
  });
});
