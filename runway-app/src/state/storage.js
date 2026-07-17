// THE SEAM. Two functions. Nothing outside this file knows IndexedDB exists, so when this becomes a
// multi-user app, this file becomes fetch("/api/doc") and nothing else changes.
import { get, set } from "idb-keyval";
import { emptyDoc, migrate } from "./document";

const KEY = "runway:doc";

export async function load() {
  let raw;
  try { raw = await get(KEY); } catch (e) { console.error("IndexedDB unavailable", e); return emptyDoc(); }
  if (!raw) return emptyDoc();
  try {
    return migrate(raw);
  } catch (e) {
    // Never destroy a document you can't read. Park it and let the user export it.
    console.error("Migration failed; the original has been kept", e);
    // best-effort: if even this write fails there is nothing further we can do, and throwing
    // here would lose the document we were trying to protect.
    try { await set(`${KEY}:unreadable:${Date.now()}`, raw); } catch { /* nothing left to try */ }
    return emptyDoc();
  }
}

export async function save(doc) {
  await set(KEY, { ...doc, updatedAt: new Date().toISOString() });
}
