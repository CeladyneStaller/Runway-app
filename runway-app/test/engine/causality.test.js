import { describe, it, expect } from "vitest";
import { buildProjection, zeroInfo } from "../../src/engine/projection.js";
import { buildModelFromDoc } from "../../src/engine/buildmodel.js";
import { canaryDoc } from "../../src/state/document.js";

/** ⚠️ WHY THIS FILE EXISTS.
 *
 *  The suite had TWO causal tests — `overhead.test.js` adds a cost line and checks the runway moves the
 *  right way, `buildmodel.test.js` lowers cash and checks the same. Both are DIRECTIONAL. Nothing added
 *  revenue and followed it through to a runway number, nothing checked a change moved the runway by the
 *  RIGHT AMOUNT, and nothing checked that a change which should move nothing moves NOTHING.
 *
 *  That last one is the gap that mattered. Every defect found in this engine recently was something
 *  moving that should not have:
 *    - `indexedLines` charged a royalty on revenue the tier gate had excluded, tagged `committed`
 *    - `flowRunway` drew a line the toggles could not move, next to a headline they could
 *    - the band's zero dates were measured against curves nobody drew
 *
 *  ⚠️ AND A NAIVE GATE TEST WOULD HAVE MISSED THE FIRST ONE. The line gate always worked — adding a
 *  speculative COST with speculative off was correctly ignored. What leaked was a cost DERIVED from
 *  speculative revenue. So the test that catches it is "add speculative REVENUE, assert the runway does
 *  not move", because the derived royalty moved it. Zero-movement assertions catch what directional
 *  ones cannot: a directional test cannot tell "moved for the right reason" from "moved at all".
 *
 *  Two fixtures on purpose. `mini()` has no commitments, no cost share and no payroll, so its arithmetic
 *  is exact and a magnitude assertion means something. The canary is the real thing — it has a 2%
 *  royalty and cost-share matching, so a $100k sale moves the balance $98,000, and asserting $100,000
 *  there would be asserting the absence of a feature.
 */

const T = { committed: true, expected: true, speculative: false, financing: false };
const ALL = { committed: true, expected: true, speculative: true, financing: false };

/** No commitments, no cost share, no payroll: $300k of cash burning $50k a month, runway exactly 6.0. */
const mini = (extra = []) => ({
  startY: 2026, startM: 0, cash: 300000,
  lines: [
    { id: "burn", label: "Opex", kind: "cost", cadence: "recurring", amount: 50000, start: 0, end: null },
    ...extra,
  ],
  employees: [], projects: [], pos: [], rounds: [], saas: [], history: [],
  cashActuals: {}, commitments: [], milestones: [],
  settings: { toggles: T },
});

const rowsOf = (doc, tg = T) => buildProjection(buildModelFromDoc(doc), tg);
const runwayOf = (doc, tg = T) => zeroInfo(rowsOf(doc, tg), doc.startY, doc.startM)?.months;
const shifts = (a, b) => [...new Set(b.map((r, i) => Math.round(r.start - a[i].start)))];
const withLine = (doc, line) => ({ ...doc, lines: [...(doc.lines || []), { id: "probe", ...line }] });

describe("the fixture itself is arithmetic anyone can check", () => {
  it("burns $50k a month against $300k and lasts exactly six months", () => {
    // If this drifts, every magnitude assertion below is measuring something else.
    expect(runwayOf(mini())).toBeCloseTo(6, 6);
    expect(rowsOf(mini()).slice(0, 7).map(r => r.start))
      .toEqual([300000, 250000, 200000, 150000, 100000, 50000, 0]);
  });
});

describe("cash on hand moves the whole curve, by exactly what was added", () => {
  it("⚠️ SHIFTS EVERY MONTH BY THE SAME AMOUNT, not just the ones near the crossing", () => {
    // Cash is the one input with no timing: it is present from month zero, so the entire balance series
    // translates. A partial shift would mean something is re-deriving the opening balance downstream.
    expect(shifts(rowsOf(mini()), rowsOf({ ...mini(), cash: 400000 }))).toEqual([100000]);
    expect(shifts(rowsOf(mini()), rowsOf({ ...mini(), cash: 200000 }))).toEqual([-100000]);
  });

  it("and lengthens or shortens the runway accordingly", () => {
    expect(runwayOf({ ...mini(), cash: 400000 })).toBeCloseTo(8, 6);
    expect(runwayOf({ ...mini(), cash: 200000 })).toBeCloseTo(4, 6);
  });
});

describe("revenue at a tier that is ON reaches the runway", () => {
  it("lands in the month it is dated, and not before", () => {
    // ⚠️ THE MONTH MATTERS AS MUCH AS THE AMOUNT. A revenue line dated month 2 must leave months 0-2
    // untouched — `r.start` is the OPENING balance, so money arriving during month 2 first shows at the
    // start of month 3. Getting this wrong is the one-month offset that was fixed in five places.
    const a = rowsOf(mini());
    const b = rowsOf(mini([{ id: "r", label: "Sale", kind: "revenue", cadence: "onetime",
      amount: 100000, start: 2, confidence: "committed" }]));
    expect([0, 1, 2].map(i => Math.round(b[i].start - a[i].start))).toEqual([0, 0, 0]);
    expect([3, 4, 5].map(i => Math.round(b[i].start - a[i].start))).toEqual([100000, 100000, 100000]);
  });

  it("extends the runway by the money divided by the burn", () => {
    // $100k against $50k a month is two more months, exactly. No rounding, no interpolation slop.
    expect(runwayOf(mini([{ id: "r", label: "Sale", kind: "revenue", cadence: "onetime",
      amount: 100000, start: 2, confidence: "committed" }]))).toBeCloseTo(8, 6);
  });

  it("does the same for the expected tier, which is also on", () => {
    expect(runwayOf(mini([{ id: "r", label: "Forecast", kind: "revenue", cadence: "onetime",
      amount: 100000, start: 2, confidence: "expected" }]))).toBeCloseTo(8, 6);
  });
});

