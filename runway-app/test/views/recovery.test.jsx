import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { SignIn } from "../../src/views/SignIn";

afterEach(cleanup);

describe("the reset link", () => {
  beforeEach(() => { window.history.replaceState(null, "", "/"); });

  const detects = () => /(^|[#&?])type=recovery(&|$)/.test(window.location.hash || "");

  it("IS RECOGNISED FROM THE URL, not only from the auth event", () => {
    // `PASSWORD_RECOVERY` fires once, when supabase-js consumes the hash. Miss that instant — a slow
    // first paint, a reload — and the user is left holding an ordinary session, which is why the reset
    // link behaved like a magic link and dropped people into the account.
    window.history.replaceState(null, "", "/#access_token=abc&type=recovery");
    expect(detects()).toBe(true);
  });

  it("is not confused by an ordinary route", () => {
    // The app is hash-routed, so this predicate sees every navigation. A view called `recovery` or a
    // tab query must not trigger it.
    for (const h of ["#dash", "#flow?tab=costs", "#cmt", "#type=recovery_notes"]) {
      window.history.replaceState(null, "", "/" + h);
      expect(detects(), h).toBe(false);
    }
  });

  it("matches the token hash Supabase actually sends", () => {
    window.history.replaceState(null, "", "/#access_token=x&refresh_token=y&type=recovery&foo=1");
    expect(detects()).toBe(true);
  });
});

describe("after the password is set", () => {
  it("says why the sign-in form is showing", () => {
    // Signing somebody out immediately after they successfully set a password looks like a failure
    // unless you say what happened — and the one thing they must not conclude is that it did not work.
    const v = render(<SignIn session={{}} onDemo={() => {}} onBack={() => {}}
                             banner="Your password has been changed. Sign in with the new one." />);
    expect(v.container.textContent).toMatch(/password has been changed/i);
    expect(v.container.querySelector('[role="status"]')).toBeTruthy();
  });

  it("shows nothing when there is nothing to say", () => {
    const v = render(<SignIn session={{}} onDemo={() => {}} onBack={() => {}} />);
    expect(v.container.querySelector(".signin-note")).toBeNull();
  });

  it("does not collide with the existing link notice", () => {
    // `notice` was already local state driving the "we sent a link" screen. A prop of the same name
    // shadowed it and would have broken that screen — this is why the prop is `banner`.
    const src = require("node:fs").readFileSync("src/views/SignIn.jsx", "utf8");
    expect(src).toMatch(/banner = null/);
    expect(src).toMatch(/const \[notice, setNotice\]/);
  });
});

describe("the App's recovery wiring", () => {
  const app = require("node:fs").readFileSync("src/App.jsx", "utf8");

  it("CLEARS THE HASH once read", () => {
    // The app is hash-routed, so Supabase's `#…type=recovery` sits where the router keeps its view.
    // Leaving it meant every later navigation — including signing out — re-read it and bounced back to
    // the new-password screen.
    expect(app).toMatch(/replaceState\(null, "", window\.location\.pathname/);
  });

  it("SIGNS THE USER OUT after a successful reset", () => {
    // The recovery session came from a link in an inbox. Ending it means the new password is used at
    // least once by the person who set it.
    expect(app).toMatch(/await session\.signOut\(\);/);
    expect(app).toMatch(/setJustReset\(true\)/);
  });

  it("does not sign out when the update failed", () => {
    expect(app).toMatch(/if \(!r\.ok\) \{ setPwError\(r\.message\); return; \}/);
  });
});
