import { describe, it, expect } from "vitest";
import { TAB_REGISTRY, SUBTAB_REGISTRY, subtabsOf, subKey, splitHidden, visibleTabs }
  from "../../src/state/tabprefs.js";


describe("⚠️ sub-tabs are settable AND unsettable", () => {
  it("has a registry, which it did not before", () => {
    // `prefs.subs[view]` has existed and `visibleTabs` has read it since the tab work — the only way to
    // WRITE it was by hand. **A setting that can be set and not unset is a trap**, and a wizard that
    // hid these would have been one with no exit.
    expect(Object.keys(SUBTAB_REGISTRY).length).toBeGreaterThanOrEqual(6);
    expect(subtabsOf("proj").map(t => t.id)).toEqual(
      ["all", "internal", "grants", "fulfil", "proposals"]);
    expect(subtabsOf("sales").map(t => t.id)).toEqual(["summary", "orders", "targets", "subs"]);
  });

  it("⚠️ LOCKS THE FIRST SUB-TAB OF EVERY VIEW", () => {
    // It is where the tab LANDS. A tab whose every sub-tab is hidden opens onto nothing.
    for (const view of Object.keys(SUBTAB_REGISTRY)) {
      expect(subtabsOf(view)[0].locked, view).toBe(true);
      expect(subtabsOf(view).slice(1).some(t => t.locked), view).toBe(false);
    }
  });

  it("rides in the same flat list, encoded `view:sub`", () => {
    // `set_company_tabs` takes one array and stores one column. A second column and RPC would mean a
    // migration and two things to keep in step, for data that is already a list of what not to show.
    expect(subKey("proj", "grants")).toBe("proj:grants");
    const split = splitHidden(["sales", "proj:grants", "pay:fringe"]);
    expect(split.views).toEqual(["sales"]);
    expect(split.subs).toEqual(["proj:grants", "pay:fringe"]);
  });

  it("⚠️ CANNOT COLLIDE WITH A TOP-LEVEL VIEW ID", () => {
    // The encoding is only safe because no view id contains a colon.
    for (const t of TAB_REGISTRY) expect(t.view).not.toContain(":");
  });

  it("⚠️ UNIONS THE COMPANY'S HIDDEN LIST WITH THE PERSON'S", () => {
    // Both are statements about what NOT to show and neither is more authoritative — an owner hiding
    // Fringe company-wide and a person hiding Prioritization for themselves both mean it. **Making one
    // win would silently undo the other's choice.**
    const tabs = [["all", "All"], ["internal", "Internal"], ["grants", "Grants"]];
    expect(visibleTabs("proj", tabs, {}).map(t => t[0])).toEqual(["all", "internal", "grants"]);
    expect(visibleTabs("proj", tabs, { companyHidden: ["proj:grants"] }).map(t => t[0]))
      .toEqual(["all", "internal"]);
    expect(visibleTabs("proj", tabs, { subs: { proj: ["internal"] } }).map(t => t[0]))
      .toEqual(["all", "grants"]);
    expect(visibleTabs("proj", tabs, { companyHidden: ["proj:grants"],
                                       subs: { proj: ["internal"] } }).map(t => t[0])).toEqual(["all"]);
  });

  it("still lands somewhere when everything is hidden", () => {
    const tabs = [["all", "All"], ["internal", "Internal"]];
    const all = { companyHidden: ["proj:all", "proj:internal"] };
    expect(visibleTabs("proj", tabs, all)).toHaveLength(1);
  });
});