describe("⚠️ a tier that is OFF moves the runway by EXACTLY ZERO", () => {
  // The anti-leak assertions. Not "moves a little", not "moves the right way" — zero. Anything a
  // switched-off tier can do to the runway is by definition a leak, whether it arrives as the line
  // itself or as something derived from it.

  it("speculative revenue, with speculative off", () => {
    const probe = { id: "r", label: "Maybe", kind: "revenue", cadence: "onetime",
      amount: 100000, start: 2, confidence: "speculative" };
    expect(shifts(rowsOf(mini()), rowsOf(mini([probe])))).toEqual([0]);
    expect(runwayOf(mini([probe]))).toBe(runwayOf(mini()));
  });

  it("speculative cost, with speculative off", () => {
    const probe = { id: "c", label: "Maybe spend", kind: "cost", cadence: "onetime",
      amount: 50000, start: 1, confidence: "speculative" };
    expect(shifts(rowsOf(mini()), rowsOf(mini([probe])))).toEqual([0]);
    expect(runwayOf(mini([probe]))).toBe(runwayOf(mini()));
  });

  it("⚠️ AND ON THE CANARY, WHERE A ROYALTY IS DERIVED FROM THAT REVENUE", () => {
    // THE TEST THAT WOULD HAVE CAUGHT `indexedLines`. The canary carries a 2% licence royalty indexed on
    // revenue. That royalty was emitted as one line hardcoded `confidence: "committed"`, so adding
    // SPECULATIVE revenue — with speculative switched off — added a COMMITTED cost and SHORTENED the
    // runway. The line gate was never wrong; the derived cost was.
    const base = canaryDoc();
    base.settings.toggles = T;
    const probe = { id: "spec", label: "Maybe", kind: "revenue", cadence: "onetime",
      amount: 1000000, start: 2, confidence: "speculative" };
    expect(runwayOf(withLine(base, probe), T)).toBe(runwayOf(base, T));
  });

  it("and turning that tier ON is what lets it through", () => {
    // The mirror. A zero-movement test that passes because the input was ignored ENTIRELY would be
    // worthless — this proves the probe is live, and that the gate is a gate rather than a wall.
    const probe = { id: "r", label: "Maybe", kind: "revenue", cadence: "onetime",
      amount: 100000, start: 2, confidence: "speculative" };
    expect(runwayOf(mini([probe]), ALL)).toBeGreaterThan(runwayOf(mini(), ALL));
  });
});

describe("untagged costs always count, whatever the toggles say", () => {
  it("shortens the runway under every tier combination", () => {
    // ⚠️ COSTS HAVE NO TIER BY DEFAULT AND THAT IS CORRECT — rent is owed whether or not you win the
    // deal. `projection.js` gates a cost only when one IS set. This pins the default so a future
    // "tidy-up" that gives every cost a tier is caught here rather than in someone's runway.
    const probe = { id: "c", label: "Rent", kind: "cost", cadence: "onetime", amount: 50000, start: 1 };
    for (const tg of [T, ALL, { committed: true, expected: false, speculative: false, financing: false }]) {
      expect(runwayOf(mini([probe]), tg), JSON.stringify(tg)).toBeLessThan(runwayOf(mini(), tg));
    }
  });
});

describe("adding then removing is a round trip", () => {
  it("⚠️ RETURNS TO THE EXACT SAME NUMBER, not merely a similar one", () => {
    // Cheap, and it catches a whole class of defect the other tests cannot: anything that accumulates,
    // caches by identity, or mutates the document it was handed. `monthsShown` now memoises on the doc
    // object, which is the kind of thing that makes this worth having.
    const before = rowsOf(mini()).map(r => r.start);
    const withIt = mini([{ id: "r", label: "Sale", kind: "revenue", cadence: "onetime",
      amount: 100000, start: 2, confidence: "committed" }]);
    runwayOf(withIt);
    const after = rowsOf(mini()).map(r => r.start);
    expect(after).toEqual(before);
  });
});

describe("the canary moves too, but not by round numbers", () => {
  it("⚠️ $100k OF REVENUE IS WORTH $98,000, because a 2% royalty rides on it", () => {
    // Asserted against the royalty RATE rather than a magic constant. On the real document a sale
    // carries obligations, and a magnitude test that demanded a clean $100,000 would be asserting the
    // absence of a feature. The point is that the shortfall is EXPLAINED, not that it is absent.
    const base = canaryDoc();
    base.settings.toggles = T;
    const roy = (base.commitments || []).find(c => c.flavor === "indexed" && c.index?.of === "revenue");
    expect(roy, "the canary should carry a revenue-indexed royalty").toBeTruthy();
    const pct = roy.index.pct;
    const a = rowsOf(base, T);
    const b = rowsOf(withLine(base, { id: "r", label: "Sale", kind: "revenue", cadence: "onetime",
      amount: 100000, start: 2, confidence: "committed" }), T);
    expect(Math.round(b[3].start - a[3].start)).toBe(Math.round(100000 * (1 - pct)));
  });

  it("more cash is more runway, less cash is less", () => {
    const base = canaryDoc();
    base.settings.toggles = T;
    expect(runwayOf({ ...base, cash: base.cash + 200000 }, T)).toBeGreaterThan(runwayOf(base, T));
    expect(runwayOf({ ...base, cash: base.cash - 200000 }, T)).toBeLessThan(runwayOf(base, T));
  });
});
