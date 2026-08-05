import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { SetPassword } from "../../src/views/SetPassword";
import { TERMS_VERSION } from "../../src/state/plans";

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
