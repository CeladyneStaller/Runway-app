import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULTS, LABELS, applicable, readOpts, writeOpts, isDefault } from "../../src/engine/dashopts.js";

beforeEach(() => { try { localStorage.clear(); } catch { /* node */ } });

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
    for (const k of ["band", "milestones", "actuals", "fullHorizon"])
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
    expect(DEFAULTS.fullHorizon).toBe(false);
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
