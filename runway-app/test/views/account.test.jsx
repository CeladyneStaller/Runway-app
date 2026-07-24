// The account page and multi-company. The property that matters most is the switching one: a pending
// write belongs to the company you were looking at, and landing it after a switch files your numbers
// against the wrong company.
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
    calls: { pwSignIn: [], update: [] },
    async getSession() { return { data: { session }, error: null }; },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async signInWithPassword(a) { this.calls.pwSignIn.push(a); return { error: null }; },
    async signInWithOtp() { return { error: null }; },
    async signInWithOAuth() { return { error: null }; },
    async signUp() { return { data: { session }, error: null }; },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser(a) { this.calls.update.push(a); return { error: null }; },
    async signOut() { return { error: null }; },
  };
}

let App, S, sync, server, rpcLog, companies, profileRow;

const fetchImpl = async (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : {};
  const json = (v) => ({ ok: true, status: 200, json: async () => v });
  if (url.includes("rpc/my_profile")) return json([profileRow]);
  if (url.includes("rpc/list_companies")) return json(companies);
  if (url.includes("rpc/create_company")) {
    const id = `co-${companies.length + 1}`;
    companies = [...companies, { id, name: body.p_name, role: "owner", has_document: false }];
    rpcLog.push(["create", body.p_name]);
    return json(id);
  }
  if (url.includes("rpc/rename_company")) {
    companies = companies.map(c => c.id === body.p_company_id ? { ...c, name: body.p_name } : c);
    rpcLog.push(["rename", body.p_name]);
    return json(null);
  }
  if (url.includes("rpc/mark_password_set")) { rpcLog.push(["mark_password"]); return json("2026-07-23T00:00:00Z"); }
  if (url.includes("rpc/set_last_company")) { rpcLog.push(["last", body.p_company_id]); return json(null); }
  if (url.includes("rpc/current_company")) return json("co-1");
  return json([]);
};

beforeEach(async () => {
  vi.resetModules();
  idb.clear();
  rpcLog = [];
  server = {};                        // company id -> document
  companies = [{ id: "co-1", name: "Celadyne Energy", role: "owner", has_document: true }];
  profileRow = { password_set_at: null, last_company_id: "co-1" };
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});

// An empty document renders the onboarding screen, which has no top bar — so the UI cases need a real
// document on the server before they can reach the account page.
const start = async (session = { access_token: "jwt", user: { email: "corey@acme.com" } }, seed = true) => {
  if (seed) {
    const { demoDoc } = await import("../../src/state/document.js");
    server["co-1"] = demoDoc();
  }
  const client = fakeAuthClient(session);
  const r = sync.enableHostedSync({ authClient: client, env: full, fetchImpl });
  // a document backend that stores per-company, so switching is observable
  const auth = r.auth;
  S.setBackend({
    name: "fake",
    async read() {
      const id = await auth.getCompanyId();
      return server[id] ? { raw: server[id], meta: { version: 1 } } : null;
    },
    async write(raw) {
      const id = await auth.getCompanyId();
      server[id] = raw;
      return { meta: { version: 2 } };
    },
    async park() {},
  });
  const view = render(<App />);
  // wait for the APP, not merely for the session check to clear — "Loading your model" already
  // satisfies "not checking your session", which let the assertions run against a half-rendered tree
  if (seed) {
    await waitFor(() => expect(
      [...view.container.querySelectorAll("button")].some(b => /corey@acme\.com/.test(b.textContent))
    ).toBe(true), { timeout: 3000 });
  }
  return { ...view, client, auth };
};

const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));
const openAccount = async (container) => {
  fireEvent.click([...container.querySelectorAll("button")].find(b => /corey@acme\.com/.test(b.textContent)));
  await waitFor(() => expect(container.textContent).toMatch(/Companies/));
};

describe("reaching the account page", () => {
  it("opens from the email in the top bar", async () => {
    const { container } = await start();
    await openAccount(container);
    expect(container.textContent).toMatch(/Password/);
    expect(container.textContent).toMatch(/Your data/);
  });
});

