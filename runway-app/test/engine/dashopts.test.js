import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULTS, LABELS, applicable, readOpts, writeOpts, isDefault } from "../../src/engine/dashopts.js";

// ⚠️ THE ENGINE SUITE RUNS IN NODE, WHERE THERE IS NO `localStorage`. `writeOpts` catches and does
// nothing, so a round-trip test asserted against a store that was never written — it passed for the
// wrong reason until the defaults changed. A stub makes the round trip real.
beforeEach(() => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
});

describe("the dashboard chart options", () => {
  it("⚠️ MERGES A STORED BLOB OVER THE DEFAULTS, never uses it as-is", () => {
    // A blob written before an option existed leaves that key `undefined`, which reads as OFF — so
    // adding an option would silently turn it off for everybody who had ever opened the modal.
    writeOpts({ band: false });
    const back = readOpts();
    expect(back.band).toBe(false);
    for (const k of Object.keys(DEFAULTS)) expect(back[k]).toBeDefined();
    expect(back.milestones).toBe(true);        // untouched keys keep their default
  });

  it("survives a corrupt or absent store rather than throwing", () => {
    try { localStorage.setItem("wl.dashChart", "{not json"); } catch { /* node */ }
    expect(readOpts().band).toBe(true);
  });

  it("⚠️ HIDES AN OPTION THAT HAS NOTHING TO ACT ON", () => {
    // A switch that does nothing teaches people the settings are decorative.
    expect(applicable({ hasUpside: true, wouldBreak: true })).toHaveLength(Object.keys(DEFAULTS).length);
    expect(applicable({ hasUpside: false, wouldBreak: true })).not.toContain("upside");
    expect(applicable({ hasUpside: true, wouldBreak: false })).not.toContain("axisBreak");
    // and the ones that always apply are never hidden
    for (const k of ["band", "milestones", "actuals", "horizon"])
      expect(applicable({})).toContain(k);
  });

  it("every option has a label and an explanation", () => {
    for (const k of Object.keys(DEFAULTS)) {
      expect(LABELS[k], `${k} has no label`).toBeTruthy();
      expect(LABELS[k][1].length).toBeGreaterThan(20);
    }
  });

  it("⚠️ DEFAULTS SHOW EVERYTHING EXCEPT THE FULL HORIZON", () => {
    // The band especially: a runway is a range, and defaulting it off would show a single line that
    // looks more certain than the arithmetic is.
    expect(DEFAULTS.band).toBe(true);
    // ⚠️ `horizon` IS A LENGTH, NOT A SWITCH — `null` means "fit to the content", which is the default.
    // It was a checkbox for a window that is already adaptive, so it only ever meant "stop fitting".
    expect(DEFAULTS.horizon).toBeNull();
    expect(isDefault({ ...DEFAULTS })).toBe(true);
    expect(isDefault({ ...DEFAULTS, band: false })).toBe(false);
  });

  it("has no switch for the zero line or the out-of-cash marker", () => {
    // Everything here is furniture around the answer; those two ARE the answer, and a chart that can
    // hide it is a chart that can mislead.
    expect(Object.keys(DEFAULTS)).not.toContain("zero");
    expect(Object.keys(DEFAULTS)).not.toContain("crossing");
  });
});
