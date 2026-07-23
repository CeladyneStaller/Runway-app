// THE SEAM. Nothing outside this file knows where the document lives, so when this becomes a hosted
// app it becomes a Supabase call and nothing else changes. It has exactly one import site (App.jsx),
// which is what makes that swap safe.
//
// load() RETURNS A STATE, it does not just return a document. That distinction is the whole point:
// "there is no document yet" and "I could not read the document" look identical if all you hand back
// is an empty object, and the caller will cheerfully save that empty object over the real one 400ms
// later. That was a live data-loss bug — a transient IndexedDB read failure destroyed the document —
// and it is the exact shape of the failure a network introduces (offline start, 500, expired session).
//
// The rule the caller must honour: NEVER save a document that did not come from a successful load.

import { get, set } from "idb-keyval";
import { emptyDoc, migrate } from "./document";

const KEY = "runway:doc";

// ok     — the document loaded. Includes a legitimately new, empty document.
// stale  — a document exists but this build is too old to read it. Do not save; tell the user to reload.
// failed — storage was unreachable. Do not save; the document may still be there.
export const LOAD_OK = "ok";
export const LOAD_STALE = "stale";
export const LOAD_FAILED = "failed";

export async function load() {
  let raw;
  try {
    raw = await get(KEY);
  } catch (e) {
    // Storage unreachable. Hand back something renderable, but flag it so the caller refuses to save:
    // the real document is probably still on disk and a save now would overwrite it.
    console.error("Storage unavailable", e);
    return { state: LOAD_FAILED, doc: emptyDoc(), error: e };
  }

  if (!raw) return { state: LOAD_OK, doc: emptyDoc(), isNew: true };

  try {
    return { state: LOAD_OK, doc: migrate(raw) };
  } catch (e) {
    // Never destroy a document you can't read. Park a copy, and refuse to save over the original.
    console.error("Could not read the stored document; the original has been kept", e);
    try { await set(`${KEY}:unreadable:${Date.now()}`, raw); } catch { /* nothing further to try */ }
    return { state: LOAD_STALE, doc: emptyDoc(), error: e };
  }
}

export async function save(doc) {
  await set(KEY, { ...doc, updatedAt: new Date().toISOString() });
}
