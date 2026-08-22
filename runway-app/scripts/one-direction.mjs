// ⚠️ FIELDS AUTHORED BUT NEVER READ.
//
// This codebase keeps producing the same defect: a property written and never read, or read and never
// written. Four in one session —
//   `p.team`        three readers, no writer   -> "Team load by project" drew nothing, for years
//   `revenueDriven` one writer, no reader      -> computed every call, wrong, unnoticed
//   `shipMonth`     one writer, no reader      -> two POs paid in month 0 regardless of shipping
//   `warrantPct`    one writer, no reader      -> found by this script on its first run
//
// None threw. None failed a test. Each decayed silently because nothing checked the PAIR.
//
// ⚠️ THE GENERAL CHECK IS NOT POSSIBLE WITH REGEXES, and trying it wastes the tool. A shorthand
// property `{ derivedBurn }` is textually identical to a destructuring READ of the same name, so a
// bidirectional scan flags ~450 of 800 identifiers and means nothing. What IS reliable is one narrow
// question: does every field the DATA layer authors get read ANYWHERE in the app? That answers 5.
//
// ⚠️ EXPORTED AS A FUNCTION, NOT JUST A CLI. The first version was a script the test spawned with
// `execFileSync`, which made the test depend on the working directory — and it duly reported every
// field as "fixed" when run from somewhere else. Paths resolve from THIS FILE's location, so it gives
// the same answer wherever it is called from.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".js", ".jsx"].includes(extname(p))) out.push(p);
  }
  return out;
};

const strip = (s) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
const KEY = /(?<![.\w])([a-z][A-Za-z0-9]{2,})\s*:(?!:)/g;
const DOT = /\??\.([a-z][A-Za-z0-9]{2,})\b/g;
const IDX = /\[["']([a-z][A-Za-z0-9]{2,})["']\]/g;
const DESTRUCT = /\{([^{}]*)\}\s*=/g;
const WORD = /\b([a-z][A-Za-z0-9]{2,})\b/g;

/** Files whose job is to AUTHOR documents. A key here is a claim that something consumes it.
 *
 *  ⚠️ HELD AS POSIX-STYLE STRINGS FOR REPORTING, AND AS RESOLVED ABSOLUTE PATHS FOR COMPARING. Those are
 *  two different jobs and conflating them broke this on Windows: the exclusion below was
 *  `abs.endsWith("src/state/archetypes.js")`, and `path.join` on win32 produces
 *  `C:\repo\src\state\archetypes.js`, which ends with no such thing. The authoring files were then
 *  scanned as their own consumers, every authored key looked "touched", and the whole check returned an
 *  empty list — silently on Linux, and as a confusing failure everywhere else.
 */
const DATA = ["src/state/archetypes.js", "src/state/document.js", "src/seed.js"];

/** Authoring-only by design — consumed inside the data layer itself and never meant to leave it. */
/** ⚠️ ADD A FIELD HERE THE MOMENT YOU ADD ONE TO AN ARCHETYPE. These are AUTHORING inputs: `demoDoc`
 *  reads them, builds `history`/`cashActuals` from them, and destructures them OUT so they never reach
 *  the document. `demoDoc` is inside the data layer, so its reads do not count as consumption — which
 *  is correct, and which means each one has to be declared intentional exactly once.
 *
 *  `ledgerRevenue` was added without this and the guard caught it on the next run. That is the guard
 *  working: a NEW one-direction field is either a mistake or a declaration, and it should cost one line
 *  to say which.
 */
const INTENDED = new Set(["ledger", "ledgerMix", "ledgerRevenue", "schemaVersion", "demoId"]);

export function oneDirectionFields() {
  // Compare on resolved absolute paths, which `path.resolve` normalises to the platform's own
  // separators on BOTH sides. Never on string suffixes.
  const dataAbs = new Set(DATA.map((rel) => resolve(REPO, rel)));

  const authored = new Map();
  for (const rel of DATA) {
    const s = strip(readFileSync(resolve(REPO, rel), "utf8"));
    for (const [, name] of s.matchAll(KEY)) {
      if (!authored.has(name)) authored.set(name, new Set());
      authored.get(name).add(rel);
    }
  }

  // ⚠️ TOUCHED ANYWHERE — engine, views, state. A FIELD READ BY A VIEW IS READ. A first pass compared
  // demo fields against `src/engine/` only and flagged `useOfFunds`, `leadName` and `metric`, all of
  // which the Investment and Sales views read. Consumption is consumption wherever it happens.
  const touched = new Set();
  for (const abs of walk(join(REPO, "src"))) {
    if (dataAbs.has(resolve(abs))) continue;                     // authoring is not consumption
    const s = strip(readFileSync(abs, "utf8"));
    for (const [, n] of s.matchAll(DOT)) touched.add(n);
    for (const [, n] of s.matchAll(IDX)) touched.add(n);
    for (const [, n] of s.matchAll(KEY)) touched.add(n);
    for (const [, inner] of s.matchAll(DESTRUCT)) for (const [, n] of inner.matchAll(WORD)) touched.add(n);
  }

  return [...authored.keys()]
    .filter((n) => !touched.has(n) && !INTENDED.has(n))
    .sort()
    .map((name) => ({ name, authoredIn: [...authored.get(name)] }));
}

// CLI:  node scripts/one-direction.mjs
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dead = oneDirectionFields();
  if (!dead.length) console.log("No one-direction fields. Every authored field is read somewhere.");
  else {
    console.log(`${dead.length} field(s) authored but never read anywhere:\n`);
    for (const d of dead) console.log(`  ${d.name.padEnd(20)} authored in ${d.authoredIn.join(", ")}`);
    console.log("\nEach is either dead weight or a reader that was never wired. Check both before deleting.");
  }
}