describe("password section", () => {
  it("says you have none when you signed in with a link", async () => {
    const { container } = await start();
    await openAccount(container);
    await waitFor(() => expect(container.textContent).toMatch(/signed in with a link/i));
    expect(btn(container, /Set password/)).toBeTruthy();
  });

  it("offers a change form, requiring the current password, once one exists", async () => {
    profileRow = { password_set_at: "2026-07-20T00:00:00Z", last_company_id: "co-1" };
    const { container } = await start();
    await openAccount(container);
    await waitFor(() => expect(container.textContent).toMatch(/You'll need the current one/i));
    expect(container.querySelector("#acct-current")).toBeTruthy();
  });

  it("sets a password and records that one now exists", async () => {
    const { container, client } = await start();
    await openAccount(container);
    await waitFor(() => expect(container.querySelector("#acct-new")).toBeTruthy());
    fireEvent.change(container.querySelector("#acct-new"), { target: { value: "winter-ledger-88" } });
    fireEvent.change(container.querySelector("#acct-confirm"), { target: { value: "winter-ledger-88" } });
    fireEvent.click(btn(container, /Set password/));
    await waitFor(() => expect(client.calls.update).toHaveLength(1));
    expect(client.calls.update[0].password).toBe("winter-ledger-88");
    await waitFor(() => expect(rpcLog.some(r => r[0] === "mark_password")).toBe(true));
  });

  it("verifies the current password before changing it", async () => {
    profileRow = { password_set_at: "2026-07-20T00:00:00Z", last_company_id: "co-1" };
    const { container, client } = await start();
    await openAccount(container);
    await waitFor(() => expect(container.querySelector("#acct-current")).toBeTruthy());
    fireEvent.change(container.querySelector("#acct-current"), { target: { value: "old-one" } });
    fireEvent.change(container.querySelector("#acct-new"), { target: { value: "spring-ledger-42" } });
    fireEvent.change(container.querySelector("#acct-confirm"), { target: { value: "spring-ledger-42" } });
    fireEvent.click(btn(container, /Change password/));
    await waitFor(() => expect(client.calls.pwSignIn).toHaveLength(1));   // checked before updating
    expect(client.calls.pwSignIn[0].password).toBe("old-one");
  });
});

describe("companies", () => {
  it("lists them and marks the current one", async () => {
    companies = [
      { id: "co-1", name: "Celadyne Energy", role: "owner", has_document: true },
      { id: "co-2", name: "Northwind Labs", role: "owner", has_document: false },
    ];
    const { container } = await start();
    await openAccount(container);
    await waitFor(() => expect(container.textContent).toMatch(/Northwind Labs/));
    expect(container.textContent).toMatch(/current/);
    expect(container.textContent).toMatch(/empty/);        // no document yet
  });

  it("adds one and switches to it", async () => {
    const { container } = await start();
    await openAccount(container);
    fireEvent.click(btn(container, /^Add company$/));
    await waitFor(() => expect(container.querySelector("#acct-newco")).toBeTruthy());
    fireEvent.change(container.querySelector("#acct-newco"), { target: { value: "Northwind Labs" } });
    fireEvent.click(btn(container, /Create and switch/));
    await waitFor(() => expect(rpcLog.some(r => r[0] === "create")).toBe(true));
  });

  it("renames one", async () => {
    const { container } = await start();
    await openAccount(container);
    fireEvent.click(btn(container, /Rename/));
    const input = [...container.querySelectorAll("input")].find(i => i.value === "Celadyne Energy");
    fireEvent.change(input, { target: { value: "Celadyne Holdings" } });
    fireEvent.click(btn(container, /^Save$/));
    await waitFor(() => expect(rpcLog.some(r => r[0] === "rename" && r[1] === "Celadyne Holdings")).toBe(true));
  });
});

describe("switching companies", () => {
  it("FLUSHES pending work before switching, so it lands against the right company", async () => {
    const { auth } = await start();
    server["co-1"] = { schemaVersion: 3, cash: 111 };
    companies = [...companies, { id: "co-2", name: "Northwind", role: "owner", has_document: false }];

    S.save({ schemaVersion: 3, cash: 999 });          // unsaved work for co-1
    expect(S.hasUnsavedWork()).toBe(true);

    await S.switchCompany(auth, "co-2");

    expect(server["co-1"].cash).toBe(999);            // landed against co-1, not co-2
    expect(server["co-2"]).toBeUndefined();           // the new company is still empty
  });

  it("resets the write buffer, so the first save in the new company is not suppressed", async () => {
    const { auth } = await start();
    const same = { schemaVersion: 3, cash: 500 };
    server["co-1"] = same;
    S.save(same); await S.flush();

    await S.switchCompany(auth, "co-2");
    S.save(same);                                     // byte-identical to what co-1 held
    await S.flush();
    expect(server["co-2"]).toBeTruthy();              // still written — a different company, different doc
  });

  it("remembers the choice on this device", async () => {
    const { auth } = await start();
    await S.switchCompany(auth, "co-2");
    expect(await S.readActiveCompany()).toBe("co-2");
    expect(auth.activeCompany()).toBe("co-2");
  });

  it("a new company loads as an empty model, not the previous one", async () => {
    const { auth } = await start(undefined, false);
    server["co-1"] = { schemaVersion: 3, cash: 777, employees: [{ id: "e1" }] };
    const r = await S.switchCompany(auth, "co-2");
    expect(r.isNew).toBe(true);
    expect(r.doc.cash).toBe(0);
    expect(r.doc.employees).toHaveLength(0);
  });
});
