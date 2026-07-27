// Hiding tabs. Mostly about the ways it must refuse to lock somebody out of their own app.
import { describe, it, expect } from "vitest";
import { load, save, visibleNav, visibleTabs, resolveTab, landingView, isLocked,
         TAB_REGISTRY } from "../../src/state/tabprefs";

const NAV = TAB_REGISTRY.map(t => [t.view, t.label, null]);
const store = () => { const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

describe("defaults", () => {
  it("shows everything when nothing has been saved", () => {
    expect(visibleNav(NAV, load(store())).length).toBe(NAV.length);
  });

  it("shows a NEW tab even to somebody who saved a preference before it existed", () => {
    // Hiding is subtractive and opt-in, so a tab added later is never silently missing.
    const prefs = { views: ["pay"], subs: {} };
    expect(visibleNav([...NAV, ["brandnew", "Brand new", null]], prefs).map(n => n[0]))
      .toContain("brandnew");
  });

  it("falls back to showing everything when storage is corrupt or unavailable", () => {
    const s = store(); s.setItem("runway:tabprefs", "{not json");
    expect(load(s)).toEqual({ views: [], subs: {} });
    expect(load({ getItem() { throw new Error("blocked"); } })).toEqual({ views: [], subs: {} });
  });
});

describe("not locking anybody out", () => {
  it("the Dashboard cannot be hidden, so there is always somewhere to go home to", () => {
    expect(isLocked("dash")).toBe(true);
    expect(visibleNav(NAV, { views: ["dash"], subs: {} }).map(n => n[0])).toContain("dash");
    // and a saved preference claiming otherwise is discarded on read
    const s = store(); save({ views: ["dash", "pay"], subs: {} }, s);
    expect(load(s).views).toEqual(["pay"]);
  });

  it("hiding every sub-tab still leaves one", () => {
    // A view with no visible sub-tabs is an empty tab row above an empty screen.
    const tabs = [["a", "A"], ["b", "B"], ["c", "C"]];
    const out = visibleTabs("flow", tabs, { subs: { flow: ["a", "b", "c"] } });
    expect(out).toHaveLength(1);
  });

  it("moves you off a view you just hid", () => {
    expect(landingView("pay", { views: ["pay"] })).toBe("dash");
    expect(landingView("pay", { views: ["proj"] })).toBe("pay");
    expect(landingView("dash", { views: ["dash"] })).toBe("dash");   // locked, so no move
  });
});

describe("resolving the active sub-tab", () => {
  // Resolved against the REGISTRY, not a passed-in array: the active tab has to be known at the top
  // of a component while TABS is built further down from live counts.
  it("keeps the routed tab when it is visible", () => {
    expect(resolveTab("flow", "costs", "net", { subs: {} })).toBe("costs");
  });

  it("does NOT fall back to a default that is itself hidden", () => {
    // Falling back to the view's own default would render exactly the tab somebody hid.
    expect(resolveTab("flow", null, "net", { subs: { flow: ["net"] } })).toBe("revenue");
  });

  it("falls back off a routed tab that has been hidden", () => {
    expect(resolveTab("flow", "costs", "net", { subs: { flow: ["costs"] } })).toBe("net");
  });

  it("returns the default for a view with no sub-tabs at all", () => {
    expect(resolveTab("ms", null, "x", { subs: {} })).toBe("x");
  });
});

describe("persistence", () => {
  it("round-trips", () => {
    // Not scoped per user: localStorage is already per browser profile, and browser profiles are how
    // two people share a machine. The optional key exists for a caller that wants finer separation.
    const s = store();
    save({ views: ["pay"], subs: { flow: ["costs"] } }, s);
    expect(load(s)).toEqual({ views: ["pay"], subs: { flow: ["costs"] } });
  });

  it("never throws when storage refuses to write", () => {
    expect(() => save({ views: [] }, { setItem() { throw new Error("quota"); } })).not.toThrow();
  });
});
