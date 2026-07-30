// The funnel emitter. The interesting assertions are about what it REFUSES to send and what it does
// when things go wrong, because it sits in the middle of signup and checkout and must never be able to
// interrupt somebody paying.
import { describe, it, expect, vi } from "vitest";
import { createFunnel, FUNNEL_EVENTS } from "../../src/state/funnel.js";

const memStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
};

const ok = () => ({ ok: true, status: 204 });
const setup = (over = {}) => {
  const fetchImpl = vi.fn().mockResolvedValue(ok());
  const storage = memStore();
  const f = createFunnel({ url: "https://x.supabase.co", anonKey: "anon", fetchImpl, storage, ...over });
  return { f, fetchImpl, storage };
};
const bodyOf = (fetchImpl, n = 0) => JSON.parse(fetchImpl.mock.calls[n][1].body);

describe("what it sends", () => {
  it("an event name and an anonymous id, and nothing else", async () => {
    const { f, fetchImpl } = setup();
    expect(await f.track("landed")).toBe(true);
    expect(Object.keys(bodyOf(fetchImpl)).sort()).toEqual(["p_anon", "p_event"]);
    expect(bodyOf(fetchImpl).p_event).toBe("landed");
  });

  it("carries no URL, referrer, user agent or screen size", async () => {
    const { f, fetchImpl } = setup();
    await f.track("landed");
    const raw = JSON.stringify(fetchImpl.mock.calls[0][1].body).toLowerCase();
    for (const forbidden of ["http", "referr", "agent", "screen", "width", "path", "query", "@"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("has no parameter through which a payload could arrive", async () => {
    // The API takes ONE argument. There is no properties bag, so a number from somebody's model cannot
    // be passed even by mistake — which is a stronger guarantee than remembering not to.
    const { f, fetchImpl } = setup();
    await f.track("landed", { cash: 1234567, email: "someone@example.com" });
    expect(JSON.stringify(bodyOf(fetchImpl))).not.toContain("1234567");
    expect(JSON.stringify(bodyOf(fetchImpl))).not.toContain("example.com");
  });

  it("reuses one anonymous id across events", async () => {
    const { f, fetchImpl } = setup();
    await f.track("landed");
    await f.track("demo_started");
    expect(bodyOf(fetchImpl, 0).p_anon).toBe(bodyOf(fetchImpl, 1).p_anon);
  });

  it("generates a random id rather than deriving one from the browser", async () => {
    const a = setup(), b = setup();
    await a.f.track("landed");
    await b.f.track("landed");
    // Two visitors on identical browsers must not collide. A fingerprint would.
    expect(bodyOf(a.fetchImpl).p_anon).not.toBe(bodyOf(b.fetchImpl).p_anon);
  });
});

describe("what it refuses", () => {
  it("an event that is not on the allowlist", async () => {
    const { f, fetchImpl } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await f.track("cash_balance_viewed")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();      // loud, because a typo is a chart that stays empty
    warn.mockRestore();
  });

  it("a repeat of a step already recorded on this device", async () => {
    const { f, fetchImpl } = setup();
    expect(await f.track("landed")).toBe(true);
    expect(await f.track("landed")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("everything, when there is nowhere configured to send it", async () => {
    for (const over of [{ url: "" }, { anonKey: "" }, { enabled: false }]) {
      const { f, fetchImpl } = setup(over);
      expect(f.live).toBe(false);
      expect(await f.track("landed")).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe("it cannot break the thing it is measuring", () => {
  it("returns false when the request fails, and does not throw", async () => {
    const { f } = setup({ fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) });
    await expect(f.track("checkout_started")).resolves.toBe(false);
  });

  it("returns false on a non-2xx without marking the step sent", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue(ok());
    const { f } = setup({ fetchImpl });
    expect(await f.track("landed")).toBe(false);
    // NOT marked as sent, so the next attempt retries rather than losing the step forever.
    expect(await f.track("landed")).toBe(true);
  });

  it("survives storage being blocked entirely", async () => {
    const blocked = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    const { f, fetchImpl } = setup({ storage: blocked });
    await expect(f.track("landed")).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the allowlist itself", () => {
  it("is the eight funnel steps, in order", () => {
    expect(FUNNEL_EVENTS).toEqual([
      "landed", "demo_started", "signup_started", "signup_completed",
      "setup_completed", "first_save", "checkout_started", "checkout_completed",
    ]);
  });

  it("matches the CHECK constraint in migration 020", async () => {
    // TWO PLACES ON PURPOSE — the client refuses to send an unknown event and the database refuses to
    // store one — so this test is what keeps them from drifting apart.
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/020_funnel.sql", "utf8");
    const inCheck = sql.slice(sql.indexOf("funnel_event_known"), sql.indexOf("));", sql.indexOf("funnel_event_known")));
    for (const e of FUNNEL_EVENTS) expect(inCheck).toContain(`'${e}'`);
  });

  it("is also the step list in funnel_summary, so nothing is measured and not reported", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/020_funnel.sql", "utf8");
    const steps = sql.slice(sql.indexOf("with steps(step, event)"), sql.indexOf("select s.step"));
    for (const e of FUNNEL_EVENTS) expect(steps).toContain(`'${e}'`);
  });

  it("is frozen, so nothing can extend it at runtime", () => {
    expect(Object.isFrozen(FUNNEL_EVENTS)).toBe(true);
  });
});

describe("first_save counts an account, not a demo", () => {
  // THE BUG THIS PINS. `first_save` fired on any backend write, and `enterDemo()` seeds a sample
  // document into the demo backend — so starting the demo recorded activation, making the step a
  // duplicate of `demo_started` and removing the only signal it carried.
  const load = async () => {
    const S = await import("../../src/state/storage.js");
    const { createFunnel, setFunnel } = await import("../../src/state/funnel.js");
    const sent = [];
    setFunnel({ live: true, track: async (e) => { sent.push(e); return true; }, reset() {} });
    return { S, sent, createFunnel };
  };

  const backend = (name, store) => ({
    name,
    async read() { return store.doc ? { raw: store.doc, meta: { version: 1 } } : null; },
    async write(raw) { store.doc = raw; return { meta: { version: 2 } }; },
    async park() {},
  });

  it("does NOT fire for the demo backend", async () => {
    const { S, sent } = await load();
    const store = {};
    S.setBackend(backend("demo", store));
    await S.load();
    S.save({ schemaVersion: 3, cash: 500 });
    await S.flush();
    expect(store.doc).toBeTruthy();          // the write really happened
    expect(sent).not.toContain("first_save"); // and was still not activation
  });

  it("does NOT fire for the local backend either", async () => {
    const { S, sent } = await load();
    const store = {};
    S.setBackend(backend("local", store));
    await S.load();
    S.save({ schemaVersion: 3, cash: 500 });
    await S.flush();
    expect(sent).not.toContain("first_save");
  });

  it("DOES fire for the hosted backend", async () => {
    const { S, sent } = await load();
    const store = {};
    S.setBackend(backend("supabase", store));
    await S.load();
    S.save({ schemaVersion: 3, cash: 500 });
    await S.flush();
    expect(sent).toContain("first_save");
  });
});
