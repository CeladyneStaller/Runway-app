// The migrations, checked for a mistake that has now been made twice.
//
// A `language sql` function is PARSED WHEN IT IS CREATED, so a column or table it references must
// already exist. A plpgsql function defers name resolution to runtime and accepts the same reference
// happily, failing later when somebody calls it. Two shapes, two moments, one careless ordering — and
// 022 and 031 each shipped with it, the second immediately after I had found and fixed the first and
// written a throwaway scanner I then did not run.
//
// So the scanner is a test. It reads the SQL rather than executing it, which is worth being honest
// about: it catches ORDERING, not correctness. A function can pass this and still be wrong. What it
// buys is that the specific failure which stops a migration dead cannot reach production twice more.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const FILES = readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
const read = (f) => readFileSync(`${DIR}/${f}`, "utf8");

/** `create ... function name(...) ... language sql ... $$ body $$`, with the offset of each. */
function sqlFunctions(text) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf("$$", m.index);
    if (open < 0) continue;
    const close = text.indexOf("$$", open + 2);
    if (close < 0) continue;
    const head = text.slice(m.index, open);
    if (!/language\s+sql/i.test(head)) continue;      // plpgsql defers; only sql parses at creation
    out.push({ name: m[1], at: m.index, body: text.slice(open + 2, close) });
  }
  return out;
}

describe("a language-sql function cannot reference something added later in the same file", () => {
  it.each(FILES)("%s", (file) => {
    const text = read(file);
    const added = [];
    for (const m of text.matchAll(/alter table (\w+) add column if not exists (\w+)/gi)) {
      added.push({ kind: "column", table: m[1], name: m[2], at: m.index });
    }
    for (const m of text.matchAll(/create table if not exists (\w+)/gi)) {
      added.push({ kind: "table", name: m[1], at: m.index });
    }

    const problems = [];
    for (const fn of sqlFunctions(text)) {
      for (const a of added) {
        if (a.at <= fn.at) continue;                                  // defined first: fine
        if (!new RegExp(`\\b${a.name}\\b`).test(fn.body)) continue;   // not referenced: fine
        problems.push(`${fn.name}() reads ${a.kind} \`${a.name}\`, which this file adds further down`);
      }
    }
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
});

describe("and cannot call a function defined in a later migration", () => {
  it("every language-sql body only calls functions that already exist", () => {
    const firstSeen = new Map();
    FILES.forEach((f, i) => {
      for (const m of read(f).matchAll(/create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(/gi)) {
        if (!firstSeen.has(m[1])) firstSeen.set(m[1], i);
      }
    });

    const problems = [];
    FILES.forEach((f, i) => {
      for (const fn of sqlFunctions(read(f))) {
        for (const [name, at] of firstSeen) {
          if (at <= i) continue;
          if (new RegExp(`\\b${name}\\s*\\(`).test(fn.body)) {
            problems.push(`${f}: ${fn.name}() calls ${name}(), first defined in ${FILES[at]}`);
          }
        }
      }
    });
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
});

describe("the scanner itself", () => {
  it("catches the shape that broke 022 and 031", () => {
    // Both failures reduced to this: a function reading a column the same file adds after it.
    const broken = `
      create or replace function f(p uuid) returns boolean
      language sql stable as $$ select exists (select 1 from t where t.later_col) $$;
      alter table t add column if not exists later_col boolean not null default false;
    `;
    const fns = sqlFunctions(broken);
    expect(fns).toHaveLength(1);
    const addAt = broken.indexOf("alter table t add column");
    expect(addAt).toBeGreaterThan(fns[0].at);
    expect(/\blater_col\b/.test(fns[0].body)).toBe(true);
  });

  it("ignores plpgsql, which defers resolution and does not fail at creation", () => {
    const deferred = `
      create or replace function f() returns void
      language plpgsql as $$ begin update t set later_col = true; end $$;
      alter table t add column if not exists later_col boolean;
    `;
    expect(sqlFunctions(deferred)).toHaveLength(0);
  });
});
