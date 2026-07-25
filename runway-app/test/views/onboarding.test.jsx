// The new-company path: a landing fork, then a wizard, instead of "here is an empty model, go find the
// eight tabs". What matters most here is what happens when somebody DOESN'T cooperate — skips every
// step, cancels out, or arrives with a file instead — because an onboarding flow that traps people is
// worse than no onboarding flow.
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
    async signOut() { return { error: null }; },
  };
}

let App, S, sync, uploaded, companies;

beforeEach(async () => {
  vi.resetModules();
  idb.clear();
  companies = [{ id: "co-1", name: "Celadyne Energy", role: "owner", has_document: false }];
  try { globalThis.localStorage.clear(); globalThis.sessionStorage.clear(); } catch { /* unavailable */ }
  window.location.hash = "";
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});

const goHosted = () => {
  const sink = [];
  let stored = null;
  uploaded = sink;
  sync.enableHostedSync({
    authClient: fakeAuthClient({ access_token: "jwt", user: { email: "c@x.com" } }),
    env: full, activeCompany: "co-1",
    fetchImpl: async (u) => String(u).includes("list_companies")
      ? { ok: true, status: 200, json: async () => companies }
      : { ok: true, status: 200, json: async () => [] },
  });
  S.setBackend({
    name: "fake",
    async read() { return stored ? { raw: stored, meta: { version: 1 } } : null; },
    async write(raw) { sink.push(raw); stored = raw; return { meta: { version: 2 } }; },
    async park() {},
  });
};

const signedOut = () => sync.enableHostedSync({
  authClient: fakeAuthClient(null), env: full,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
});

const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

describe("the landing fork", () => {
  it("comes before any form — nobody is asked to authenticate to a product they haven't seen", async () => {
    signedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    expect(container.textContent).toMatch(/Open the demo/);
    expect(container.textContent).toMatch(/Get started/);
    expect(container.querySelector("#signin-email")).toBeNull();
    expect(container.querySelector("#signin-password")).toBeNull();
  });

  it("keeps sign-in one click away for people who know what they want", async () => {
    signedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    fireEvent.click(btn(container, /^Sign in$/));
    await waitFor(() => expect(container.querySelector("#signin-password")).toBeTruthy());
  });

  it("and the form can go back to the fork, so neither door is a trap", async () => {
    signedOut();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    fireEvent.click(btn(container, /Get started/));
    await waitFor(() => expect(container.querySelector("#signin-email")).toBeTruthy());
    fireEvent.click(btn(container, /^Back$/));
    await waitFor(() => expect(container.textContent).toMatch(/Open the demo/));
  });
});

describe("the wizard", () => {
  it("meets a new account instead of an empty model", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    expect(container.textContent).toMatch(/Basics/);
    expect(container.textContent).toMatch(/People/);
    expect(container.textContent).toMatch(/Funding/);
  });

  it("shows the runway assembling as you answer — the reason to finish it", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    // Nothing to say yet.
    expect(container.querySelector(".setup-readout b").textContent).toBe("—");

    fireEvent.change(container.querySelector("#su-cash"), { target: { value: "600000" } });
    // Cash and no burn: honest about being cash-positive rather than inventing a date.
    await waitFor(() => expect(container.querySelector(".setup-readout b").textContent).toMatch(/cash-positive/));

    fireEvent.click(btn(container, /^Next$/));
    const rows = () => [...container.querySelectorAll(".setup-row")];
    fireEvent.change(rows()[0].querySelectorAll("input")[0], { target: { value: "Alex Rivera" } });
    fireEvent.change(rows()[0].querySelectorAll("input")[2], { target: { value: "180,000" } });
    await waitFor(() => expect(container.querySelector(".setup-readout b").textContent).toMatch(/^\d+\.\d mo$/));
  });

  it("warns about a blank salary rather than blocking on it", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(container, /^Next$/));
    const rows = () => [...container.querySelectorAll(".setup-row")];
    fireEvent.change(rows()[0].querySelectorAll("input")[0], { target: { value: "Sam Okafor" } });
    await waitFor(() => expect(container.textContent).toMatch(/No salary yet for Sam Okafor/));
    // Still able to continue — somebody without the figures to hand must not be trapped.
    expect(btn(container, /^Next$/)).toBeTruthy();
  });

  it("writes the answers as a real model", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.change(container.querySelector("#su-name"), { target: { value: "Acme Robotics" } });
    fireEvent.change(container.querySelector("#su-cash"), { target: { value: "600000" } });
    fireEvent.click(btn(container, /^Next$/));
    const rows = [...container.querySelectorAll(".setup-row")];
    fireEvent.change(rows[0].querySelectorAll("input")[0], { target: { value: "Alex Rivera" } });
    fireEvent.change(rows[0].querySelectorAll("input")[1], { target: { value: "CEO" } });
    fireEvent.change(rows[0].querySelectorAll("input")[2], { target: { value: "180000" } });
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Done$/));

    await waitFor(() => expect(container.querySelector(".sub")?.textContent).toMatch(/^Acme Robotics ·/));
    await waitFor(() => expect(uploaded.length).toBeGreaterThan(0));
    const saved = uploaded[uploaded.length - 1];
    expect(saved.cash).toBe(600000);
    expect(saved.employees[0]).toMatchObject({ name: "Alex Rivera", title: "CEO", amount: 180000 });
  });
});

describe("not cooperating with the wizard", () => {
  it("cancelling leaves the account exactly as new as it was found", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(container, /^Cancel$/));
    await waitFor(() => expect(container.textContent).toMatch(/Nothing in the model yet/i));
    await new Promise(r => setTimeout(r, 600));
    // Nothing written — so the account is still `isNew` and can be offered the wizard again.
    expect(uploaded).toEqual([]);
  });

  it("skipping every step writes nothing either", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(container, /Skip this step/));
    fireEvent.click(btn(container, /Skip this step/));
    fireEvent.click(btn(container, /Skip this step/));
    fireEvent.click(btn(container, /Finish without this/));
    await waitFor(() => expect(container.textContent).toMatch(/Nothing in the model yet/i));
    await new Promise(r => setTimeout(r, 600));
    expect(uploaded).toEqual([]);
  });

  it("does not ask again in the same tab once it has been declined", async () => {
    goHosted();
    const first = render(<App />);
    await waitFor(() => expect(first.container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(first.container, /^Cancel$/));
    await waitFor(() => expect(first.container.textContent).toMatch(/Nothing in the model yet/i));
    first.unmount();

    const second = render(<App />);
    await waitFor(() => expect(second.container.textContent).toMatch(/Nothing in the model yet/i));
    expect(second.container.textContent).not.toMatch(/The basics/);
  });
});

describe("the demo promotion still wins", () => {
  it("an explicitly kept demo is offered ahead of the generic wizard", async () => {
    // Precedence matters: somebody who asked to keep their demo has given the more explicit signal.
    const docs = await import("../../src/state/document.js");
    S.stashPromotion(docs.demoDoc());
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Bring your demo into this account/));
    expect(container.textContent).not.toMatch(/The basics/);
  });
});
