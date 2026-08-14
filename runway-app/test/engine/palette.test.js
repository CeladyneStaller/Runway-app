import { describe, it, expect } from "vitest";
import { colorsFor, ramp, shade, UNASSIGNED, SEMANTIC, SOLO } from "../../src/engine/palette.js";

const S = (...ids) => ids.map(id => ({ id }));

describe("hue by type, lightness by member", () => {
  const type = (k) => ({ a: "grant", b: "grant", c: "fulfillment", d: "internal" })[k];

  it("⚠️ GIVES TWO GRANTS TWO DISTINCT GREENS", () => {
    // The bug this exists for: colour carried the TYPE and lost the IDENTITY, so four grants drew as
    // four near-identical greens — backwards, because identity is what a breakdown is for.
    const c = colorsFor(S("a", "b", "c", "d"), type);
    expect(c[0]).not.toBe(c[1]);
    expect(new Set(c).size).toBe(4);
  });

  it("KEEPS THE TYPE'S HUE — grants stay green, a subcontract does not", () => {
    const c = colorsFor(S("a", "b", "c", "d"), type);
    const green = (h) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
                           return g > r && g > b; };
    expect(green(c[0])).toBe(true);
    expect(green(c[1])).toBe(true);
    expect(green(c[2])).toBe(false);      // fulfillment is clay
  });

  it("the ramp only divides the members of ONE type", () => {
    // Which is the whole point — it never has to separate everything at once.
    const two = colorsFor(S("a", "b"), type);
    const one = colorsFor(S("a"), type);
    expect(one).toHaveLength(1);
    expect(two[0]).not.toBe(two[1]);
  });
});

describe("dimensions with no type", () => {
  it("gets one hue each", () => {
    const c = colorsFor(S("x", "y", "z"), null);
    expect(new Set(c).size).toBe(3);
    expect(SOLO).toContain(c[0]);
  });
});

describe("confidence tiers", () => {
  it("⚠️ ARE SEMANTIC AND FIXED, not allocated from a ramp", () => {
    // A tier means the same thing on every chart in the product.
    const c = colorsFor(S("committed", "expected", "speculative"), null);
    expect(c).toEqual([SEMANTIC.committed, SEMANTIC.expected, SEMANTIC.speculative]);
  });
});

describe("unassigned", () => {
  it("⚠️ IS ALWAYS GREY, ON EVERY DIMENSION", () => {
    // An absence of assignment is not a member — colouring it from the palette implies it is a peer of
    // the things it is missing from.
    const withType = colorsFor([{ id: "a" }, { id: "n", unassigned: true }], () => "grant");
    const without = colorsFor([{ id: "a" }, { id: "n", unassigned: true }], null);
    expect(withType[1]).toBe(UNASSIGNED);
    expect(without[1]).toBe(UNASSIGNED);
  });

  it("does not consume a hue the real series could have had", () => {
    const c = colorsFor([{ id: "n", unassigned: true }, { id: "a" }, { id: "b" }], null);
    expect(c[1]).toBe(SOLO[0]);
  });
});

describe("the ramp itself", () => {
  it("⚠️ DOES NOT REACH WHITE OR BLACK", () => {
    // Going all the way would separate ten members and produce two that read as "empty" and "black"
    // rather than as the colour they belong to.
    const r = ramp("#10876B", 6);
    for (const h of r) {
      expect(h).not.toMatch(/^#f{6}$/i);
      expect(h).not.toMatch(/^#0{6}$/i);
    }
  });

  it("returns the base unchanged for a single member", () => {
    expect(ramp("#10876B", 1)).toEqual(["#10876B"]);
  });

  it("shade lightens and darkens without leaving the range", () => {
    expect(shade("#10876B", 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    expect(shade("#10876B", -0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("⚠️ the renderer can actually draw what the palette names", () => {
  const fs = require("node:fs");
  const chart = fs.readFileSync("src/views/chrome/Chart.jsx", "utf8");
  const css = fs.readFileSync("src/styles.css", "utf8");

  it("EVERY CSS VARIABLE THE CHART NAMES IS DEFINED", () => {
    // `--clay`, `--brown`, `--gate` and `--thrust` were named in chart code and defined NOWHERE. An
    // undefined custom property resolves to nothing — so a series asking for clay drew with no fill, or
    // fell through the tone table to green. **Neither errors.**
    const used = [...new Set([...chart.matchAll(/var\(--([\w-]+)\)/g)].map(m => m[1]))];
    const defined = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
    for (const v of used) expect(defined.has(v), `--${v} is used but never defined`).toBe(true);
  });

  it("⚠️ THE TONE TABLE'S FALLBACK IS WHY THIS WAS INVISIBLE", () => {
    // `TONE[t] || TONE.signal` turns a missing key into green, which looks deliberate. Four series
    // naming four different absent tones all drew the same colour and nothing said so.
    expect(chart).toMatch(/TONE\[t\] \|\| TONE\.signal/);
    for (const t of ["clay", "brown", "gate", "signal-2"]) {
      expect(chart, `${t} is not a tone key`).toMatch(new RegExp(`["']?${t}["']?\\s*:`));
    }
  });

  it("⚠️ THE LEGEND CARRIES THE COLOUR TOO", () => {
    // It copied `tone` and dropped `color`, so swatches fell back to green while the chart beside them
    // drew the real ramp — **the legend disagreeing with the chart it explains.** That is worse than
    // both being wrong, because the reader trusts the key to say which line is which.
    expect(chart).toMatch(/label: sr\.label, tone: sr\.tone, color: sr\.color/);
    expect(chart).toMatch(/colorOf\(k\)/);
  });

  it("EVERY CONSUMER OF A SERIES COLOUR GOES THROUGH `colorOf`", () => {
    // A field nobody copies is a field nobody notices is missing — this has now happened twice, in the
    // renderer and then in the legend one consumer later.
    const raw = [...chart.matchAll(/tone\((\w+)\.tone\)/g)].map(m => m[1]);
    // markers, rows and groups keep tone names — they are semantic marks, not members of a breakdown
    for (const v of raw) expect(["m", "r", "sg"], `tone(${v}.tone) should use colorOf`).toContain(v);
  });

  it("AN EXPLICIT COLOUR WINS OVER A TONE NAME", () => {
    // A breakdown's colours are computed — hue from type, lightness from member — so there is no fixed
    // token for "the second grant". The renderer read `tone` only, and discarded every computed colour.
    expect(chart).toMatch(/const colorOf = \(s\) => s\?\.color \|\| tone\(s\?\.tone\)/);
    expect(chart).toMatch(/colorOf\(sr\)/);
  });
});
