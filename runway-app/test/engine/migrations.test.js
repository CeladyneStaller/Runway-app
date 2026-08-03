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

describe("a function whose return type changes must be dropped first", () => {
  it("every redefinition either matches the previous signature or drops it", () => {
    // `create or replace` cannot alter a return type: Postgres answers "Row type defined by OUT
    // parameters is different" and the migration stops. Every `returns table` function that gains a
    // column needs an explicit drop, and this is the third ordering mistake in one batch — 022 and 031
    // referenced columns added later, 032 changed a shape without dropping.
    const seen = new Map();          // name -> the returns clause it last had
    const problems = [];

    for (const file of FILES) {
      const text = read(file);
      const re = /create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(([\s\S]*?)\)\s*\n?\s*returns\s+([\s\S]*?)\s+(?:language|as)\b/gi;
      let m;
      while ((m = re.exec(text))) {
        const [, name, , ret] = m;
        const shape = ret.replace(/\s+/g, " ").trim().toLowerCase();
        const replacing = /create\s+or\s+replace/i.test(m[0]);
        const dropped = new RegExp(`drop function if exists ${name}\\b`, "i").test(text.slice(0, m.index));
        const before = seen.get(name);
        if (before && before !== shape && replacing && !dropped) {
          problems.push(`${file}: ${name}() changes its return type without dropping it first\n` +
                        `      was: ${before}\n      now: ${shape}`);
        }
        seen.set(name, shape);
      }
    }
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
});

describe("an insert's column list must match its values", () => {
  it("every simple `insert into t (...) values (...)` balances", () => {
    // Caught while writing 035: a column added to the list and not to the values. plpgsql plans SQL
    // when a function is CALLED, so this fails at runtime rather than at create time — the same blind
    // spot `verify:rpc` exists for, and cheap enough to catch here first.
    const problems = [];
    for (const file of FILES) {
      const text = read(file);
      const re = /insert\s+into\s+(\w+)\s*\(([^;()]*?)\)\s*\n?\s*values\s*\(([^;]*?)\)\s*(?:returning|on\s+conflict|;)/gis;
      let m;
      while ((m = re.exec(text))) {
        const [, table, cols, vals] = m;
        if (/select/i.test(vals)) continue;                 // insert ... select, different shape
        const nCols = cols.split(",").length;
        // Commas inside a function call are not separators. Strip balanced parens first.
        let flat = vals, prev;
        do { prev = flat; flat = flat.replace(/\([^()]*\)/g, "_"); } while (flat !== prev);
        const nVals = flat.split(",").length;
        if (nCols !== nVals) {
          problems.push(`${file}: insert into ${table} has ${nCols} columns and ${nVals} values`);
        }
      }
    }
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
});

describe("the conflict check stays conditional on the blob", () => {
  it("the latest save_document only conflicts when the body would be overwritten", () => {
    // 038 added a short circuit so a project-only save leaves `documents.version` alone, and placed it
    // AFTER the conflict check — which raises first. Two people editing different projects still
    // collided, which was the entire point of the change. The fix is in the conflict test itself, and
    // reverting it to the bare version comparison would silently undo stage 5.
    // COMMENTS STRIPPED FIRST. 039's header quotes the OLD broken check to explain it, so searching
    // the raw text finds the comment rather than the code — which made this test fail against a
    // correct migration. A scanner that reads prose as though it were SQL is worse than none.
    const code = (f) => read(f).split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
    const withSave = FILES.filter(f => /create (or replace )?function save_document/.test(code(f)));
    const latest = withSave[withSave.length - 1];
    const sql = code(latest);
    const check = sql.slice(sql.indexOf("cur.version <> p_base_version"));
    const line = check.slice(0, check.indexOf("then"));

    expect(latest, "no migration defines save_document").toBeTruthy();
    expect(line, `${latest} conflicts on a stale version alone`).toMatch(/is distinct from/);
  });
});

/** Comments off before matching. A `--` line mentioning `m.is_advisor` is prose, not a read, and a
 *  scanner that counts prose is a scanner people switch off. */
const nc = (t) => t.replace(/--[^\n]*/g, "");

describe("a column read must exist on the table it is read from", () => {
  // THE BUG THIS WOULD HAVE CAUGHT. 043 read `m.is_advisor` off `memberships`; `is_advisor` is a
  // column on PROFILES (022) and a FUNCTION, and was never on memberships. `list_members` (032) returns
  // it as a computed column, which is exactly what made it look stored.
  //
  // Deliberately narrow: it tracks the columns each table actually declares, and only complains about
  // an alias it can resolve to one of them. A scanner that guessed would cry wolf and be turned off.

  const declared = () => {
    const cols = {};
    for (const f of FILES) {
      const src = nc(read(f));
      // create table foo ( ... )
      for (const m of src.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\)/g)) {
        const t = m[1];
        cols[t] = cols[t] || new Set();
        for (const line of m[2].split("\n")) {
          const c = /^\s*(\w+)\s+\w/.exec(line);
          if (c && !/^(primary|foreign|unique|check|constraint)$/i.test(c[1])) cols[t].add(c[1]);
        }
      }
      // alter table foo add column [if not exists] bar
      for (const m of src.matchAll(/alter table (\w+)\s+add column (?:if not exists )?(\w+)/g)) {
        cols[m[1]] = cols[m[1]] || new Set();
        cols[m[1]].add(m[2]);
      }
    }
    return cols;
  };

  it("every aliased column read resolves to a real one", () => {
    const cols = declared();
    const bad = [];

    for (const name of FILES) {
      const src = nc(read(name));
      // Find `from <table> <alias>` / `join <table> <alias>` and check `<alias>.<col>` against it.
      for (const m of src.matchAll(/\b(?:from|join)\s+(\w+)\s+(?!on\b|where\b|set\b)(\w+)\b/gi)) {
        const [, table, alias] = m;
        const known = cols[table];
        if (!known || known.size === 0) continue;         // not a table this repo declares

        // SCOPED TO THE STATEMENT, not the file. One letter means different tables in different
        // functions — `s` is `staff` in 014 and `subscriptions` two functions later — and searching the
        // whole file reported three confident falsehoods on the first run. A scanner that cries wolf
        // gets switched off, which costs more than never having written it.
        // BOTH DIRECTIONS. The window ran from `from` forwards, and in SQL the SELECT LIST COMES
        // FIRST — so `select m.is_advisor ... from memberships m` put the bad read outside the window
        // entirely. Reintroducing the real 043 bug and watching the scanner pass is how that surfaced;
        // a scanner nobody tests against the bug it was written for is decoration.
        const start = src.lastIndexOf(";", m.index) + 1;
        const end = src.indexOf(";", m.index);
        const stmt = src.slice(start, end < 0 ? src.length : end);

        for (const u of stmt.matchAll(new RegExp("\\b" + alias + "\\.(\\w+)", "g"))) {
          const col = u[1];
          if (!known.has(col)) bad.push(`${name}: ${alias}.${col} — ${table} has no such column`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
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
