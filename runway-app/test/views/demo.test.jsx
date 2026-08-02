// Demo mode: a fully working model, kept in this browser for a fixed window, that reaches neither the
// database nor the browser's real document storage.
//
// The assertions that matter are still the negative ones — what it must NOT touch — because the point
// is that a sales demo leaves nothing behind. Added to those: the window itself (a WALL CLOCK from
// first entry, unmoved by edits or refreshes), the withheld export/import, and the one path by which
// demo data is allowed to become real — an explicit request, claimed by an empty account.
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
const DEMO_KEY = "runway:demo";
const HOUR = 60 * 60 * 1000;

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

let App, S, sync, doc, serverWrites;

beforeEach(async () => {
  vi.resetModules();
  idb.clear();
  serverWrites = [];
  try { globalThis.localStorage.clear(); globalThis.sessionStorage.clear(); } catch { /* not available */ }
  window.location.hash = "";
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  doc = await import("../../src/state/document.js");
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});
afterEach(() => { window.location.hash = ""; vi.useRealTimers(); });

const hostedSignedOut = () => sync.enableHostedSync({
  authClient: fakeAuthClient(null), env: full,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
});

// Signed in, writes observable at the network. Used for the demo's negative assertion.
const hostedSignedIn = () => sync.enableHostedSync({
  authClient: fakeAuthClient({ access_token: "jwt", user: { email: "c@x.com" } }), env: full,
  fetchImpl: async (u, i) => {
    if (String(u).includes("save_document")) serverWrites.push(JSON.parse(i.body));
    return { ok: true, status: 200, json: async () => [] };
  },
});

// Signed in against an EMPTY account — the state in which a stashed demo is claimable. Same shape the
// adoption tests use: a live session for the auth gate plus a stub backend standing in for the server,
// because what is under test here is the offer, not PostgREST.
const hostedNewAccount = () => {
  sync.enableHostedSync({ authClient: fakeAuthClient({ access_token: "jwt", user: { email: "c@x.com" } }), env: full });
  let serverDoc = null;
  S.setBackend({
    name: "fake",
    async read() { return serverDoc ? { raw: serverDoc, meta: { version: 1 } } : null; },
    async write(raw) { serverWrites.push(raw); serverDoc = raw; return { meta: { version: 2 } }; },
    async park() {},
  });
};

const envelope = () => JSON.parse(globalThis.localStorage.getItem(DEMO_KEY));
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

describe("entering a demo", () => {
  it("is one of the two doors on the landing screen, not a link under a password field", async () => {
    // It used to sit at the BOTTOM of the sign-in form, below a password input, a forgotten-password
    // link, a magic-link button and a Google button — the last place an undecided visitor would look.
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    expect(container.textContent).toMatch(/Open the demo/i);
    expect(container.textContent).toMatch(/No email/i);
    // and it is reachable without ever seeing the form
    expect(container.textContent).not.toMatch(/follows you between devices/i);
  });

  it("opens the model without signing in", async () => {
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    fireEvent.click(btn(container, /Open the demo/i));
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));
  });

  it("says what is actually happening — kept here, resetting, not in an account", async () => {
    window.location.hash = "#demo";
    hostedSignedOut();
    const { container } = render(<App />);
    // The old copy said "nothing is saved", which stopped being true once edits persisted.
    await waitFor(() => expect(container.textContent).toMatch(/Demo · resets in \d+h \d+m/));
    expect(container.textContent).not.toMatch(/nothing is saved/);
    expect(btn(container, /Leave demo/)).toBeTruthy();
    expect(btn(container, /Keep this/)).toBeTruthy();
  });
});

