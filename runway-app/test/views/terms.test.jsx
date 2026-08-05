import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { SetPassword } from "../../src/views/SetPassword";
import { TERMS_VERSION } from "../../src/state/plans";
import { TermsGate } from "../../src/views/chrome/TermsGate";

afterEach(cleanup);
const draw = (over = {}) => render(
  <SetPassword mode="create" email="a@b.co" onSubmit={() => {}} onCancel={() => {}} {...over} />);

const strong = "correct-horse-battery-staple-92";
const fill = (v) => {
  const inputs = [...v.container.querySelectorAll('input[type="password"], input[type="text"]')];
  inputs.forEach(i => fireEvent.change(i, { target: { value: strong } }));
};
const go = (v) => [...v.container.querySelectorAll("button")]
  .find(b => /create|continue|set password/i.test(b.textContent));

describe("agreeing to the terms at signup", () => {
  it("asks, and links to both documents", () => {
    const v = draw();
    expect(v.container.textContent).toMatch(/I agree to the/i);
    const hrefs = [...v.container.querySelectorAll("a")].map(a => a.getAttribute("href"));
    expect(hrefs.some(h => /\/terms\//.test(h))).toBe(true);
    expect(hrefs.some(h => /\/privacy\//.test(h))).toBe(true);
  });

  it("opens them in a new tab, so a half-typed password survives being read", () => {
    const v = draw();
    const links = [...v.container.querySelectorAll("a")].filter(a => /terms|privacy/.test(a.href));
    expect(links.length).toBeGreaterThan(0);
    links.forEach(a => expect(a.getAttribute("target")).toBe("_blank"));
  });

  it("REFUSES TO SUBMIT until the box is ticked, however good the password", () => {
    const onSubmit = vi.fn();
    const v = draw({ onSubmit });
    fill(v);
    expect(go(v).disabled).toBe(true);
    fireEvent.click(v.container.querySelector('input[type="checkbox"]'));
    expect(go(v).disabled).toBe(false);
  });

  it("DOES NOT ASK when resetting a password", () => {
    // Somebody resetting agreed a long time ago; asking again would imply the reset was itself a new
    // agreement.
    const v = draw({ mode: "reset" });
    expect(v.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(v.container.textContent).not.toMatch(/I agree to the/i);
  });

  it("the client's version matches the database's", async () => {
    // A client one deploy behind would write an old version string and read as accepted, which makes
    // the whole record worthless.
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/046_terms_acceptance.sql", "utf8");
    const m = /function terms_current\(\)[\s\S]*?select '([^']+)'/.exec(sql);
    expect(m?.[1]).toBe(TERMS_VERSION);
  });

  it("the version is a date, not a counter", () => {
    // It names when the document was published, which is what anybody investigating an acceptance
    // actually wants to know.
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("what signup sends", () => {
  it("carries the version and a timestamp taken at the moment of agreement", async () => {
    // With email confirmation on there is no session at signup, so this cannot be an RPC. Recording it
    // after confirmation would timestamp the confirmation rather than the agreement.
    const { readFileSync } = await import("node:fs");
    const js = readFileSync("src/state/session.js", "utf8");
    expect(js).toMatch(/terms_version: termsVersion/);
    expect(js).toMatch(/terms_accepted_at: new Date\(\)\.toISOString\(\)/);
  });

  it("accept_terms REFUSES a version that is not current", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/046_terms_acceptance.sql", "utf8");
    expect(sql).toMatch(/terms_version_mismatch/);
  });

  it("my_profile copies metadata ONLY when nothing is recorded yet", async () => {
    // Otherwise a later sign-in could overwrite a real acceptance with a fresher timestamp, or a stale
    // client could backdate somebody into terms they never saw.
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/046_terms_acceptance.sql", "utf8");
    expect(sql).toMatch(/p\.terms_version is null/);
  });
});

describe("asking again when the terms change", () => {
  const draw = (over = {}) => render(
    <TermsGate version="2026-09-01" onAccept={async () => {}} onSignOut={() => {}} {...over} />);

  it("shows NOTHING when nothing is required", () => {
    // The common case. `my_profile()` returns null for `terms_required` when the recorded version
    // matches, and the gate must stay entirely out of the way.
    const v = render(<TermsGate version={null} onAccept={() => {}} onSignOut={() => {}} />);
    expect(v.container.textContent).toBe("");
  });

  it("CANNOT BE DISMISSED BY CLICKING AWAY", () => {
    // Every other modal closes on an overlay click. A gate that does would be optional in practice
    // while looking mandatory, and the record it produces would be worth nothing.
    const v = draw();
    const overlay = v.container.querySelector(".modal-overlay");
    expect(overlay.onclick).toBeFalsy();
    fireEvent.click(overlay);
    expect(v.container.textContent).toMatch(/terms have changed/i);
  });

  it("will not accept until the box is ticked", () => {
    const onAccept = vi.fn();
    const v = draw({ onAccept });
    const go = [...v.container.querySelectorAll("button")].find(b => /agree and continue/i.test(b.textContent));
    expect(go.disabled).toBe(true);
    fireEvent.click(v.container.querySelector('input[type="checkbox"]'));
    expect(go.disabled).toBe(false);
  });

  it("sends the version the server asked for, not one of its own", async () => {
    const onAccept = vi.fn().mockResolvedValue();
    const v = draw({ version: "2027-01-01", onAccept });
    fireEvent.click(v.container.querySelector('input[type="checkbox"]'));
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /agree and continue/i.test(b.textContent)));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith("2027-01-01"));
  });

  it("EXPLAINS A STALE TAB rather than looping on a failing button", () => {
    // `accept_terms` rejects any version that is not current, so a browser left open across a change
    // sends the old one. Reloading is the fix and is worth saying.
    const onAccept = vi.fn().mockRejectedValue(new Error("terms_version_mismatch"));
    const v = draw({ onAccept });
    fireEvent.click(v.container.querySelector('input[type="checkbox"]'));
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /agree and continue/i.test(b.textContent)));
    return waitFor(() => expect(v.container.textContent).toMatch(/Reload the page/i));
  });

  it("offers a way out that is not agreeing", () => {
    // Somebody who does not want to agree should not feel trapped — that is a support request and a
    // bad review rather than a decision.
    const onSignOut = vi.fn();
    const v = draw({ onSignOut });
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /sign out/i.test(b.textContent)));
    expect(onSignOut).toHaveBeenCalled();
    expect(v.container.textContent).toMatch(/can still be exported/i);
  });
});
