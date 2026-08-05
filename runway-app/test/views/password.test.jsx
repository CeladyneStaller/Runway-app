// Password creation, sign-in, reset and recovery. The rules module is pure and tested first; the screens
// are then checked for the things that actually go wrong — a submit button that lets through a password
// the server will reject, and a reset link that lands you somewhere you cannot change your password.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { passwordRules, passwordOk, MIN_LENGTH } from "../../src/engine/password.js";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, keys: async () => [], clear: async () => {} }));

const full = { VITE_SYNC_ENABLED: "true", VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_ANON_KEY: "anon" };

function fakeAuthClient({ session = null, signUpSession = { access_token: "jwt" } } = {}) {
  let current = session;
  const listeners = new Set();
  return {
    calls: { signUp: [], pwSignIn: [], reset: [], update: [], otp: [] },
    async getSession() { return { data: { session: current }, error: null }; },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async signUp(a) { this.calls.signUp.push(a); return { data: { session: signUpSession }, error: null }; },
    async signInWithPassword(a) { this.calls.pwSignIn.push(a); return { data: {}, error: null }; },
    async signInWithOtp(a) { this.calls.otp.push(a); return { error: null }; },
    async signInWithOAuth() { return { error: null }; },
    async resetPasswordForEmail(email, opts) { this.calls.reset.push({ email, opts }); return { error: null }; },
    async updateUser(a) { this.calls.update.push(a); return { error: null }; },
    async signOut() { current = null; listeners.forEach(f => f("SIGNED_OUT", null)); return { error: null }; },
    _recovery(s) { current = s; listeners.forEach(f => f("PASSWORD_RECOVERY", s)); },
  };
}

let App, sync, S;
beforeEach(async () => {
  vi.resetModules();
  S = await import("../../src/state/storage.js");
  sync = await import("../../src/state/sync.js");
  App = (await import("../../src/App.jsx")).default;
  S._resetWriteState();
});

const hosted = (client) => sync.enableHostedSync({
  authClient: client, env: full,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
});
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));

describe("the rules are data, not a score", () => {
  it("names each requirement so the user knows what to change", () => {
    const rules = passwordRules("short", { email: "a@b.com", confirm: "short" });
    expect(rules.map(r => r.id)).toEqual(["length", "common", "email", "match"]);
    expect(rules.find(r => r.id === "length").ok).toBe(false);
  });

  it("rejects a long but obvious password", () => {
    expect(passwordOk("password123", { email: "a@b.com", confirm: "password123" })).toBe(false);
  });

  it("rejects a password containing the email name", () => {
    expect(passwordOk("corey-is-great", { email: "corey@acme.com", confirm: "corey-is-great" })).toBe(false);
  });

  it("does not ban a short email stem that is just a common word", () => {
    // "al@x.com" must not make "al" a forbidden substring of every password
    expect(passwordOk("alpineledger7", { email: "al@x.com", confirm: "alpineledger7" })).toBe(true);
  });

  it("requires the confirmation to match", () => {
    expect(passwordOk("winter-ledger-88", { email: "a@b.com", confirm: "winter-ledger-8" })).toBe(false);
    expect(passwordOk("winter-ledger-88", { email: "a@b.com", confirm: "winter-ledger-88" })).toBe(true);
  });

  it(`enforces a minimum of ${MIN_LENGTH}`, () => {
    expect(passwordOk("a".repeat(MIN_LENGTH - 1) + "9", { email: "a@b.com", confirm: "a".repeat(MIN_LENGTH - 1) + "9" })).toBe(true);
    expect(passwordOk("Ab3!x", { email: "a@b.com", confirm: "Ab3!x" })).toBe(false);
  });
});