describe("what a demo must not touch", () => {
  it("writes nothing to the database", async () => {
    window.location.hash = "#demo";
    hostedSignedIn();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));
    S.save({ schemaVersion: 3, cash: 4242 });
    await S.flush();
    await new Promise(r => setTimeout(r, 200));
    expect(serverWrites).toEqual([]);
  });

  it("writes nothing to the browser's real document storage", async () => {
    window.location.hash = "#demo";
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));
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
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));
    await new Promise(r => setTimeout(r, 150));
    expect(container.textContent).not.toMatch(/model saved in this browser/i);
  });

  it("withholds export and import, and offers to keep the model instead", async () => {
    window.location.hash = "#demo";
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));
    // Import is the dangerous one: a real model dropped in here would die with the window.
    expect(btn(container, /^Export$/)).toBeFalsy();
    expect([...container.querySelectorAll("label")].some(l => /^Import/.test(l.textContent))).toBe(false);
    expect(btn(container, /Keep this model/)).toBeTruthy();
  });

  it("keeps export and import out of the rail entirely, demo or not", async () => {
    // REVERSED. The rule was "withhold them in demo mode", because they lived in the rail and import
    // would drop a real model into a store that wipes itself. They have moved to Company settings →
    // Data, owner-only — so the rail carries neither in any mode, and the demo guard is not the thing
    // protecting anybody any more. The demo has no company settings to reach.
    idb.set("runway:doc", doc.demoDoc());
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".rail")).toBeTruthy());
    const rail = container.querySelector(".rail");
    expect(rail.textContent).not.toMatch(/Export|Import/);
    expect(rail.querySelector('input[type="file"]')).toBeNull();
  });
});

describe("the twelve-hour window", () => {
  it("is a wall clock from first entry, and an edit does not buy more time", async () => {
    const { createDemoBackend } = await import("../../src/state/backends/demo.js");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T09:00:00Z"));
    const b = createDemoBackend(doc.demoDoc());
    const started = envelope().startedAt;

    vi.setSystemTime(new Date("2026-07-24T17:00:00Z"));   // eight hours of editing later
    await b.write({ schemaVersion: 3, cash: 5 });
    expect(envelope().startedAt).toBe(started);           // the clock did not move
  });

  it("a refresh re-adopts the original start time rather than restarting it", async () => {
    const { createDemoBackend, demoRemainingMs } = await import("../../src/state/backends/demo.js");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T09:00:00Z"));
    createDemoBackend(doc.demoDoc());

    vi.setSystemTime(new Date("2026-07-24T20:00:00Z"));   // eleven hours later, page reloads
    createDemoBackend(doc.demoDoc());
    expect(Math.round(demoRemainingMs() / HOUR)).toBe(1);  // one hour left, not twelve
  });

  it("closes after twelve hours: the model stops reading and the demo counts as expired", async () => {
    const { createDemoBackend, demoInProgress, demoExpired } = await import("../../src/state/backends/demo.js");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T09:00:00Z"));
    const b = createDemoBackend(doc.demoDoc());
    expect(await b.read()).not.toBeNull();

    vi.setSystemTime(new Date("2026-07-24T21:00:01Z"));
    expect(await b.read()).toBeNull();
    expect(demoInProgress()).toBe(false);
    // Distinct from "there was never a demo" — this is the state we owe somebody an explanation for.
    expect(demoExpired()).toBe(true);
  });

  it("explains the reset instead of silently swapping the model", async () => {
    // A window that closed while the tab was shut: the envelope is stale on arrival.
    globalThis.localStorage.setItem(DEMO_KEY, JSON.stringify({
      startedAt: Date.now() - 13 * HOUR, doc: { schemaVersion: 3, cash: 1 },
    }));
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The demo reset/));
    expect(container.textContent).toMatch(/twelve hours/i);
  });

  it("shows the notice once, not on every load", async () => {
    globalThis.localStorage.setItem(DEMO_KEY, JSON.stringify({
      startedAt: Date.now() - 13 * HOUR, doc: { schemaVersion: 3, cash: 1 },
    }));
    hostedSignedOut();
    const first = render(<App />);
    await waitFor(() => expect(first.container.textContent).toMatch(/The demo reset/));
    first.unmount();

    const second = render(<App />);
    await waitFor(() => expect(second.container.textContent).toMatch(/Demo ·/));
    expect(second.container.textContent).not.toMatch(/The demo reset/);
  });
});

