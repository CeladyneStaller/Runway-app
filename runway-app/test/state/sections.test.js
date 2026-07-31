// The split seam. One property carries the whole migration: a document that goes through `split` and
// back out of `assemble` must be the document that went in. If that holds, `buildModelParts` receives
// the identical object it receives today and nothing downstream — engine, projection, export, golden
// number — can tell that storage changed underneath it.
import { describe, it, expect } from "vitest";
import { splitDocument, assembleDocument, roundTrips, unaddressable, COLLECTIONS, stableStringify, assembleFromStorage }
  from "../../src/state/sections.js";
import { emptyDoc, demoDoc, migrate } from "../../src/state/document.js";

describe("the round trip", () => {
  it("survives the demo document", () => {
    const doc = demoDoc();
    expect(assembleDocument(splitDocument(doc))).toEqual(doc);
  });

  it("survives an empty document", () => {
    const doc = emptyDoc();
    expect(assembleDocument(splitDocument(doc))).toEqual(doc);
  });

  it("survives a migrated document, which is what load() actually produces", () => {
    const doc = migrate({ schemaVersion: 1, cash: 100, projects: [{ id: "p1", name: "One" }] });
    expect(assembleDocument(splitDocument(doc))).toEqual(doc);
  });

  it("preserves fields this module has never heard of", () => {
    // A document written by a newer version must survive an older one unchanged, or an export becomes
    // lossy in a way nobody notices until they import it.
    const doc = { ...emptyDoc(), somethingNew: { a: 1 }, projects: [{ id: "p1" }] };
    const out = assembleDocument(splitDocument(doc));
    expect(out.somethingNew).toEqual({ a: 1 });
    expect(out).toEqual(doc);
  });

  it("keeps ABSENT and EMPTY apart", () => {
    // A document with no `projects` key must not gain one — otherwise every document written before the
    // field existed fails the round trip.
    const without = { cash: 10 };
    expect(assembleDocument(splitDocument(without))).toEqual(without);
    expect("projects" in assembleDocument(splitDocument(without))).toBe(false);

    const empty = { cash: 10, projects: [] };
    expect(assembleDocument(splitDocument(empty))).toEqual(empty);
    expect(assembleDocument(splitDocument(empty)).projects).toEqual([]);
  });

  it("reports itself honestly", () => {
    expect(roundTrips(demoDoc())).toBe(true);
    expect(roundTrips(emptyDoc())).toBe(true);
  });
});

describe("order", () => {
  const doc = () => ({
    cash: 1,
    projects: [{ id: "c", name: "Third" }, { id: "a", name: "First" }, { id: "b", name: "Second" }],
  });

  it("is carried by position, not by id", () => {
    const parts = splitDocument(doc());
    expect(parts.collections.projects.map(r => [r.id, r.position]))
      .toEqual([["c", 0], ["a", 1], ["b", 2]]);
  });

  it("is restored from position even when the rows arrive shuffled", () => {
    // Rows come back from Postgres in whatever order it likes. This is the assertion that stops a
    // storage change from silently reordering somebody's project list.
    const parts = splitDocument(doc());
    const shuffled = { ...parts, collections: { projects: [...parts.collections.projects].reverse() } };
    expect(assembleDocument(shuffled).projects.map(p => p.name))
      .toEqual(["Third", "First", "Second"]);
  });

  it("treats a missing position as first rather than throwing", () => {
    const out = assembleDocument({ core: { cash: 1 }, collections: { projects: [
      { id: "b", body: { id: "b" }, position: 1 }, { id: "a", body: { id: "a" } },
    ] } });
    expect(out.projects.map(p => p.id)).toEqual(["a", "b"]);
  });
});

