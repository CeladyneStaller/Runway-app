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
  companies = [{ id: "co-1", name: "Harbor Point Labs", role: "owner", has_document: false }];
  try { globalThis.localStorage.clear(); globalThis.sessionStorage.clear(); } catch { /* unavailable */ }
  window.location.hash = "";
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});

// `company` and `doc` are parameters because two of the bugs below are ABOUT them: a skip recorded for
// one company must not answer for another, and a document that exists but is empty must still be
// offered the wizard.
const goHosted = ({ company = "co-1", doc = null } = {}) => {
  const sink = [];
  let stored = doc;
  uploaded = sink;
  sync.enableHostedSync({
    authClient: fakeAuthClient({ access_token: "jwt", user: { email: "c@x.com" } }),
    env: full, activeCompany: company,
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
    // Cash and nothing burning it: honest about that rather than inventing a date.
    await waitFor(() => expect(container.querySelector(".setup-readout b").textContent).toMatch(/cash-flow positive/));
    expect(container.textContent).toMatch(/Nothing is burning yet/);

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

    // The subtitle reads the COMPANY name, not the model's — the model name is gone, so what the
    // wizard typed into it no longer surfaces here. The saved document is still asserted below, which
    // is the part that matters: the wizard's answers reached the store.
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
    await waitFor(() => expect(container.textContent).toMatch(/This model is empty/i));
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
    await waitFor(() => expect(container.textContent).toMatch(/This model is empty/i));
    await new Promise(r => setTimeout(r, 600));
    expect(uploaded).toEqual([]);
  });

  it("does not ask again in the same tab once it has been declined", async () => {
    goHosted();
    const first = render(<App />);
    await waitFor(() => expect(first.container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(first.container, /^Cancel$/));
    await waitFor(() => expect(first.container.textContent).toMatch(/This model is empty/i));
    first.unmount();

    const second = render(<App />);
    await waitFor(() => expect(second.container.textContent).toMatch(/This model is empty/i));
    expect(second.container.textContent).not.toMatch(/The basics/);
  });

  it("but declining for ONE company does not answer for another in the same tab", async () => {
    // THE REPORTED BUG. The skip flag was a single global sessionStorage key, written on cancel and
    // cleared nowhere — not on sign-out. So the second account opened in a tab never saw the wizard and
    // landed on the old empty-model screen instead, with nothing to say why.
    goHosted({ company: "co-1" });
    const first = render(<App />);
    await waitFor(() => expect(first.container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(first.container, /^Cancel$/));
    await waitFor(() => expect(first.container.textContent).toMatch(/This model is empty/i));
    first.unmount();

    goHosted({ company: "co-2" });
    const second = render(<App />);
    await waitFor(() => expect(second.container.textContent).toMatch(/The basics/));
  });

  it("and the way back to it is in the app, not a screen instead of it", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(container, /^Cancel$/));
    await waitFor(() => expect(container.textContent).toMatch(/This model is empty/i));
    // The app itself is behind the prompt — a bar, not a front door standing in for it.
    expect(container.querySelector(".empty-shell")).toBeNull();
    expect(container.querySelector(".rail")).toBeTruthy();

    fireEvent.click(btn(container, /Set up your company/));
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
  });
});

describe("the wizard is gated on an EMPTY MODEL, not on storage metadata", () => {
  it("fires for an account whose document row exists but holds nothing", async () => {
    // `isNew` means "the backend had no row", which is one stray write away from being false — a name
    // seed, an entitlement probe, anything that saves on arrival. When it flipped, the wizard silently
    // did not fire. The question actually being asked is whether the MODEL has anything in it.
    const docs = await import("../../src/state/document.js");
    goHosted({ doc: docs.emptyDoc() });
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
  });

  it("does not fire for a document with something in it", async () => {
    const docs = await import("../../src/state/document.js");
    goHosted({ doc: docs.demoDoc() });
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Runway remaining/i));
    expect(container.textContent).not.toMatch(/The basics/);
    expect(container.textContent).not.toMatch(/This model is empty/i);
  });

  it("retires the old empty-model screen in hosted mode entirely", async () => {
    // Two front doors was the real fault: a trigger bug rendered as a different, older-looking product
    // asking for cash on hand, which is indistinguishable from an intended design.
    // ASSERTED AFTER DISMISSAL, deliberately — while the wizard is up RunwayApp is not mounted at all,
    // so asserting there passes whether or not the screen still exists. The first version of this test
    // did exactly that and survived reverting the fix.
    goHosted({ doc: (await import("../../src/state/document.js")).emptyDoc() });
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.click(btn(container, /^Cancel$/));
    await waitFor(() => expect(container.querySelector(".rail")).toBeTruthy());
    expect(container.querySelector(".empty-shell")).toBeNull();
    expect(container.textContent).not.toMatch(/Nothing in the model yet/i);
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

describe("the runway readout tells the two 'no zero date' cases apart", () => {
  // zeroInfo returns ONE null for two completely different situations, and the readout used to label
  // both "cash-positive". Telling somebody who is burning steadily that they are cash-flow positive,
  // purely because their pile outlasts our 36-month window, is a wrong answer that gets believed.
  const fill = async (container, { cash, salary }) => {
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.change(container.querySelector("#su-cash"), { target: { value: cash } });
    fireEvent.click(btn(container, /^Next$/));
    const row = container.querySelector(".setup-row");
    fireEvent.change(row.querySelectorAll("input")[0], { target: { value: "Alex" } });
    fireEvent.change(row.querySelectorAll("input")[2], { target: { value: salary } });
  };
  const readout = (c) => c.querySelector(".setup-readout b").textContent;

  it("burning, and the cash runs out inside the window: a real date", async () => {
    goHosted();
    const { container } = render(<App />);
    await fill(container, { cash: "300000", salary: "600000" });   // 50k/mo against 300k
    await waitFor(() => expect(readout(container)).toMatch(/^\d+\.\d mo$/));
  });

  it("burning, but the cash outlasts the window: 36+ mo, NOT cash-flow positive", async () => {
    goHosted();
    const { container } = render(<App />);
    await fill(container, { cash: "50000000", salary: "120000" });  // 10k/mo against 50m
    await waitFor(() => expect(readout(container)).toBe("36+ mo"));
    expect(readout(container)).not.toMatch(/positive/);
    expect(container.textContent).toMatch(/Still spending more than you bring in/);
  });

  it("nothing burning at all: says so, rather than quoting a date", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    fireEvent.change(container.querySelector("#su-cash"), { target: { value: "600000" } });
    await waitFor(() => expect(readout(container)).toBe("cash-flow positive"));
    expect(container.textContent).toMatch(/Nothing is burning yet/);
  });

  it("no cash entered yet: nothing to say", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/The basics/));
    expect(readout(container)).toBe("—");
  });
});
