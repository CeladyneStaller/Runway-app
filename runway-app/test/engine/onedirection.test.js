import { describe, it, expect } from "vitest";
import { oneDirectionFields } from "../../scripts/one-direction.mjs";

/** ⚠️ THE SAME DEFECT, FOUR TIMES IN ONE SESSION.
 *
 *    `p.team`        three readers, no writer  -> "Team load by project" drew nothing, for years
 *    `revenueDriven` one writer, no reader     -> computed on every call, wrong, unnoticed
 *    `shipMonth`     one writer, no reader     -> two POs paid in month 0 regardless of shipping
 *    `warrantPct`    one writer, no reader     -> found by this check on its first run
 *
 *  None threw. None failed a test. Each decayed in silence because nothing checked the PAIR — a field is
 *  only correct if somebody writes it AND somebody reads it, and neither half is visible from the other.
 *
 *  ⚠️ IMPORTED, NOT SPAWNED. The first version ran the script through `execFileSync`, which made the
 *  assertion depend on the working directory — and it duly reported every known field as "fixed",
 *  because from a different cwd the scan found nothing to report. **A test that feeds an empty result
 *  into a comparison meant for a full one is worse than no test**: it fails loudly for the wrong reason.
 *  The detector now resolves paths from its own module URL and is called in-process.
 *
 *  ⚠️ AND IT PINS A LIST RATHER THAN DEMANDING ZERO. A general bidirectional check is not possible with
 *  regexes — a shorthand property `{ derivedBurn }` is indistinguishable from a destructuring read of
 *  the same name, and attempting it flags ~450 of 800 identifiers. The narrow question answers 5.
 */
const KNOWN = [
  "categoryMap",   // written into every document; the import mapper reads it from state, not from here
  "churn",         // a document-level key colliding with a saas field name — worth confirming
  "growth",        // same shape as `churn`
  "off",           // seed-only
  "warrantPct",    // venture debt: authored in seed.js, read by nothing at all. Genuinely dead.
];

describe("⚠️ fields authored but never read", () => {
  it("the list may shrink, never grow", () => {
    const found = oneDirectionFields().map((d) => d.name).sort();

    // ⚠️ AN EMPTY RESULT IS A BROKEN CHECK, NOT A CLEAN CODEBASE. Assert the scan actually ran before
    // trusting either comparison below — this is the failure the subprocess version shipped with.
    expect(found.length, "the scan returned nothing; it did not run").toBeGreaterThan(0);

    // Anything NEW is the defect this exists to catch, and it names itself.
    const added = found.filter((n) => !KNOWN.includes(n));
    expect(added, `new one-direction field(s): ${added.join(", ")}`).toEqual([]);

    // Anything GONE is progress — trim KNOWN so the guard keeps its edge.
    const gone = KNOWN.filter((n) => !found.includes(n));
    expect(gone, `these are fixed; remove them from KNOWN: ${gone.join(", ")}`).toEqual([]);
  });

  it("reports where each field is authored, so it can be found", () => {
    // A name with no location is a name somebody has to grep for. The detector carries the file.
    for (const d of oneDirectionFields()) {
      expect(d.authoredIn.length, `${d.name} has no source file`).toBeGreaterThan(0);
      expect(d.authoredIn.every((f) => f.startsWith("src/"))).toBe(true);
    }
  });
});
