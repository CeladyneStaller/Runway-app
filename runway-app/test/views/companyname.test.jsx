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

    // The rail's name field is gone; the subtitle reads the COMPANY name, which is now the only name.
    await waitFor(() => expect(sub(container)).toMatch(/^Celadyne Energy ·/));
  });

  it("needs no seeding at all, because nothing copies the company name into the document", async () => {
    // WAS: "still seeds the name for anybody who skips the wizard". The seed existed so the rail's
    // name field had something to show; the display reads the company name directly now, so there is
    // nothing to seed and one fewer render-triggered write to the document.
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Set up your company/i));
    fireEvent.click(btn(container, /^Cancel$/));
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
  it("NEVER REWRITES the document just to display a name", async () => {
    // The old effect copied the company name into `doc.name` whenever the model name looked like a
    // default — a write triggered by a render, on data nobody asked to change. The display reads the
    // company name directly now, so there is nothing to seed and nothing to upload.
    serverDoc = { ...docs.demoDoc(), name: "Acme Holdings" };
    goHosted();
    const { container } = render(<App />);
    await waitFor(() => expect(sub(container)).toMatch(/^Celadyne Energy ·/));
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

describe("the model name is gone", () => {
  // EVERY COMPANY HAS A NAME, and the model name was a SECOND string for the same object with its own
  // fallback chain — chosen name, then company name, then a placeholder. Two names for one thing is a
  // question nobody should have to answer, and the sidebar was already falling back to the company
  // name whenever it could. `doc.name` stays in the document so old exports still import; nothing
  // reads it.
  it("shows the COMPANY name, whatever the document happens to carry", async () => {
    const { RunwayApp } = await import("../../src/App.jsx");
    const withCash = { ...docs.emptyDoc(), cash: 100000 };

    const a = render(<RunwayApp doc={{ ...withCash, name: "A stale model name" }} setDoc={() => {}}
                                companyName="Celadyne" />);
    expect(sub(a.container)).toMatch(/^Celadyne ·/);
    a.unmount();

    const b = render(<RunwayApp doc={{ ...withCash, name: "" }} setDoc={() => {}} />);
    expect(sub(b.container)).toMatch(/^Untitled model ·/);
  });

  it("offers no name field in the rail", async () => {
    const { RunwayApp } = await import("../../src/App.jsx");
    const { container } = render(
      <RunwayApp doc={{ ...docs.emptyDoc(), cash: 100000 }} setDoc={() => {}} companyName="Celadyne" />
    );
    expect(container.querySelector(".docname")).toBeNull();
  });

  it("offers no export or import in the rail", async () => {
    // Import replaces the model every member of the company sees. One click from every screen, beside
    // the navigation, was the most destructive control in the product in the least guarded place.
    const { RunwayApp } = await import("../../src/App.jsx");
    const { container } = render(
      <RunwayApp doc={{ ...docs.emptyDoc(), cash: 100000 }} setDoc={() => {}} companyName="Celadyne" />
    );
    const rail = container.querySelector(".rail");
    expect(rail.textContent).not.toMatch(/Export|Import/);
    expect(rail.querySelector('input[type="file"]')).toBeNull();
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
