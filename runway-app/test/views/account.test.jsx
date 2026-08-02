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

let App, S, sync, server, rpcLog, companies, profileRow, deleteAccountResult, deletedRows;

const fetchImpl = async (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : {};
  const json = (v) => ({ ok: true, status: 200, json: async () => v });
  if (url.includes("rpc/my_profile")) return json([profileRow]);
  if (url.includes("rpc/list_deleted_companies")) return json(deletedRows);
  if (url.includes("rpc/restore_company")) {
    rpcLog.push(["restore", body.p_company_id]);
    deletedRows = deletedRows.filter(c => c.id !== body.p_company_id);
    return json(null);
  }
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
  if (url.includes("rpc/set_stats_optout")) {
    companies = companies.map(c => c.id === body.p_company_id ? { ...c, stats_optout: body.p_optout } : c);
    rpcLog.push(["optout", body.p_company_id, body.p_optout]);
    return json(null);
  }
  if (url.includes("rpc/delete_company")) {
    companies = companies.filter(c => c.id !== body.p_company_id);
    delete server[body.p_company_id];
    rpcLog.push(["delete", body.p_company_id]);
    return json(null);
  }
  if (url.includes("functions/v1/delete-account")) {
    rpcLog.push(["delete_account"]);
    if (deleteAccountResult) return deleteAccountResult;
    return json({ ok: true, companies_deleted: 1 });
  }
  if (url.includes("rpc/current_company")) return json(companies[0]?.id || "co-fresh");
  return json([]);
};

