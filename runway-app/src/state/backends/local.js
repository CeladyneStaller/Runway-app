// Local backend: the browser's own IndexedDB. This is what the app has always used, now behind the
// same two-method interface the hosted backend implements, so storage.js does not care which is in play.
//
// BACKEND CONTRACT
//   read()      -> { raw, meta } | null      null means "no document yet", which is NOT an error
//               -> throws if the store is unreachable (the caller must not treat that as "empty")
//   write(raw)  -> { meta }                  throws on failure; the caller holds the document and retries
import { get, set } from "idb-keyval";

const KEY = "runway:doc";
const DISMISSED = "runway:adoption-dismissed";

// Whether the user has already said no to uploading the model left in this browser. Kept in IndexedDB
// alongside the document rather than localStorage, which this app does not use. Asking once is help;
// asking every load is nagging.
export async function adoptionDismissed() {
  try { return (await get(DISMISSED)) === true; } catch { return false; }
}
export async function dismissAdoption() {
  try { await set(DISMISSED, true); } catch { /* not worth failing a session over */ }
}

export function createLocalBackend() {
  return {
    name: "local",
    async read() {
      const raw = await get(KEY);          // a throw here propagates: unreachable != empty
      return raw ? { raw, meta: {} } : null;
    },
    async write(raw) {
      await set(KEY, { ...raw, updatedAt: new Date().toISOString() });
      return { meta: {} };
    },
    async park(raw) {
      // Never destroy a document you can't read.
      try { await set(`${KEY}:unreadable:${Date.now()}`, raw); } catch { /* nothing further to try */ }
    },
  };
}
