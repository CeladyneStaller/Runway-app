import { describe, it, expect } from "vitest";
import { collectContext, FEEDBACK_KINDS, hintFor } from "../../src/state/feedback.js";

describe("⚠️ collectContext is a security boundary", () => {
  it("SENDS NOTHING FROM THE MODEL", () => {
    // Everything else in this feature is a form. **This is the part that could leak a financial
    // model**, so it is an allow-list rather than a redaction — copying the document and deleting the
    // sensitive keys is the version that leaks the field somebody adds next year.
    const ctx = collectContext(
      { view: "flow", subtab: "net" },
      { plan: "collaborative", companyName: "Ridgeline Catalysis" });
    const banned = ["cash", "rows", "lines", "employees", "projects", "pos", "rounds", "saas",
                    "runway", "amount", "salary", "balance", "history", "doc", "parts"];
    for (const key of Object.keys(ctx)) expect(banned, key).not.toContain(key);
  });

  it("sends the company NAME and nothing else about it", () => {
    // Enough for a reply to say which model, without the reply containing the model.
    const ctx = collectContext({}, { companyName: "Tidewater Restoration Alliance" });
    expect(ctx.company).toBe("Tidewater Restoration Alliance");

    // ⚠️ MY FIRST VERSION BANNED FOUR-DIGIT NUMBERS AND CAUGHT THE YEAR. `2026`, `1024` and the
    // timestamp are the app version, the viewport and the clock — **the test asserted the absence of
    // DIGITS, not the absence of DATA**, and would have failed on any machine with a wide screen.
    //
    // The boundary is about which KEYS are allowed out, which is what `collectContext` actually
    // controls. Every value is either a fixed set of strings or a number the app itself generated.
    const allowed = ["tab", "subtab", "plan", "company", "app", "ua", "viewport", "lang", "at"];
    expect(Object.keys(ctx).sort()).toEqual([...allowed].sort());
  });

  it("survives being called with nothing", () => {
    // The demo path has no company, no plan and no account.
    const ctx = collectContext();
    expect(ctx.company).toBeNull();
    expect(ctx.plan).toBeNull();
    expect(ctx.app).toBeTruthy();
  });

  it("⚠️ EVERY KIND HAS AN EXAMPLE, NOT AN INSTRUCTION", () => {
    // "Please describe the issue in detail" produces one line; a sentence in the voice of a real
    // report produces a real report, because it demonstrates the LEVEL of detail.
    expect(FEEDBACK_KINDS).toHaveLength(3);
    for (const k of FEEDBACK_KINDS) {
      expect(hintFor(k.id), k.id).toBeTruthy();
      expect(hintFor(k.id), k.id).not.toMatch(/^(Please|Describe|Tell us)/);
      expect(hintFor(k.id).endsWith("."), k.id).toBe(true);
    }
  });
});
