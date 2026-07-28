// Where a model's name comes from. A model belongs to a company, so the company's name is the right
// default for it — nobody should have to type "Acme" twice. The delicate part is WHEN: seeding the name
// on load would write to a brand-new account merely because somebody signed in, which stops the account
// being "new" and takes the adoption and promotion offers down with it.
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

let App, S, sync, docs, serverDoc, uploaded, companies;

beforeEach(async () => {
  vi.resetModules();
  idb.clear();
  serverDoc = null; uploaded = [];
  companies = [{ id: "co-1", name: "Celadyne Energy", role: "owner", has_document: false }];
  try { globalThis.localStorage.clear(); globalThis.sessionStorage.clear(); } catch { /* unavailable */ }
  window.location.hash = "";
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  docs = await import("../../src/state/document.js");
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});

// Signed in, with a company the account can name, and a stub standing in for the server document.
//
// The sink and the server document are captured PER CALL, not shared. `vi.resetModules()` gives each
// test a fresh storage module, but the previous test's module is still alive and may still be holding a
// debounce timer — and that timer's backend closure would otherwise push into whatever array the next
// test is currently asserting on. Which is how a passing suite reports a phantom write.
const goHosted = () => {
  const sink = [];
  let stored = serverDoc;
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

const sub = (c) => c.querySelector(".sub")?.textContent || "";
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

describe("a new company's first model", () => {
  it("opens the setup wizard with the company's name already filled in", async () => {
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Set up your company/i));
    expect(container.querySelector("#su-name").value).toBe("Celadyne Energy");

    fireEvent.change(container.querySelector("#su-cash"), { target: { value: "250,000" } });
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Done$/));

    await waitFor(() => expect(sub(container)).toMatch(/^Celadyne Energy ·/));
    expect(container.querySelector(".docname").value).toBe("Celadyne Energy");
  });

  it("and still seeds the name for anybody who skips the wizard entirely", async () => {
    // The seed is the backstop for the skip path — the wizard is not the only way into a model.
    // NOTE the route: cancelling used to land on the empty-model SCREEN and its cash box, which hosted
    // mode no longer has. Cash now goes in where it lives for every other model, which is a better test
    // of the same rule: the seed fires when the document gains substance, by whatever path.
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Set up your company/i));
    fireEvent.click(btn(container, /^Cancel$/));
    await waitFor(() => expect(container.textContent).toMatch(/This model is empty/i));

    fireEvent.click(btn(container, /Spend history/i));
    const field = await waitFor(() => {
      const l = [...container.querySelectorAll(".startcfg label")].find(x => /Cash on hand at start/i.test(x.textContent));
      if (!l) throw new Error("no cash field");
      return l.querySelector("input");
    });
    fireEvent.change(field, { target: { value: "250000" } });
    await waitFor(() => expect(sub(container)).toMatch(/^Celadyne Energy ·/));
  });

  it("writes NOTHING to the account until that action happens", async () => {
    // The load-bearing constraint. If the seed fired on load, this account would stop being new.
    goHosted();
    render(<App />);
    await new Promise(r => setTimeout(r, 700));   // well past the save debounce
    expect(uploaded).toEqual([]);
  });
});

describe("what it must not overwrite", () => {
  it("leaves a name somebody actually chose", async () => {
    serverDoc = { ...docs.demoDoc(), name: "Acme Holdings" };
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(sub(container)).toMatch(/^Acme Holdings ·/));
    await new Promise(r => setTimeout(r, 400));
    expect(uploaded).toEqual([]);   // no unrequested rewrite of real data
  });

  it("does not rewrite an EXISTING model that happens to be called Untitled", async () => {
    // "Untitled" on a saved model is a name somebody left alone, not an unfilled blank. The display
    // may prefer the company's name, but the stored document is not touched.
    serverDoc = { ...docs.demoDoc(), name: "Untitled" };
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(sub(container)).toMatch(/^Celadyne Energy ·/));
    await new Promise(r => setTimeout(r, 400));
    expect(uploaded).toEqual([]);
    expect(serverDoc.name).toBe("Untitled");   // the stored document, untouched
  });
});

describe("the display falls back in order", () => {
  it("chosen name, then the company's, then a placeholder", async () => {
    const { RunwayApp } = await import("../../src/App.jsx");
    const withCash = { ...docs.emptyDoc(), cash: 100000 };

    const a = render(<RunwayApp doc={{ ...withCash, name: "Chosen" }} setDoc={() => {}} companyName="Celadyne" />);
    expect(sub(a.container)).toMatch(/^Chosen ·/);
    a.unmount();

    const b = render(<RunwayApp doc={{ ...withCash, name: "Untitled" }} setDoc={() => {}} companyName="Celadyne" />);
    expect(sub(b.container)).toMatch(/^Celadyne ·/);
    b.unmount();

    const c = render(<RunwayApp doc={{ ...withCash, name: "" }} setDoc={() => {}} />);
    expect(sub(c.container)).toMatch(/^Untitled model ·/);
  });

  it("keeps the rail input's value RAW so typing still works", async () => {
    const { RunwayApp } = await import("../../src/App.jsx");
    let doc = { ...docs.emptyDoc(), cash: 100000, name: "" };
    const { container } = render(
      <RunwayApp doc={doc} setDoc={(v) => { doc = typeof v === "function" ? v(doc) : v; }} companyName="Celadyne" />);
    const input = container.querySelector(".docname");
    // The company name is the PLACEHOLDER, not the value — a value would make the field un-clearable.
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Celadyne");
    fireEvent.change(input, { target: { value: "Typed" } });
    expect(doc.name).toBe("Typed");
  });
});

describe("the demo", () => {
  it("is hardcoded, because it has no account to take a name from", async () => {
    window.location.hash = "#demo";
    sync.enableHostedSync({
      authClient: fakeAuthClient(null), env: full,
      fetchImpl: async () => { throw new Error("the demo must not ask the account anything"); },
    });
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Demo ·/));
    expect(sub(container)).toMatch(/^Demo Company ·/);
  });
});