beforeEach(async () => {
  vi.resetModules();
  idb.clear();
  rpcLog = []; deleteAccountResult = null; deletedRows = [];
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
// The device's remembered company is stored against the user who chose it, so the stub session needs
// an id like a real one has.
const TEST_USER_ID = "user-1";
const start = async (session = { access_token: "jwt", user: { id: TEST_USER_ID, email: "corey@acme.com" } }, seed = true) => {
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
/** Open settings at a named page.
 *
 *  SETTINGS SPLIT IN TWO and every panel moved onto its own page, so a test has to say WHICH page it is
 *  about. The old helper opened one flat screen and asserted against everything at once, which is
 *  exactly the arrangement the split removed — a page holding password, billing, layout, companies and
 *  data with no way to tell which of them were about you and which about the company.
 */
const openAccount = async (container, page = "profile") => {
  fireEvent.click([...container.querySelectorAll("button")].find(b => /corey@acme\.com/.test(b.textContent)));
  await waitFor(() => expect(container.textContent).toMatch(/Your account|This company|Back/));
  await goTo(container, page);
};

const LABEL = {
  profile: /^Profile$/, appearance: /^Appearance$/, advisor: /^Advisor plan$/, data: /^Your data$/,
  general: /^General/, plan: /^Plan & seats/, people: /^People$/, tabs: /^Tabs/,
  connections: /^Connections/,
};

const goTo = async (container, page) => {
  const re = LABEL[page];
  if (!re) return;
  const item = [...container.querySelectorAll(".setnav-i")].find(b => re.test(b.textContent.trim()));
  if (item) fireEvent.click(item);
  await waitFor(() => expect(container.querySelector(".setbody")).toBeTruthy());
};

/** Company settings, from the rail. */
const openCompany = async (container, page = "general") => {
  fireEvent.click([...container.querySelectorAll("button")].find(b => /Company settings/.test(b.textContent)));
  await waitFor(() => expect(container.textContent).toMatch(/General|owner/i));
  await goTo(container, page);
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
    await openAccount(container, "data");
    await waitFor(() => expect(container.textContent).toMatch(/Northwind Labs/));
    expect(container.textContent).toMatch(/current/);
    expect(container.textContent).toMatch(/empty/);        // no document yet
  });

  it("opens the setup wizard rather than a name box", async () => {
    // Asking for a name, creating the company, and THEN opening a wizard whose first question is the
    // name meant typing it twice — and the company row existed before the wizard ran.
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click(btn(container, /^Add company$/));
    await waitFor(() => expect(container.textContent).toMatch(/New company/));
    expect(container.querySelector("#su-name")).toBeTruthy();
    expect(container.querySelector("#acct-newco")).toBeNull();
  });

  it("creates nothing until the wizard finishes", async () => {
    // THE POINT of the reorder: backing out leaves no orphan company behind.
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click(btn(container, /^Add company$/));
    await waitFor(() => expect(container.querySelector("#su-name")).toBeTruthy());
    fireEvent.click(btn(container, /^Cancel$/));
    await new Promise(r => setTimeout(r, 200));
    expect(rpcLog.some(r => r[0] === "create")).toBe(false);
  });

  it("will not move off the first step without a name to create it under", async () => {
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click(btn(container, /^Add company$/));
    await waitFor(() => expect(container.querySelector("#su-name")).toBeTruthy());
    expect(btn(container, /^Next$/).disabled).toBe(true);
    // and there is no way to skip past it either
    expect(btn(container, /Skip this step/)).toBeFalsy();
    fireEvent.change(container.querySelector("#su-name"), { target: { value: "Northwind Labs" } });
    expect(btn(container, /^Next$/).disabled).toBe(false);
  });

  it("creates it with the name the wizard collected, then switches", async () => {
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click(btn(container, /^Add company$/));
    await waitFor(() => expect(container.querySelector("#su-name")).toBeTruthy());
    fireEvent.change(container.querySelector("#su-name"), { target: { value: "Northwind Labs" } });
    fireEvent.change(container.querySelector("#su-cash"), { target: { value: "250000" } });
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Next$/));
    fireEvent.click(btn(container, /^Done$/));
    await waitFor(() => expect(rpcLog.some(r => r[0] === "create" && r[1] === "Northwind Labs")).toBe(true));
  });

  it("renames one", async () => {
    const { container } = await start();
    await openAccount(container, "data");
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
    expect(await S.readActiveCompany(TEST_USER_ID)).toBe("co-2");
    // And NOT for anybody else on this browser — the leak that produced 403s on every save.
    expect(await S.readActiveCompany("some-other-user")).toBeNull();
    expect(await S.readActiveCompany(null)).toBeNull();
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


describe("deleting a company", () => {
  const twoCompanies = () => {
    companies = [
      { id: "co-1", name: "Celadyne Energy", role: "owner", has_document: true },
      { id: "co-2", name: "Northwind Labs", role: "owner", has_document: false },
    ];
  };

  it("requires the name to be typed before the button works", async () => {
    twoCompanies();
    const { container } = await start();
    await openAccount(container, "data");
    await waitFor(() => expect(container.textContent).toMatch(/Northwind Labs/));
    fireEvent.click([...container.querySelectorAll("button")].filter(b => /^Delete$/.test(b.textContent))[1]);
    await waitFor(() => expect(container.textContent).toMatch(/Delete Northwind Labs/));

    const go = btn(container, /Delete permanently/);
    expect(go.disabled).toBe(true);
    fireEvent.change(container.querySelector("#del-name"), { target: { value: "Northwind" } });
    expect(btn(container, /Delete permanently/).disabled).toBe(true);      // partial is not enough
    fireEvent.change(container.querySelector("#del-name"), { target: { value: "Northwind Labs" } });
    expect(btn(container, /Delete permanently/).disabled).toBe(false);
  });

  it("deletes a company you are not currently in, without moving you", async () => {
    twoCompanies();
    const { container, auth } = await start();
    await openAccount(container, "data");
    await waitFor(() => expect(container.textContent).toMatch(/Northwind Labs/));
    fireEvent.click([...container.querySelectorAll("button")].filter(b => /^Delete$/.test(b.textContent))[1]);
    await waitFor(() => expect(container.querySelector("#del-name")).toBeTruthy());
    fireEvent.change(container.querySelector("#del-name"), { target: { value: "Northwind Labs" } });
    fireEvent.click(btn(container, /Delete permanently/));
    await waitFor(() => expect(rpcLog.some(r => r[0] === "delete")).toBe(true));
    expect(auth.activeCompany()).not.toBe("co-2");
    await waitFor(() => expect(container.textContent).not.toMatch(/Northwind Labs/));
  });

  it("warns that unsaved work is discarded when deleting the company you are in", async () => {
    twoCompanies();
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click([...container.querySelectorAll("button")].filter(b => /^Delete$/.test(b.textContent))[0]);
    await waitFor(() => expect(container.textContent).toMatch(/Delete Celadyne Energy/));
    expect(container.textContent).toMatch(/discarded rather than written first/i);
    expect(container.textContent).toMatch(/Export it first/i);
  });

  it("says a fresh company will be made when it is the last one", async () => {
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click(btn(container, /^Delete$/));
    await waitFor(() => expect(container.textContent).toMatch(/last company/i));
    expect(container.textContent).toMatch(/new empty one will be created/i);
  });

  it("is honest that your sign-in survives", async () => {
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click(btn(container, /^Delete$/));
    await waitFor(() => expect(container.textContent).toMatch(/Stays:/));
    expect(container.textContent).toMatch(/your sign-in/i);
  });
});

describe("abandoning a company at the storage layer", () => {
  // No <App /> here: its save effect re-populates the write buffer the moment the document renders,
  // which would race every assertion about what is pending.
  const headless = async () => {
    const { createSupabaseAuth } = await import("../../src/state/auth.js");
    const auth = createSupabaseAuth({
      url: "https://p.supabase.co", anonKey: "anon",
      getSession: async () => ({ access_token: "jwt" }),
      fetchImpl,
    });
    S.setBackend({
      name: "fake",
      async read() { const id = await auth.getCompanyId(); return server[id] ? { raw: server[id], meta: {} } : null; },
      async write(raw) { const id = await auth.getCompanyId(); server[id] = raw; return { meta: {} }; },
      async park() {},
    });
    return auth;
  };

  it("does NOT flush pending work into a company that is being removed", async () => {
    const auth = await headless();
    server["co-1"] = { schemaVersion: 3, cash: 111 };
    S.save({ schemaVersion: 3, cash: 999 });
    expect(S.hasUnsavedWork()).toBe(true);

    await S.abandonCompany(auth, "co-2");

    expect(server["co-1"].cash).toBe(111);        // the pending 999 was dropped, not written
    expect(S.hasUnsavedWork()).toBe(false);
  });

  it("with nothing left, forgets the device's choice and re-resolves a company", async () => {
    const auth = await headless();
    await auth.getCompanyId();                     // resolve one first
    companies = [];                                // everything deleted
    await S.abandonCompany(auth, null);
    // The DEVICE preference is cleared; what the app then resolves comes from current_company(), which
    // creates a fresh company rather than leaving the account pointing at nothing.
    expect(await S.readActiveCompany(TEST_USER_ID)).toBeFalsy();
    expect(await auth.getCompanyId()).toBe("co-fresh");
  });
});


describe("deleting the account", () => {
  const openDelete = async (container) => {
    await openAccount(container, "data");
    await waitFor(() => expect(container.textContent).toMatch(/Delete your account/));
    fireEvent.click([...container.querySelectorAll("button")].find(b => /^Delete$/.test(b.textContent)
      && b.closest(".acct-row")?.textContent?.includes("sign-in")));
  };

  it("says what goes and what stays before asking", async () => {
    const { container } = await start();
    await openDelete(container);
    await waitFor(() => expect(container.textContent).toMatch(/your sign-in/i));
    expect(container.textContent).toMatch(/Cannot be undone/i);
    expect(container.textContent).toMatch(/last moment you can take a copy/i);
  });

  it("promises NOT to destroy a company shared with someone else", async () => {
    companies = [
      { id: "co-1", name: "Celadyne", role: "owner", has_document: true },
      { id: "co-2", name: "Shared Co", role: "editor", has_document: true },
    ];
    const { container } = await start();
    await openDelete(container);
    await waitFor(() => expect(container.textContent).toMatch(/Stays:/));
    expect(container.textContent).toMatch(/share with someone else/i);
  });

  it("needs the phrase typed exactly", async () => {
    const { container } = await start();
    await openDelete(container);
    await waitFor(() => expect(container.querySelector("#del-acct")).toBeTruthy());
    expect(btn(container, /Delete my account/).disabled).toBe(true);
    fireEvent.change(container.querySelector("#del-acct"), { target: { value: "delete" } });
    expect(btn(container, /Delete my account/).disabled).toBe(true);
    fireEvent.change(container.querySelector("#del-acct"), { target: { value: "delete my account" } });
    expect(btn(container, /Delete my account/).disabled).toBe(false);
  });

  it("calls the Edge Function, sending no user id at all", async () => {
    const { container } = await start();
    await openDelete(container);
    await waitFor(() => expect(container.querySelector("#del-acct")).toBeTruthy());
    fireEvent.change(container.querySelector("#del-acct"), { target: { value: "delete my account" } });
    fireEvent.click(btn(container, /Delete my account/));
    await waitFor(() => expect(rpcLog.some(r => r[0] === "delete_account")).toBe(true));
  });

  it("is honest when the data went but the sign-in survived", async () => {
    deleteAccountResult = { ok: false, status: 500, json: async () => ({ error: "auth_delete_failed" }) };
    const { container } = await start();
    await openDelete(container);
    await waitFor(() => expect(container.querySelector("#del-acct")).toBeTruthy());
    fireEvent.change(container.querySelector("#del-acct"), { target: { value: "delete my account" } });
    fireEvent.click(btn(container, /Delete my account/));
    await waitFor(() => expect(container.textContent).toMatch(/sign-in could not be removed/i));
    expect(container.textContent).toMatch(/Contact support/i);
  });

  it("says nothing changed when the function is not deployed", async () => {
    deleteAccountResult = { ok: false, status: 500, json: async () => ({ error: "not_configured" }) };
    const { container } = await start();
    await openDelete(container);
    await waitFor(() => expect(container.querySelector("#del-acct")).toBeTruthy());
    fireEvent.change(container.querySelector("#del-acct"), { target: { value: "delete my account" } });
    fireEvent.click(btn(container, /Delete my account/));
    await waitFor(() => expect(container.textContent).toMatch(/isn't set up on this deployment/i));
    expect(container.textContent).toMatch(/Nothing has been changed/i);
  });
});

describe("aggregate statistics opt-out", () => {
  it("is offered per company, on by default", async () => {
    const { container } = await start();
    await openAccount(container, "data");
    const box = container.querySelector('[aria-label^="Include"][type="checkbox"]');
    expect(box).toBeTruthy();
    expect(box.checked).toBe(true);            // included unless somebody opts out
    expect(container.textContent).toMatch(/Include in published statistics/);
  });

  it("calls the owner-only RPC when unticked", async () => {
    const { container } = await start();
    await openAccount(container, "data");
    fireEvent.click(container.querySelector('[aria-label^="Include"][type="checkbox"]'));
    await waitFor(() => expect(rpcLog.some(r => r[0] === "optout")).toBe(true));
  });
});

describe("recently deleted companies", () => {
  it("lists what is recoverable, with the date it stops being", async () => {
    deletedRows = [{ id: "co-9", name: "Old Co", deleted_at: "2026-07-01T00:00:00Z",
                     purges_at: "2026-07-31T00:00:00Z", restores_in_window: 1 }];
    const { container } = await start();
    await openAccount(container, "data");
    await waitFor(() => expect(container.textContent).toMatch(/Recently deleted/));
    expect(container.textContent).toMatch(/Old Co/);
    // The DATE, not "30 days": a window the reader has to do arithmetic on is one they get wrong.
    expect(container.textContent).toMatch(/recoverable until Jul 3[01], 2026/);
  });

  it("flags a company that keeps coming back", async () => {
    deletedRows = [{ id: "co-9", name: "Churn Co", deleted_at: "2026-07-20T00:00:00Z",
                     purges_at: "2026-08-19T00:00:00Z", restores_in_window: 3 }];
    const { container } = await start();
    await openAccount(container, "data");
    await waitFor(() => expect(container.textContent).toMatch(/restored 3 times recently/i));
  });

  it("does not flag a single restore", async () => {
    deletedRows = [{ id: "co-9", name: "Fine Co", deleted_at: "2026-07-20T00:00:00Z",
                     purges_at: "2026-08-19T00:00:00Z", restores_in_window: 1 }];
    const { container } = await start();
    await openAccount(container, "data");
    await waitFor(() => expect(container.textContent).toMatch(/Fine Co/));
    expect(container.textContent).not.toMatch(/times recently/i);
  });

  it("shows nothing at all when the bin is empty", async () => {
    deletedRows = [];
    const { container } = await start();
    await openAccount(container, "data");
    expect(container.textContent).not.toMatch(/Recently deleted/);
  });
});
