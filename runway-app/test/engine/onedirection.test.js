import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/** ⚠️ THE SAME DEFECT, FOUR TIMES IN ONE SESSION.
 *
 *    `p.team`        three readers, no writer  -> "Team load by project" drew nothing, for years
 *    `revenueDriven` one writer, no reader     -> computed on every call, wrong, unnoticed
 *    `shipMonth`     one writer, no reader     -> two POs paid in month 0 regardless of shipping
 *    `warrantPct`    one writer, no reader     -> found by the script this test runs
 *
 *  None threw. None failed a test. Each decayed in silence because nothing checked the PAIR — a field
 *  is only correct if somebody writes it AND somebody reads it, and neither half is visible from the
 *  other.
 *
 *  ⚠️ THIS PINS A LIST RATHER THAN DEMANDING ZERO. A general bidirectional check is not possible with
 *  regexes — a shorthand property `{ derivedBurn }` is indistinguishable from a destructuring read of
 *  the same name, and attempting it flags ~450 of 800 identifiers, which is worth nothing. What IS
 *  reliable is the narrow question the script asks: does every field the DATA layer authors get read
 *  ANYWHERE? That answered 5.
 *
 *  So the contract is: THE LIST MAY SHRINK, NEVER GROW. Deleting a dead field is progress and this test
 *  will say so. Adding one fails here, at the moment it is written, rather than in a chart that quietly
 *  draws nothing a year later.
 */
const KNOWN = [
  "categoryMap",   // written into every document; the import mapper reads it from state, not from here
  "churn",         // a saas field name that collides with the document key — worth confirming, not urgent
  "growth",        // same shape as `churn`
  "off",           // seed-only
  "warrantPct",    // venture debt: authored in seed.js, read by nothing at all. Genuinely dead.
];

describe("⚠️ fields authored but never read", () => {
  it("the list may shrink, never grow", () => {
    const out = execFileSync("node", ["scripts/one-direction.mjs"], { encoding: "utf8" });
    const found = [...out.matchAll(/^ {2}(\w+)\s+authored in/gm)].map((m) => m[1]).sort();

    // Anything NEW is the defect this exists to catch, and it names itself.
    const added = found.filter((n) => !KNOWN.includes(n));
    expect(added, `new one-direction field(s): ${added.join(", ")}`).toEqual([]);

    // Anything GONE is progress — trim KNOWN so the guard keeps its edge.
    const gone = KNOWN.filter((n) => !found.includes(n));
    expect(gone, `these are fixed; remove them from KNOWN: ${gone.join(", ")}`).toEqual([]);
  });
});
