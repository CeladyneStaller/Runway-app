// Hash routing parse/format — the pure core, testable without a DOM. The hook binding is exercised in
// the view tests. This pins the URL <-> {view,tab} mapping and the graceful fallback for junk hashes.
import { describe, it, expect } from "vitest";
import { parseHash, formatHash, DEFAULT_VIEW, VIEWS } from "../../src/state/hashroute";

describe("parseHash", () => {
  it("empty hash -> default view, no tab", () => {
    expect(parseHash("")).toEqual({ view: DEFAULT_VIEW, tab: null });
    expect(parseHash("#")).toEqual({ view: DEFAULT_VIEW, tab: null });
  });
  it("view only", () => {
    expect(parseHash("#proj")).toEqual({ view: "proj", tab: null });
  });
  it("view + tab", () => {
    expect(parseHash("#hist/ledger")).toEqual({ view: "hist", tab: "ledger" });
  });
  it("tolerates a leading slash", () => {
    expect(parseHash("#/proj/grants")).toEqual({ view: "proj", tab: "grants" });
  });
  it("an unknown view falls back to default (never blank)", () => {
    expect(parseHash("#nonsense")).toEqual({ view: DEFAULT_VIEW, tab: null });
    expect(parseHash("#nonsense/whatever").view).toBe(DEFAULT_VIEW);
  });
  it("decodes an encoded tab", () => {
    expect(parseHash("#proj/" + encodeURIComponent("a b")).tab).toBe("a b");
  });
});

describe("formatHash", () => {
  it("view only", () => {
    expect(formatHash({ view: "proj" })).toBe("#proj");
  });
  it("view + tab", () => {
    expect(formatHash({ view: "hist", tab: "ledger" })).toBe("#hist/ledger");
  });
  it("clamps an invalid view to default", () => {
    expect(formatHash({ view: "bogus", tab: "x" })).toBe("#" + DEFAULT_VIEW + "/x");
  });
  it("round-trips every valid view", () => {
    for (const v of VIEWS) expect(parseHash(formatHash({ view: v })).view).toBe(v);
  });
});

describe("round-trip with tabs", () => {
  it("parse(format(x)) === x for view+tab", () => {
    const x = { view: "sales", tab: "orders" };
    expect(parseHash(formatHash(x))).toEqual(x);
  });
});