describe("creating an account", () => {
  const start = async () => {
    const client = fakeAuthClient();
    hosted(client);
    const r = render(<App />);
    // A landing fork now sits in front of the form; "Get started" is the create-account door.
    await waitFor(() => expect(r.container.textContent).toMatch(/Know your runway/));
    fireEvent.click([...r.container.querySelectorAll("button")].find(b => /Get started/.test(b.textContent)));
    await waitFor(() => expect(r.container.textContent).toMatch(/follows you between devices/i));
    return { ...r, client };
  };

  it("collects the email, then moves to choosing a password", async () => {
    const { container } = await start();
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "corey@acme.com" } });
    fireEvent.click(btn(container, /^Continue$/));
    await waitFor(() => expect(container.textContent).toMatch(/Choose a password/));
    expect(container.textContent).toMatch(new RegExp(`At least ${MIN_LENGTH} characters`));
  });

  // AGREEING IS NOW PART OF BEING ABLE TO SUBMIT. These three tests broke when the terms checkbox was
  // added and were not caught, because the run at the time was scoped to `s*.jsx` and `t*.jsx` and this
  // file is `p`. A glob is not a test run.
  const agree = (c) => fireEvent.click(c.querySelector('input[type="checkbox"]'));

  it("keeps the button disabled until every rule passes", async () => {
    const { container } = await start();
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "corey@acme.com" } });
    fireEvent.click(btn(container, /^Continue$/));
    await waitFor(() => expect(container.querySelector("#pw-new")).toBeTruthy());

    const submit = () => btn(container, /Create account/);
    expect(submit().disabled).toBe(true);
    fireEvent.change(container.querySelector("#pw-new"), { target: { value: "winter-ledger-88" } });
    expect(submit().disabled).toBe(true);                       // confirm still empty
    fireEvent.change(container.querySelector("#pw-confirm"), { target: { value: "winter-ledger-88" } });
    expect(submit().disabled).toBe(true);                       // terms not agreed
    agree(container);
    expect(submit().disabled).toBe(false);
  });

  it("signs up with the chosen password", async () => {
    const { container, client } = await start();
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "corey@acme.com" } });
    fireEvent.click(btn(container, /^Continue$/));
    await waitFor(() => expect(container.querySelector("#pw-new")).toBeTruthy());
    fireEvent.change(container.querySelector("#pw-new"), { target: { value: "winter-ledger-88" } });
    fireEvent.change(container.querySelector("#pw-confirm"), { target: { value: "winter-ledger-88" } });
    agree(container);
    fireEvent.click(btn(container, /Create account/));
    await waitFor(() => expect(client.calls.signUp).toHaveLength(1));
    expect(client.calls.signUp[0].email).toBe("corey@acme.com");
    expect(client.calls.signUp[0].password).toBe("winter-ledger-88");
  });

  it("says so when the project requires email confirmation, instead of appearing to do nothing", async () => {
    const client = fakeAuthClient({ signUpSession: null });   // no session back => confirmation pending
    hosted(client);
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    fireEvent.click(btn(container, /Get started/));
    await waitFor(() => expect(container.textContent).toMatch(/follows you between devices/i));
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "corey@acme.com" } });
    fireEvent.click(btn(container, /^Continue$/));
    await waitFor(() => expect(container.querySelector("#pw-new")).toBeTruthy());
    fireEvent.change(container.querySelector("#pw-new"), { target: { value: "winter-ledger-88" } });
    fireEvent.change(container.querySelector("#pw-confirm"), { target: { value: "winter-ledger-88" } });
    agree(container);
    fireEvent.click(btn(container, /Create account/));
    await waitFor(() => expect(container.textContent).toMatch(/Confirm your email/));
    expect(container.textContent).toMatch(/turn off email confirmation/i);
  });
});

describe("signing in with a password", () => {
  it("shows a password field only in sign-in mode", async () => {
    hosted(fakeAuthClient());
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    expect(container.querySelector("#signin-password")).toBeNull();     // create mode
    fireEvent.click(btn(container, /^Sign in$/));
    await waitFor(() => expect(container.querySelector("#signin-password")).toBeTruthy());
  });

  it("calls the password sign-in", async () => {
    const client = fakeAuthClient();
    hosted(client);
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    fireEvent.click(btn(container, /^Sign in$/));
    await waitFor(() => expect(container.querySelector("#signin-password")).toBeTruthy());
    fireEvent.change(container.querySelector("#signin-email"), { target: { value: "corey@acme.com" } });
    fireEvent.change(container.querySelector("#signin-password"), { target: { value: "winter-ledger-88" } });
    // the mode tab and the submit button both read "Sign in" — target the submit, not the tab
    fireEvent.click(container.querySelector("button.addbtn.signin-go"));
    await waitFor(() => expect(client.calls.pwSignIn.length).toBeGreaterThan(0));
    expect(client.calls.pwSignIn[0].email).toBe("corey@acme.com");
  });
});

describe("forgotten password", () => {
  it("sends a reset link and confirms where it went", async () => {
    const client = fakeAuthClient();
    hosted(client);
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    fireEvent.click(btn(container, /^Sign in$/));
    await waitFor(() => expect(container.textContent).toMatch(/Forgotten your password/));
    fireEvent.click(btn(container, /Forgotten your password/));
    await waitFor(() => expect(container.textContent).toMatch(/Reset your password/));
    fireEvent.change(container.querySelector("#reset-email"), { target: { value: "corey@acme.com" } });
    fireEvent.click(btn(container, /Send reset link/));
    await waitFor(() => expect(client.calls.reset).toHaveLength(1));
    expect(container.textContent).toMatch(/corey@acme\.com/);
  });
});

describe("landing from a reset link", () => {
  it("shows the password screen, NOT the dashboard", async () => {
    // Supabase hands you a real session on recovery, so without reading the event this looks like an
    // ordinary sign-in — and dumps someone on a dashboard with no way to do what they came for.
    const client = fakeAuthClient();
    hosted(client);
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    client._recovery({ access_token: "jwt", user: { email: "corey@acme.com" } });
    await waitFor(() => expect(container.textContent).toMatch(/Set a new password/));
  });

  it("saves the new password and lets you through", async () => {
    const client = fakeAuthClient();
    hosted(client);
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toMatch(/Know your runway/));
    client._recovery({ access_token: "jwt", user: { email: "corey@acme.com" } });
    await waitFor(() => expect(container.querySelector("#pw-new")).toBeTruthy());
    fireEvent.change(container.querySelector("#pw-new"), { target: { value: "spring-ledger-42" } });
    fireEvent.change(container.querySelector("#pw-confirm"), { target: { value: "spring-ledger-42" } });
    fireEvent.click(btn(container, /Set password and sign in/));
    await waitFor(() => expect(client.calls.update).toHaveLength(1));
    expect(client.calls.update[0].password).toBe("spring-ledger-42");
    await waitFor(() => expect(container.textContent).not.toMatch(/Set a new password/));
  });
});