describe("keeping a demo — the one path from fictional to real", () => {
  it("stashes the model, and the stash outlives leaving the demo", async () => {
    window.location.hash = "#demo";
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));

    S.stashPromotion({ schemaVersion: 3, cash: 8080 });
    S.clearDemo();   // what "keep this" does on its way to the sign-in screen
    // The demo is gone; the intent is not. Between the two sits an email confirmation that can take a day.
    expect(globalThis.localStorage.getItem(DEMO_KEY)).toBeNull();
    expect(S.pendingPromotion().cash).toBe(8080);
  });

  it("offers both doors when the new account loads: use it, or start clean", async () => {
    S.stashPromotion(doc.demoDoc());
    hostedNewAccount();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Bring your demo into this account/));
    expect(btn(container, /Use this as my model/)).toBeTruthy();
    expect(btn(container, /Start clean instead/)).toBeTruthy();
    // Honest about what is being carried: the sample company came with it.
    expect(container.textContent).toMatch(/invented data/i);
  });

  it("promoting writes it to the account and does not ask again", async () => {
    S.stashPromotion({ ...doc.demoDoc(), cash: 7777 });
    hostedNewAccount();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Bring your demo into this account/));
    fireEvent.click(btn(container, /Use this as my model/));
    await waitFor(() => expect(serverWrites.length).toBeGreaterThan(0));
    expect(S.pendingPromotion()).toBeNull();
    expect(container.textContent).not.toMatch(/Bring your demo into this account/);
  });

  it("starting clean discards the stash and writes nothing", async () => {
    S.stashPromotion(doc.demoDoc());
    hostedNewAccount();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Bring your demo into this account/));
    fireEvent.click(btn(container, /Start clean instead/));
    await waitFor(() => expect(container.textContent).not.toMatch(/Bring your demo into this account/));
    expect(S.pendingPromotion()).toBeNull();
    expect(serverWrites).toEqual([]);
  });

  it("is never offered while still inside the demo", async () => {
    // There is no account to promote INTO yet; asking here would be nonsense.
    window.location.hash = "#demo";
    S.stashPromotion(doc.demoDoc());
    hostedSignedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));
    await new Promise(r => setTimeout(r, 150));
    expect(container.textContent).not.toMatch(/Bring your demo into this account/);
  });

  it("expires on its own, much longer schedule than the demo", async () => {
    const { stashPromotion, pendingPromotion } = await import("../../src/state/backends/demo.js");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T09:00:00Z"));
    stashPromotion({ schemaVersion: 3, cash: 5 });

    vi.setSystemTime(new Date("2026-07-26T09:00:00Z"));   // two days — the demo window would be long shut
    expect(pendingPromotion()).not.toBeNull();

    vi.setSystemTime(new Date("2026-08-05T09:00:00Z"));   // past a week
    expect(pendingPromotion()).toBeNull();
  });
});

describe("the demo backend", () => {
  it("keeps edits during the session so the model behaves normally", async () => {
    const { createDemoBackend } = await import("../../src/state/backends/demo.js");
    const b = createDemoBackend(doc.demoDoc());
    const first = await b.read();
    expect(first.raw.employees.length).toBeGreaterThan(0);
    await b.write({ ...first.raw, cash: 12345 });
    expect((await b.read()).raw.cash).toBe(12345);
  });

  it("clearDemo wipes the demo but NOT a pending promotion", async () => {
    const { createDemoBackend, clearDemo, demoInProgress, stashPromotion, pendingPromotion } =
      await import("../../src/state/backends/demo.js");
    const b = createDemoBackend(doc.demoDoc());
    await b.write({ schemaVersion: 3, cash: 777 });
    stashPromotion({ schemaVersion: 3, cash: 777 });
    expect(demoInProgress()).toBe(true);

    clearDemo();
    expect(demoInProgress()).toBe(false);
    // Leaving the demo is exactly what somebody does on their way to creating the account.
    expect(pendingPromotion()).not.toBeNull();
  });

  it("keeps demo data out of the store real models live in", async () => {
    const { createDemoBackend } = await import("../../src/state/backends/demo.js");
    const b = createDemoBackend(doc.demoDoc());
    await b.write({ schemaVersion: 3, cash: 31337 });
    // peekLocal() reads IndexedDB; the demo is in localStorage under its own key, so the adoption flow
    // can never see it. Same isolation the sessionStorage version had, different mechanism.
    expect(idb.get("runway:doc")).toBeUndefined();
    expect(globalThis.localStorage.getItem(DEMO_KEY)).toBeTruthy();
  });

  it("still works when localStorage is unavailable", async () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try {
      const { createDemoBackend, demoInProgress } = await import("../../src/state/backends/demo.js");
      const b = createDemoBackend({ schemaVersion: 3, cash: 1 });
      await b.write({ schemaVersion: 3, cash: 2 });
      expect((await b.read()).raw.cash).toBe(2);   // memory fallback: a demo must never refuse to open
      // The memory fallback is module-scoped so the HELPERS see it too — holding it per-instance is how
      // the pill ends up reporting "no demo" on exactly the browsers doing the fallback.
      expect(demoInProgress()).toBe(true);
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real);
    }
  });
});
