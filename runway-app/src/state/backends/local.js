// Local backend: the browser's own IndexedDB. This is what the app has always used, now behind the
// same two-method interface the hosted backend implements, so storage.js does not care which is in play.
//
// BACKEND CONTRACT
//   read()      -> { raw, meta } | null      null means "no document yet", which is NOT an error
//               -> throws if the store is unreachable (the caller must not treat that as "empty")
//   write(raw)  -> { meta }                  throws on failure; the caller holds the document and retries
import { get, set } from "idb-keyval";

const KEY = "runway:doc";

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
