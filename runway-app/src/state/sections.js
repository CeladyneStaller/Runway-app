// Splitting a document into storable parts, and putting it back.
//
// TASK 3.8, STAGE 1. Only `projects` is split today, and this module is written as though several
// things were, on purpose: the moment `save_sections` takes a named `projects` parameter, splitting
// `payroll` later means a second parameter and a second code path. Taking an opaque map of parts means
// a later split is one registry entry and one migration — the same four stages, already rehearsed.
//
// THE PROPERTY THAT MAKES THE MIGRATION SAFE is the round trip: `assemble(split(doc))` deep-equals
// `doc`, for every document the suite has, including the golden fixture. If that holds then
// `buildModelParts` receives the identical object it receives today, and nothing downstream — the
// engine, the projection, the export, the golden number — can tell the difference.
//
// WHAT THIS IS NOT: a way to load less. `buildModelParts` compiles a project using `employees` for
// rates and `pos` for fulfilment stage, so any projection needs essentially the whole document.
// The wins are on the WRITE side — concurrency, permissions, and not rewriting 7 KB of project data to
// move a milestone.

/** Fields stored as one row each rather than inside the blob.
 *
 *  Adding one here is most of what a later split costs. The rest is a migration that mirrors 034 and a
 *  backfill that mirrors its `do $$` block. */
export const COLLECTIONS = Object.freeze([
  {
    key: "projects",       // the document field
    table: "project_docs", // where its rows live
    idOf: (item) => item?.id,
  },
]);

const COLLECTION_KEYS = COLLECTIONS.map(c => c.key);

/** `doc` -> `{ core, collections: { projects: [{id, body, position}] } }`
 *
 *  `core` is everything that is not a collection, INCLUDING fields this module has never heard of. A
 *  document written by a newer version of the app must survive a round trip through an older one
 *  unchanged, or an export becomes lossy in a way nobody notices until they import it. */
export function splitDocument(doc) {
  const core = {};
  for (const [k, v] of Object.entries(doc || {})) {
    if (!COLLECTION_KEYS.includes(k)) core[k] = v;
  }

  const collections = {};
  for (const c of COLLECTIONS) {
    const items = Array.isArray(doc?.[c.key]) ? doc[c.key] : null;
    // ABSENT AND EMPTY ARE DIFFERENT and both are preserved. A document with no `projects` key at all
    // must not gain one, or the round trip fails on documents written before the field existed.
    if (items === null) continue;
    collections[c.key] = items.map((item, position) => ({
      // AN ITEM WITH NO ID CANNOT BE ADDRESSED, and addressing them is the point. It keeps its place by
      // position and is carried in `orphans` rather than dropped — losing a project to a missing id
      // would be the worst possible outcome of a storage change.
      id: c.idOf(item) ?? null,
      body: item,
      position,
    }));
  }

  return { core, collections };
}

/** `{ core, collections }` -> `doc`, with every collection back in `position` order. */
export function assembleDocument(parts) {
  const doc = { ...(parts?.core || {}) };
  for (const c of COLLECTIONS) {
    const rows = parts?.collections?.[c.key];
    if (!rows) continue;                      // absent stays absent
    doc[c.key] = [...rows]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(r => r.body);
  }
  return doc;
}

/** Items a collection could not address. Empty is the expected answer; anything else is a document
 *  that needs looking at before its rows are trusted. */
export function unaddressable(doc) {
  const { collections } = splitDocument(doc);
  const out = [];
  for (const [key, rows] of Object.entries(collections)) {
    rows.forEach(r => { if (r.id == null || r.id === "") out.push({ collection: key, position: r.position }); });
  }
  return out;
}

/** A stable string for comparing two documents.
 *
 *  KEY ORDER IS NOT MEANING, and this is not a nicety. Assembling puts each collection back at the END
 *  of the object, so a document whose `projects` sat in the middle comes out ordered differently and
 *  `JSON.stringify` says they differ. They do not — no consumer of a document reads key order, and
 *  `buildModelParts` reaches for fields by name.
 *
 *  It is worth more than one test: STAGE 2's dual write compares the two paths before trusting either,
 *  and a naive stringify would report divergence on every write ever made. */
export function stableStringify(value) {
  if (value === undefined) return "null";                      // only reachable inside an array
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  // An array's holes and `undefined` entries become `null`, exactly as `JSON.stringify` does.
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  // A KEY WHOSE VALUE IS `undefined` IS DROPPED, also matching `JSON.stringify` — and matching what
  // actually happens to a document on its way to Postgres. Treating `{a: undefined}` as different from
  // `{}` would report a divergence that storage itself erases.
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** Does this document survive the round trip? Used by the tests and by the stage-2 dual write. */
export function roundTrips(doc) {
  try {
    return stableStringify(assembleDocument(splitDocument(doc))) === stableStringify(doc);
  } catch { return false; }
}

/** Rebuild a document from what storage returned: the blob, plus a row set per collection.
 *
 *  THE FALLBACK IS THE POINT, and it exists only for stage 3. Until the blob stops carrying `projects`
 *  (stage 4), both copies are present — so if the rows are EMPTY while the blob has projects, something
 *  is wrong: a company whose backfill never ran, a failed sync, a restore from before the split. Taking
 *  the rows in that situation would silently delete every project from somebody's model, on load, with
 *  no error anywhere.
 *
 *  So: prefer the rows, fall back to the blob, and SAY SO. `onFallback` is how the caller reports it —
 *  a fallback that happens quietly is a bug that gets discovered by its consequences.
 *
 *  DELETE THIS AT STAGE 4. Once the blob no longer carries the field, an empty row set is the truth
 *  rather than a symptom, and a fallback to a field that is not there would be dead code pretending to
 *  be a safety net.
 */
export function assembleFromStorage(body, collections = {}, { onFallback } = {}) {
  const { core } = splitDocument(body || {});
  const parts = { core, collections: {} };

  for (const c of COLLECTIONS) {
    const rows = collections[c.key];
    const fromRows = Array.isArray(rows) ? rows : null;
    const fromBlob = Array.isArray(body?.[c.key]) ? body[c.key] : null;

    if (fromRows && fromRows.length > 0) {
      parts.collections[c.key] = fromRows.map((item, position) => ({
        id: c.idOf(item) ?? null, body: item, position,
      }));
      continue;
    }

    // Rows empty and the blob is not: trust the blob and report it.
    if (fromBlob && fromBlob.length > 0) {
      onFallback?.({ collection: c.key, inBlob: fromBlob.length });
      parts.collections[c.key] = fromBlob.map((item, position) => ({
        id: c.idOf(item) ?? null, body: item, position,
      }));
      continue;
    }

    // Both empty. Absent stays absent — a document that never had the field must not gain one.
    if (fromRows || fromBlob) parts.collections[c.key] = [];
  }

  return assembleDocument(parts);
}
