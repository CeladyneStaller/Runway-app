import { describe, it, expect } from "vitest";
import { fingerprintFor, withFingerprints, staleness, stalenessText } from "../../src/engine/scenario.js";

const doc = () => ({
  cash: 560000,
  settings: { toggles: { speculative: false, financing: true } },
  rounds: [{ id: "r1", name: "Series A", amount: 6000000, closeMonth: 6, status: "planning" }],
  employees: [{ id: "e1", name: "Priya", salary: 120000 }],
});

describe("fingerprints record only what a patch read", () => {
  it("a field patch records the field", () => {
    expect(fingerprintFor(doc(), { kind: "field", path: "cash", value: 9 }))
      .toEqual({ path: "cash", was: 560000 });
  });

  it("a toggle patch reaches into settings", () => {
    expect(fingerprintFor(doc(), { kind: "toggle", path: "speculative", value: true }))
      .toEqual({ path: "speculative", was: false });
  });

  it("AN ITEM PATCH RECORDS ONLY ITS OWN FIELDS", () => {
    // Recording the whole item would flag a scenario every time somebody edited a note, and a warning
    // that fires on everything is one people learn to ignore.
    const fp = fingerprintFor(doc(), { kind: "item", collection: "rounds", id: "r1", field: "status" });
    expect(fp.was).toEqual({ status: "planning" });
    expect(fp.was.amount).toBeUndefined();
  });

  it("carries a name, so the flag can say WHICH thing moved", () => {
    expect(fingerprintFor(doc(), { kind: "item", collection: "rounds", id: "r1", field: "status" }).name)
      .toBe("Series A");
  });

  it("AN ADD READS NOTHING, so it can never go stale", () => {
    const fp = fingerprintFor(doc(), { kind: "item", op: "add", collection: "rounds", item: { id: "x" } });
    expect(fp === null || fp.missing).toBeTruthy();
  });

  it("withFingerprints leaves an existing one alone", () => {
    const scn = { patches: [{ kind: "field", path: "cash", fp: { path: "cash", was: 1 } }] };
    expect(withFingerprints(doc(), scn).patches[0].fp.was).toBe(1);
  });
});

describe("staleness is derived from the current document", () => {
  const scn = () => withFingerprints(doc(), { patches: [
    { kind: "item", collection: "rounds", id: "r1", field: "status", value: "committed" },
    { kind: "field", path: "cash", value: 400000 },
  ] });

  it("says nothing when the model has not moved", () => {
    expect(staleness(doc(), scn())).toEqual([]);
  });

  it("FLAGS A FIELD THE PATCH READ", () => {
    const s = scn();
    const moved = { ...doc(), rounds: [{ ...doc().rounds[0], status: "raising" }] };
    const out = staleness(moved, s);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "moved", field: "status", was: "planning", now: "raising" });
  });

  it("STAYS QUIET when a field the patch never read changes", () => {
    // The whole point of fingerprinting fields rather than items.
    const s = scn();
    const moved = { ...doc(), rounds: [{ ...doc().rounds[0], amount: 4500000 }] };
    expect(staleness(moved, s)).toEqual([]);
  });

  it("flags a deleted item as GONE, not moved", () => {
    const out = staleness({ ...doc(), rounds: [] }, scn());
    expect(out[0]).toMatchObject({ kind: "gone", name: "Series A" });
  });

  it("flags a changed top-level field", () => {
    const out = staleness({ ...doc(), cash: 250000 }, scn());
    expect(out.some(e => e.field === "cash" && e.was === 560000 && e.now === 250000)).toBe(true);
  });

  it("IS PURE — the same inputs give the same answer, and nothing is stored", () => {
    // A cached staleness flag would be a SECOND source of truth about the document, which is the shape
    // of three separate bugs already found this session.
    const s = scn();
    const moved = { ...doc(), cash: 1 };
    expect(staleness(moved, s)).toEqual(staleness(moved, s));
    expect(JSON.stringify(s)).not.toMatch(/stale/);
  });
});

describe("what the flag says", () => {
  it("names the thing, the field, and both values", () => {
    const t = stalenessText({ kind: "moved", name: "Series A", field: "status",
                              was: "planning", now: "raising" });
    expect(t).toMatch(/Series A/);
    expect(t).toMatch(/was planning/);
    expect(t).toMatch(/now raising/);
  });

  it("says a gone item does nothing, rather than that it changed", () => {
    expect(stalenessText({ kind: "gone", name: "Fulton St lease" }))
      .toMatch(/no longer exists.*does nothing/);
  });

  it("renders an empty value as a word, not a blank", () => {
    expect(stalenessText({ kind: "moved", field: "note", was: "", now: "x" })).toMatch(/was empty/);
  });
});
