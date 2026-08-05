import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VIEWS } from "../../src/state/hashroute.js";

describe("every tab in the nav is routable", () => {
  // THE BUG THIS CATCHES, which will recur every time a tab is added:
  //
  // `cmt` was in the NAV and not in `VIEWS`. `parse()` falls back to the default for an unknown view,
  // so clicking Commitments rewrote the hash to `dash` and landed on the dashboard — EXCEPT from the
  // dashboard itself, where the hash does not change and React state alone carries the click, so the
  // tab appeared to work. That asymmetry is what made it look tab-specific rather than routing-wide.
  //
  // Reading the NAV out of App.jsx rather than restating it here is the point: a list retyped in a test
  // is a list that drifts, and this test would then pass while the bug returned.
  const app = readFileSync("src/App.jsx", "utf8");
  const block = /const NAV = \[([\s\S]*?)\n  \];/.exec(app)?.[1] ?? "";
  const navViews = [...block.matchAll(/\["(\w+)",\s*"/g)].map(m => m[1]);

  it("finds the nav", () => {
    expect(navViews.length).toBeGreaterThan(5);
    expect(navViews).toContain("dash");
  });

  it("EVERY nav entry is in VIEWS", () => {
    const missing = navViews.filter(v => !VIEWS.includes(v));
    expect(missing, `in the nav but not routable: ${missing.join(", ")}`).toEqual([]);
  });

  it("every routable view is reachable from the nav", () => {
    // The other direction. A view in VIEWS with no nav entry is not necessarily wrong — it could be
    // reached by a link — but it is worth knowing about rather than discovering.
    const orphans = VIEWS.filter(v => !navViews.includes(v));
    expect(orphans, `routable but not in the nav: ${orphans.join(", ")}`).toEqual([]);
  });

  it("commitments specifically", () => {
    expect(VIEWS).toContain("cmt");
    expect(navViews).toContain("cmt");
  });
});
