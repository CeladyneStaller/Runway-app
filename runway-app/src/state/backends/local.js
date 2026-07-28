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
const ACTIVE_COMPANY = "runway:active-company";

// Whether the user has already said no to uploading the model left in this browser. Kept in IndexedDB
// alongside the document rather than localStorage, which this app does not use. Asking once is help;
// asking every load is nagging.
export async function adoptionDismissed() {
  try { return (await get(DISMISSED)) === true; } catch { return false; }
}
export async function dismissAdoption() {
  try { await set(DISMISSED, true); } catch { /* not worth failing a session over */ }
}

// Which company THIS DEVICE is looking at. Per-device on purpose: a view preference, not data.
//
// STORED WITH THE USER IT BELONGS TO, and that is the whole point of the shape. It used to be a bare
// id, so signing out and signing in as somebody else on the same browser left the previous account's
// company id sitting in IndexedDB, where boot handed it straight to the auth adapter. Every save then
// went to a company the new user is not a member of and came back 403 `forbidden` — an error that
// names permissions and points at nothing you can act on.
//
// A user-keyed value cannot be inherited, and it does not depend on sign-out RUNNING. Clearing on
// sign-out is done as well (see `sync.js`), but a session can end without that ever firing: an expired
// refresh token, cleared cookies, a tab that was closed while offline. The stored value has to be
// self-describing for those.
export async function readActiveCompany(userId = null) {
  try {
    const v = await get(ACTIVE_COMPANY);
    if (!v) return null;
    // A bare string is the OLD format, from before this was keyed. Treat it as belonging to nobody:
    // returning it would reintroduce exactly the inheritance this shape exists to prevent.
    if (typeof v === "string") return null;
    if (!v.userId || !userId || v.userId !== userId) return null;
    return v.companyId || null;
  } catch { return null; }
}
export async function writeActiveCompany(id, userId = null) {
  try { await set(ACTIVE_COMPANY, id ? { companyId: id, userId: userId || null } : null); }
  catch { /* the server remembers too */ }
}
export async function clearActiveCompany() {
  try { await set(ACTIVE_COMPANY, null); } catch { /* nothing further to try */ }
}

export const LOCAL_SAVE_DEBOUNCE_MS = 400;

export function createLocalBackend() {
  return {
    name: "local",
    // IndexedDB writes cost nothing worth saving up for, so keep the window short: the less time a
    // document spends only in memory, the less a crash can take with it.
    saveDebounceMs: LOCAL_SAVE_DEBOUNCE_MS,
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