describe("items that cannot be addressed", () => {
  it("are kept, not dropped", () => {
    // Losing a project to a missing id would be the worst possible outcome of a storage change, so it
    // keeps its place and gets reported instead.
    const doc = { projects: [{ id: "p1" }, { name: "no id" }, { id: "p3" }] };
    expect(assembleDocument(splitDocument(doc))).toEqual(doc);
  });

  it("are reported so a document can be looked at before its rows are trusted", () => {
    const doc = { projects: [{ id: "p1" }, { name: "no id" }] };
    expect(unaddressable(doc)).toEqual([{ collection: "projects", position: 1 }]);
  });

  it("and a healthy document reports none", () => {
    expect(unaddressable(demoDoc())).toEqual([]);
  });
});

describe("the registry, which is the point of doing it this way", () => {
  it("names the field and the table for every collection", () => {
    for (const c of COLLECTIONS) {
      expect(typeof c.key).toBe("string");
      expect(typeof c.table).toBe("string");
      expect(typeof c.idOf).toBe("function");
    }
  });

  it("splits only what it declares", () => {
    // Today: projects alone. Adding `payroll` later should be a registry entry and a migration, not a
    // second code path — which is why nothing in this module names `projects` directly.
    expect(COLLECTIONS.map(c => c.key)).toEqual(["projects"]);
    const parts = splitDocument(demoDoc());
    expect(Object.keys(parts.collections)).toEqual(["projects"]);
    expect(parts.core.employees).toBeDefined();   // still in the blob
    expect(parts.core.projects).toBeUndefined();  // and out of it
  });

  it("matches the table migration 034 actually creates", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/034_project_docs.sql", "utf8");
    for (const c of COLLECTIONS) {
      expect(sql, `034 creates no table for ${c.key}`).toContain(`create table if not exists ${c.table}`);
    }
  });
});

describe("what the engine sees", () => {
  it("gets an object it cannot distinguish from the original", async () => {
    // The whole safety argument, asserted against the thing that actually consumes the document.
    const { buildModelFromDoc } = await import("../../src/engine/buildmodel.js");
    const doc = demoDoc();
    const before = buildModelFromDoc(doc);
    const after = buildModelFromDoc(assembleDocument(splitDocument(doc)));
    expect(after).toEqual(before);
  });

  it("and the runway is the same number", async () => {
    const { runwayMonths } = await import("../../src/views/chrome/docsummary.js");
    const doc = demoDoc();
    expect(runwayMonths(assembleDocument(splitDocument(doc)))).toBe(runwayMonths(doc));
  });
});

