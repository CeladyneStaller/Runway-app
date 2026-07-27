// Adopting a model left in this browser. Signing in switches reads to the server, which makes a
// locally-built model invisible — not deleted, but invisible, and nothing else would ever mention it.
// The tests that matter are the ones about WHEN NOT to offer, and about never destroying anything.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

const idb = new Map();
vi.mock("idb-keyval", () => ({
  get: async (k) => idb.get(k),
  set: async (k, v) => { idb.set(k, v); },
  keys: async () => [...idb.keys()],
  clear: async () => idb.clear(),
}));

const full = { VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_ANON_KEY: "anon" };

function fakeAuthClient(session) {
  const listeners = new Set();
  return {
    async getSession() { return { data: { session }, error: null }; },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async signInWithOtp() { return { error: null }; },
    async signInWithOAuth() { return { error: null }; },
    async signOut() { return { error: null }; },
  };
}

let App, S, sync, demoDoc, emptyDoc, serverDoc, uploaded;

beforeEach(async () => {
  vi.resetModules();
  idb.clear();
  serverDoc = null; uploaded = [];
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  ({ demoDoc, emptyDoc } = await import("../../src/state/document.js"));
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});

// hosted backend stub, plus a live session so the auth gate lets us through
const goHosted = () => {
  sync.enableHostedSync({ authClient: fakeAuthClient({ access_token: "jwt", user: { email: "c@x.com" } }), env: full });
  S.setBackend({
    name: "fake",
    async read() { return serverDoc ? { raw: serverDoc, meta: { version: 1 } } : null; },
    async write(raw) { uploaded.push(raw); serverDoc = raw; return { meta: { version: 2 } }; },
    async park() {},
  });
};

const putLocalDoc = (doc) => idb.set("runway:doc", doc);

describe("a brand-new account", () => {
  it("does not get an empty document written to it just by signing in", async () => {
    goHosted();
    render(<App />);
    await new Promise(r => setTimeout(r, 700));   // well past the save debounce
    expect(uploaded).toEqual([]);                 // nothing persisted until the user does something
    expect(serverDoc).toBeNull();                 // ...so the account stays "new" and the offer survives
  });
});

describe("when a local model is offered", () => {
  it("offers it when the account is empty and this browser has one", async () => {
    putLocalDoc({ ...demoDoc(), cash: 654321 });
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/model saved in this browser/i));
    expect(container.textContent).toMatch(/654,321/);
  });

  it("does NOT offer when the account already has a document — that is a conflict, not a migration", async () => {
    putLocalDoc({ ...demoDoc(), cash: 654321 });
    serverDoc = { ...demoDoc(), cash: 111 };
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Loading your model/));
    await new Promise(r => setTimeout(r, 60));
    expect(container.textContent).not.toMatch(/model saved in this browser/i);
  });

  it("does NOT offer an empty shell", async () => {
    putLocalDoc(emptyDoc());
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Loading your model/));
    await new Promise(r => setTimeout(r, 60));
    expect(container.textContent).not.toMatch(/model saved in this browser/i);
  });

  it("does NOT offer in local mode — there is nothing to migrate to", async () => {
    putLocalDoc({ ...demoDoc(), cash: 654321 });
    sync.enableHostedSync({ env: {} });            // local
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Loading your model/));
    expect(container.textContent).not.toMatch(/model saved in this browser/i);
  });
});

describe("acting on the offer", () => {
  const openOffer = async () => {
    putLocalDoc({ ...demoDoc(), cash: 654321 });
    goHosted();
    const r = render(<App />);
    await waitFor(() => expect(r.container.textContent).toMatch(/model saved in this browser/i));
    return r;
  };
  const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

  it("uploading writes it to the account and closes", async () => {
    const { container } = await openOffer();
    fireEvent.click(btn(container, /Upload it to my account/));
    // assert on CONTENT, not write count: a count-based wait can be satisfied by an unrelated write
    await waitFor(() => expect(uploaded.at(-1)?.cash).toBe(654321));
    await waitFor(() => expect(container.textContent).not.toMatch(/model saved in this browser/i));
  });

  it("uploading never deletes the browser's copy", async () => {
    const { container } = await openOffer();
    fireEvent.click(btn(container, /Upload it to my account/));
    await waitFor(() => expect(uploaded.at(-1)?.cash).toBe(654321));
    expect(idb.get("runway:doc")).toBeTruthy();     // still exactly where it was
  });

  it("declining is remembered, so it does not ask again", async () => {
    const { container, unmount } = await openOffer();
    fireEvent.click(btn(container, /Start fresh instead/));
    await waitFor(() => expect(container.textContent).not.toMatch(/model saved in this browser/i));
    unmount();

    const again = render(<App />);
    await waitFor(() => expect(again.container.textContent).not.toMatch(/Loading your model/));
    await new Promise(r => setTimeout(r, 60));
    expect(again.container.textContent).not.toMatch(/model saved in this browser/i);
  });

  it("declining does not delete anything either", async () => {
    const { container } = await openOffer();
    fireEvent.click(btn(container, /Start fresh instead/));
    await waitFor(() => expect(container.textContent).not.toMatch(/model saved in this browser/i));
    expect(idb.get("runway:doc")).toBeTruthy();
  });

  it("a failed upload says so and keeps the offer open", async () => {
    putLocalDoc({ ...demoDoc(), cash: 654321 });
    goHosted();
    S.setBackend({
      name: "fake",
      async read() { return null; },
      async write() { throw new Error("server exploded"); },
      async park() {},
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/model saved in this browser/i));
    fireEvent.click(btn(container, /Upload it to my account/));
    await waitFor(() => expect(container.textContent).toMatch(/model saved in this browser/i));
    expect(idb.get("runway:doc")).toBeTruthy();
    spy.mockRestore();
  });
});
