// The auth gate and the sign-in screen. The property that matters most is the NEGATIVE one: in hosted
// mode the document must not be requested before there is a session, because a FORBIDDEN read looks —
// from the user's side — exactly like a broken app.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, keys: async () => [], clear: async () => {} }));

const full = { VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_ANON_KEY: "anon" };

// A stand-in for supabase.auth with the same shapes the real one returns.
function fakeAuthClient({ session = null } = {}) {
  let current = session;
  const listeners = new Set();
  return {
    calls: { otp: [], oauth: [], signOut: 0 },
    async getSession() { return { data: { session: current }, error: null }; },
    onAuthStateChange(cb) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    async signInWithOtp(args) { this.calls.otp.push(args); return { data: {}, error: null }; },
    async signInWithOAuth(args) { this.calls.oauth.push(args); return { data: {}, error: null }; },
    async signOut() { this.calls.signOut += 1; current = null; listeners.forEach(f => f("SIGNED_OUT", null)); return { error: null }; },
    _signIn(s) { current = s; listeners.forEach(f => f("SIGNED_IN", s)); },
  };
}

let App, sync, storage, loads;

beforeEach(async () => {
  vi.resetModules();
  loads = 0;
  storage = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  App = (await import("../../src/App.jsx")).default;
  storage._resetWriteState();
});

const hosted = (client, fetchImpl) =>
  sync.enableHostedSync({ authClient: client, env: full, fetchImpl: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => [] })) });

describe("the auth gate", () => {
  it("in LOCAL mode there is nobody to be — the app renders straight away", async () => {
    sync.enableHostedSync({ env: {} });                     // not configured -> local
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Checking your session/));
    expect(container.textContent).not.toMatch(/Sign in/);
  });

  it("in HOSTED mode with no session, it asks you to sign in", async () => {
    hosted(fakeAuthClient({ session: null }));
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Sign in/));
    expect(container.textContent).toMatch(/follows you between devices/i);
  });

  it("does NOT request the document before there is a session", async () => {
    const client = fakeAuthClient({ session: null });
    hosted(client, async (url) => { if (url.includes("/documents")) loads += 1; return { ok: true, status: 200, json: async () => [] }; });
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Sign in/));
    await new Promise(r => setTimeout(r, 100));
    expect(loads).toBe(0);          // the whole point: no FORBIDDEN read masquerading as a broken app
  });

  it("with a session, it renders the app instead of the sign-in screen", async () => {
    hosted(fakeAuthClient({ session: { access_token: "jwt", user: { email: "c@x.com" } } }));
    const { container } = render(<App />);
    // it must get PAST the gate and into the document host, not merely fail to show the gate
    await waitFor(() => expect(container.textContent).toMatch(/Loading your model|Runway|Couldn't open/));
    expect(container.textContent).not.toMatch(/Email me a sign-in link/);
  });

  it("signing in live swaps the screen without a reload", async () => {
    const client = fakeAuthClient({ session: null });
    hosted(client);
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Sign in/));
    client._signIn({ access_token: "jwt", user: { email: "c@x.com" } });
    await waitFor(() => expect(container.textContent).not.toMatch(/Email me a sign-in link/));
  });
});

describe("signing in", () => {
  const screen = async () => {
    const client = fakeAuthClient({ session: null });
    hosted(client);
    const r = render(<App />);
    await waitFor(() => expect(r.container.textContent).toMatch(/Sign in/));
    return { ...r, client };
  };
  const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

  it("sends a magic link and confirms where it went", async () => {
    const { container, client } = await screen();
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "corey@example.com" } });
    fireEvent.click(btn(container, /Email me a sign-in link/));
    await waitFor(() => expect(container.textContent).toMatch(/Check your email/));
    expect(client.calls.otp[0].email).toBe("corey@example.com");
    expect(container.textContent).toMatch(/corey@example\.com/);
  });

  it("refuses an obviously bad address without calling out", async () => {
    const { container, client } = await screen();
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "nope" } });
    fireEvent.click(btn(container, /Email me a sign-in link/));
    await waitFor(() => expect(container.textContent).toMatch(/Enter an email address/));
    expect(client.calls.otp).toHaveLength(0);
  });

  it("Enter submits, because people press Enter", async () => {
    const { container, client } = await screen();
    const input = container.querySelector("#signin-email");
    fireEvent.change(input, { target: { value: "a@b.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.calls.otp).toHaveLength(1));
  });

  it("starts the Google flow", async () => {
    const { container, client } = await screen();
    fireEvent.click(btn(container, /Continue with Google/));
    await waitFor(() => expect(client.calls.oauth).toHaveLength(1));
    expect(client.calls.oauth[0].provider).toBe("google");
  });

  it("shows the provider's own error rather than flattening it to 'something went wrong'", async () => {
    const client = fakeAuthClient({ session: null });
    client.signInWithOtp = async () => ({ error: { message: "Email rate limit exceeded" } });
    hosted(client);
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Sign in/));
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "a@b.com" } });
    fireEvent.click(btn(container, /Email me a sign-in link/));
    await waitFor(() => expect(container.textContent).toMatch(/Email rate limit exceeded/));
  });
});

describe("signing out", () => {
  it("clears the resolved company, so the next user does not inherit this one's document", async () => {
    const client = fakeAuthClient({ session: { access_token: "jwt" } });
    const r = hosted(client, async (url) => ({
      ok: true, status: 200,
      json: async () => (url.includes("current_company") ? "co-first" : []),
    }));
    expect(await r.auth.getCompanyId()).toBe("co-first");
    await client.signOut();                       // the onChange wiring must reset the cache
    await new Promise(res => setTimeout(res, 10));
    expect(r.auth.getCompanyId).toBeTypeOf("function");
    // a fresh resolve now hits the network again rather than returning the cached company
    let asked = 0;
    const r2 = sync.enableHostedSync({
      authClient: client, env: full,
      fetchImpl: async (url) => { if (url.includes("current_company")) asked += 1; return { ok: true, status: 200, json: async () => "co-second" }; },
    });
    client._signIn({ access_token: "jwt2" });
    expect(await r2.auth.getCompanyId()).toBe("co-second");
    expect(asked).toBe(1);
  });
});