describe("comparing two documents", () => {
  it("ignores key order, because assembling changes it", () => {
    // Assembling puts each collection back at the END of the object. A document whose `projects` sat in
    // the middle comes out ordered differently and is the same document. `JSON.stringify` disagrees,
    // which is why stage 2's dual write cannot use it — it would report divergence on every write.
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("does NOT ignore array order, which is meaning", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("tells genuinely different documents apart", () => {
    expect(stableStringify({ cash: 1 })).not.toBe(stableStringify({ cash: 2 }));
    expect(stableStringify({ a: null })).not.toBe(stableStringify({ a: 0 }));
  });

  it("drops an undefined value, because storage does", () => {
    // A document on its way to Postgres loses `undefined` keys. Reporting `{a: undefined}` as different
    // from `{}` would flag a divergence that the write itself erases — noise on every save.
    expect(stableStringify({ a: undefined })).toBe(stableStringify({}));
    expect(stableStringify({ a: undefined })).not.toBe(stableStringify({ a: null }));
  });

  it("but keeps undefined inside an ARRAY, where position is meaning", () => {
    expect(stableStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("handles nesting and the shapes a document actually contains", () => {
    const doc = demoDoc();
    expect(stableStringify(doc)).toBe(stableStringify(JSON.parse(JSON.stringify(doc))));
  });
});

describe("assembling from storage — stage 3", () => {
  const blobWith = (projects) => ({ cash: 100, employees: [{ id: "e1" }], projects });
  const P = (id) => ({ id, name: id.toUpperCase() });

  it("prefers the ROWS, which is the whole point of the flip", () => {
    const doc = assembleFromStorage(blobWith([P("stale")]), { projects: [P("fresh"), P("newer")] });
    expect(doc.projects.map(p => p.id)).toEqual(["fresh", "newer"]);
  });

  it("keeps everything that is not a collection from the blob", () => {
    const doc = assembleFromStorage(blobWith([P("a")]), { projects: [P("a")] });
    expect(doc.cash).toBe(100);
    expect(doc.employees).toEqual([{ id: "e1" }]);
  });

  it("FALLS BACK TO THE BLOB when the rows are empty but the blob is not", () => {
    // The failure this exists for: a company whose backfill never ran, a failed sync, a restore from
    // before the split. Taking the empty rows would delete every project from the model, on load, with
    // no error anywhere.
    const seen = [];
    const doc = assembleFromStorage(blobWith([P("a"), P("b")]), { projects: [] },
                                    { onFallback: (e) => seen.push(e) });
    expect(doc.projects.map(p => p.id)).toEqual(["a", "b"]);
    expect(seen).toEqual([{ collection: "projects", inBlob: 2 }]);
  });

  it("says nothing when both are legitimately empty", () => {
    const seen = [];
    const doc = assembleFromStorage(blobWith([]), { projects: [] }, { onFallback: (e) => seen.push(e) });
    expect(doc.projects).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("does not invent the field for a document that never had it", () => {
    const doc = assembleFromStorage({ cash: 5 }, {});
    expect("projects" in doc).toBe(false);
  });

  it("produces exactly what a plain load would, once the rows agree", () => {
    // The property stage 3 rests on: after the flip, the assembled document is the document.
    const doc = demoDoc();
    const fromStorage = assembleFromStorage(doc, { projects: doc.projects });
    expect(fromStorage).toEqual(doc);
  });

  it("and the engine agrees", async () => {
    const { buildModelFromDoc } = await import("../../src/engine/buildmodel.js");
    const doc = demoDoc();
    expect(buildModelFromDoc(assembleFromStorage(doc, { projects: doc.projects })))
      .toEqual(buildModelFromDoc(doc));
  });
});

describe("what must survive projects leaving the blob — stage 4", () => {
  it("the EXPORT still contains projects", async () => {
    // The export is the backup story AND the migration test. It serialises the in-memory document,
    // which is assembled — so it is unaffected. Asserted anyway, because losing projects from an export
    // would be discovered by somebody restoring one.
    const { toJSON, fromJSON } = await import("../../src/state/document.js");
    // A REAL document, because `fromJSON` migrates and a fixture without a `schemaVersion` cannot be
    // migrated. Stripped and reassembled, which is what stage 4 makes every load do.
    const doc = demoDoc();
    const stripped = { ...doc };
    delete stripped.projects;
    const round = fromJSON(toJSON(assembleFromStorage(stripped, { projects: doc.projects })));
    expect(round.projects).toEqual(doc.projects);
    expect(round.projects.length).toBeGreaterThan(0);
  });

  it("a stripped blob plus rows equals the document it came from", () => {
    // Exactly what stage 4 makes true on the server: `body - 'projects'` stored, rows the only copy.
    const doc = demoDoc();
    const stripped = { ...doc };
    delete stripped.projects;
    expect(assembleFromStorage(stripped, { projects: doc.projects })).toEqual(doc);
  });

  it("and the runway is unchanged by it", async () => {
    const { runwayMonths } = await import("../../src/views/chrome/docsummary.js");
    const doc = demoDoc();
    const stripped = { ...doc };
    delete stripped.projects;
    expect(runwayMonths(assembleFromStorage(stripped, { projects: doc.projects })))
      .toBe(runwayMonths(doc));
  });

  it("a stripped blob with NO rows is a document with no projects, not a fallback", () => {
    // After 037 the blob never carries projects, so an empty row set is the truth. The fallback cannot
    // fire here, which is why it must not be removed until every blob has been rewritten — a company
    // that has not saved since 037 still has its copy and still needs protecting.
    const seen = [];
    const doc = assembleFromStorage({ cash: 1 }, { projects: [] }, { onFallback: e => seen.push(e) });
    expect(doc.projects).toEqual([]);
    expect(seen).toEqual([]);
  });
});
