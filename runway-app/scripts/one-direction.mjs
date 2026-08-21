#!/usr/bin/env node
// ⚠️ FIELDS MENTIONED IN EXACTLY ONE DIRECTION.
//
// This codebase keeps producing the same defect: a property that is WRITTEN and never read, or READ and
// never written. Four in one session —
//   `p.team`        three readers, no writer   -> "Team load by project" drew nothing, for years
//   `revenueDriven` one writer, no reader      -> computed every call, wrong, unnoticed
//   `shipMonth`     one writer, no reader      -> two POs paid in month 0 regardless of shipping
//   `warrantPct`    one writer, no reader      -> found by this script
//
// None threw. None failed a test. Each decayed silently because nothing was checking the PAIR.
//
// ⚠️ THIS IS A GREP, NOT A TYPE SYSTEM, AND IT IS DELIBERATELY NOT A GATE. Regexes cannot tell a
// shorthand property `{ derivedBurn }` from a destructuring read of the same name, so a general
// bidirectional check flags ~450 of 800 identifiers and is worth nothing. What IS reliable is one
// narrow question: does every field the DATA layer authors get touched ANYWHERE in the app?
//
// Run it when adding fields, or when a chart draws nothing it should:  node scripts/one-direction.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

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

// The DATA layer: files whose job is to author documents.
const DATA = ["src/state/archetypes.js", "src/state/document.js", "src/seed.js"];
const ALL = walk("src");

const authored = new Map();
for (const f of DATA) {
  for (const [, name] of strip(readFileSync(f, "utf8")).matchAll(KEY)) {
    if (!authored.has(name)) authored.set(name, new Set());
    authored.get(name).add(f);
  }
}

// Touched ANYWHERE — engine, views, state. A field read only by a view is still read.
const touched = new Set();
for (const f of ALL) {
  if (DATA.includes(f)) continue;                       // authoring itself is not consumption
  const s = strip(readFileSync(f, "utf8"));
  for (const [, n] of s.matchAll(DOT)) touched.add(n);
  for (const [, n] of s.matchAll(IDX)) touched.add(n);
  for (const [, n] of s.matchAll(KEY)) touched.add(n);
  for (const [, inner] of s.matchAll(DESTRUCT)) for (const [, n] of inner.matchAll(WORD)) touched.add(n);
}

// Authoring-only by design: consumed inside the data layer itself and never meant to leave it.
const INTENDED = new Set(["ledger", "ledgerMix", "schemaVersion", "demoId"]);

const dead = [...authored.keys()].filter((n) => !touched.has(n) && !INTENDED.has(n)).sort();
if (!dead.length) { console.log("No one-direction fields. Every authored field is read somewhere."); process.exit(0); }
console.log(`${dead.length} field(s) authored but never read anywhere:\n`);
for (const n of dead) console.log(`  ${n.padEnd(20)} authored in ${[...authored.get(n)].join(", ")}`);
console.log("\nEach is either dead weight or a reader that was never wired. Check both before deleting.");
