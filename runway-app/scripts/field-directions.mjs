// ⚠️ READ-BUT-NEVER-WRITTEN FIELDS — the half `one-direction.mjs` structurally cannot see.
//
// That script compares fields the DATA layer authors against the rest of the app. It catches the
// WRITE-only half. The READ-only half needs to know whether `{ foo }` is a shorthand PROPERTY (a write)
// or a destructuring PATTERN (a read) — textually identical, structurally different — so it needs a
// parser. Six defects of this shape in one session, none of which threw:
//
//   p.team        3 readers, no writer   "Team load by project" drew nothing, for years
//   r.in / r.out  7 readers, no writer   flow.inout drew nothing; plan-vs-actual had no "planned"
//   l.amounts     6 readers, no writer   payroll timeline empty, headcount zero, forecast flat
//   p.elapsedPct  3 readers, no writer   "ahead of pace" fired on any project 15% spent
//
// ⚠️ NEEDS A PARSER INSTALLED. `acorn` and `acorn-jsx` are NOT dependencies of this app — install them
// where you run this, or add them as devDependencies. Kept out of the app's package.json deliberately:
// an audit tool should not widen the production dependency surface.
//
//   npm i -D acorn acorn-jsx && node scripts/field-directions.mjs
//
// THREE CLASSIFICATIONS, and the last two are what make the output readable rather than 660 names:
//   WRITE  ObjectExpression property, assignment target, class field, JSX ATTRIBUTE (a prop passed is
//          a field written into the child's props object — missing this left every callback read-only)
//   CALL   a MemberExpression that is the CALLEE of a CallExpression — `x.filter()` is a method, not a
//          field, and every builtin is read-never-written
//   READ   everything else

import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const P = Parser.extend(jsx());

/** Walk every node, classifying each property NAME as a read or a write.
 *
 *  The distinction a regex cannot make:
 *    ObjectExpression  { foo }        -> WRITE (shorthand property)
 *    ObjectPattern     { foo } = x    -> READ  (destructuring)
 *  Textually identical; structurally different nodes.
 */
export function classify(src) {
  const reads = new Set(), writes = new Set(), calls = new Set();
  const ast = P.parse(src, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true });

  const nameOf = (n) => (n?.type === "Identifier" ? n.name
    : n?.type === "Literal" && typeof n.value === "string" ? n.value : null);

  const visit = (node, parent) => {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "Property": {
        const nm = node.computed ? nameOf(node.key) : nameOf(node.key);
        if (nm) (parent?.type === "ObjectPattern" ? reads : writes).add(nm);
        break;
      }
      case "PropertyDefinition": { const nm = nameOf(node.key); if (nm) writes.add(nm); break; }
      // ⚠️ A JSX ATTRIBUTE IS A WRITE. `<Foo onSave={x} canEdit />` puts those names into a props
      // object that the child reads as `props.onSave`. Not counting them left every callback and every
      // prop in the codebase looking read-only — 200-odd names of pure noise.
      case "JSXAttribute": { const nm = node.name?.type === "JSXIdentifier" ? node.name.name : null;
        if (nm) writes.add(nm); break; }
      case "MemberExpression": {
        const nm = node.computed ? (node.property.type === "Literal" ? nameOf(node.property) : null) : nameOf(node.property);
        if (nm) {
          const assigned = parent?.type === "AssignmentExpression" && parent.left === node;
          const updated = parent?.type === "UpdateExpression" && parent.argument === node;
          // ⚠️ `x.foo()` IS A METHOD, NOT A FIELD. Every builtin — filter, map, getBoundingClientRect —
          // is read and never written, so counting them as data fields buries the signal under 400
          // names nobody can act on. The AST knows the difference: a MemberExpression that is the
          // CALLEE of a CallExpression is an invocation.
          const called = parent?.type === "CallExpression" && parent.callee === node;
          if (called) calls.add(nm);
          else (assigned || updated ? writes : reads).add(nm);
        }
        break;
      }
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && visit(c, node));
      else if (v && typeof v.type === "string") visit(v, node);
    }
  };
  visit(ast, null);
  return { reads, writes, calls };
}

export function scan(roots) {
  const files = [];
  const walkDir = (d) => { for (const e of readdirSync(d)) { const p = join(d, e);
    if (statSync(p).isDirectory()) walkDir(p);
    else if ([".js", ".jsx", ".mjs"].includes(extname(p))) files.push(p); } };
  roots.forEach(walkDir);
  const reads = new Map(), writes = new Map(), calls = new Set();
  for (const f of files) {
    let c; try { c = classify(readFileSync(f, "utf8")); } catch (e) { console.error("parse fail", f, e.message); continue; }
    for (const n of c.reads) { if (!reads.has(n)) reads.set(n, new Set()); reads.get(n).add(f); }
    for (const n of c.writes) { if (!writes.has(n)) writes.set(n, new Set()); writes.get(n).add(f); }
    for (const n of c.calls) calls.add(n);
  }
  return { reads, writes, calls, files };
}


// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
// Candidates: READ somewhere in the domain layer, WRITTEN nowhere in src, never CALLED.
const STOP = new Set(("clientX clientY innerWidth innerHeight currentTarget dataTransfer visibilityState " +
  "userAgent localStorage sessionStorage location pathname protocol searchParams serviceWorker crypto " +
  "document env matches PROD Component Provider SheetNames Sheets").split(" "));

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const root = new URL("../src/", import.meta.url).pathname;
  const all = scan([root]);
  const domain = scan([root + "engine", root + "state"]);
  const found = [...domain.reads.keys()]
    .filter((n) => !all.writes.has(n) && !all.calls.has(n) && !STOP.has(n) && !/^VITE_/.test(n) && !/_/.test(n))
    .sort();
  if (!found.length) console.log("No read-but-never-written fields in the domain layer.");
  else {
    console.log(`${found.length} field(s) read in engine/state and written nowhere:\n`);
    for (const n of found) {
      console.log(`  ${n.padEnd(18)} ${[...domain.reads.get(n)].map((f) => f.split("/").pop()).join(", ")}`);
    }
    console.log("\nEach is a reader wired to nothing, an optional parameter, or a field somebody meant to add.");
  }
}
