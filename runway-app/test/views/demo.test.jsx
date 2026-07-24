// Demo mode: a fully working model that reaches neither the database nor this browser's real storage.
// The assertions that matter are the negative ones — what it must NOT touch — because the entire point
// is that a sales demo leaves nothing behind.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

const idb = new Map();
vi.mock("idb-keyval", () => ({
  get: async (k) => idb.get(k),
  set: async (k, v) => { idb.set(k, v); },
  keys: async () => [...idb.keys()],
  clear: async () => idb.clear(),
}));

const full = { VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_ANON_KEY: "anon" };

function fakeAuthClient(session = null) {
  const listeners = new Set();
  return {
    async getSession() { return { data: { session }, error: null }; },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async signInWithOtp() { return { error: null }; },
    async signInWithOAuth() { return { error: null }; },
    async signInWithPassword() { return { error: null }; },
    async signUp() { return { data: { session: null }, error: null }; },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser() { return { error: null }; },
    async signOut() { return { error: null }; },
  };
}

let App, S, sync, serverWrites;

beforeEach(async () => {
  vi.resetModules();
  idb.clear();
  serverWrites = [];
  try { globalThis.sessionStorage.clear(); } catch { /* not available */ }
  window.location.hash = "";
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});
afterEach(() => { window.location.hash = ""; });

const hostedSignedOut = () => sync.enableHostedSync({
  authClient: fakeAuthClient(null), env: full,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
});

describe("entering a demo", () => {
  it("is offered on the sign-in screen, without an account", async () => {
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    expect(container.textContent).toMatch(/Look around with sample data first/i);
    expect(container.textContent).toMatch(/No account needed/i);
  });

  it("opens the model without signing in", async () => {
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Look around with sample data/i.test(b.textContent)));
    await waitFor(() => expect(container.textContent).toMatch(/Demo · nothing is saved/));
  });

  it("says permanently that nothing is being kept, and offers the way out", async () => {
    window.location.hash = "#demo";
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo · nothing is saved/));
    expect([...container.querySelectorAll("button")].some(b => /Leave demo/.test(b.textContent))).toBe(true);
  });
});

describe("what a demo must not touch", () => {
  it("writes nothing to the database", async () => {
    window.location.hash = "#demo";
    sync.enableHostedSync({
      authClient: fakeAuthClient({ access_token: "jwt", user: { email: "c@x.com" } }), env: full,
      fetchImpl: async (u, i) => {
        if (u.includes("save_document")) serverWrites.push(JSON.parse(i.body));
        return { ok: true, status: 200, json: async () => [] };
      },
    });
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo · nothing is saved/));
    S.save({ schemaVersion: 3, cash: 4242 });
    await S.flush();
    await new Promise(r => setTimeout(r, 200));
    expect(serverWrites).toEqual([]);
  });

  it("writes nothing to the browser's real document storage", async () => {
    window.location.hash = "#demo";
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo · nothing is saved/));
    S.save({ schemaVersion: 3, cash: 4242 });
    await S.flush();
    // IndexedDB is where REAL local models live; a demo landing there would later be offered for upload
    expect(idb.get("runway:doc")).toBeUndefined();
  });

  it("never offers to upload demo data into an account", async () => {
    window.location.hash = "#demo";
    idb.set("runway:doc", { schemaVersion: 3, cash: 99999, employees: [{ id: "e" }] });
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo · nothing is saved/));
    await new Promise(r => setTimeout(r, 150));
    expect(container.textContent).not.toMatch(/model saved in this browser/i);
  });
});

describe("the demo backend", () => {
  it("keeps edits during the session so the model behaves normally", async () => {
    const { createDemoBackend } = await import("../../src/state/backends/demo.js");
    const { demoDoc } = await import("../../src/state/document.js");
    const b = createDemoBackend(demoDoc());
    const first = await b.read();
    expect(first.raw.employees.length).toBeGreaterThan(0);
    await b.write({ ...first.raw, cash: 12345 });
    expect((await b.read()).raw.cash).toBe(12345);
  });

  it("clearDemo wipes it, so the next visitor starts from the same place", async () => {
    const { createDemoBackend, clearDemo, demoInProgress } = await import("../../src/state/backends/demo.js");
    const { demoDoc } = await import("../../src/state/document.js");
    const b = createDemoBackend(demoDoc());
    await b.write({ schemaVersion: 3, cash: 777 });
    expect(demoInProgress()).toBe(true);
    clearDemo();
    expect(demoInProgress()).toBe(false);
  });

  it("still works when sessionStorage is unavailable", async () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    try {
      const { createDemoBackend } = await import("../../src/state/backends/demo.js");
      const b = createDemoBackend({ schemaVersion: 3, cash: 1 });
      await b.write({ schemaVersion: 3, cash: 2 });
      expect((await b.read()).raw.cash).toBe(2);   // memory fallback: a demo must never refuse to open
    } finally {
      if (real) Object.defineProperty(globalThis, "sessionStorage", real);
    }
  });
});
