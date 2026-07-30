// THE SEAM. Nothing outside this file knows where the document lives or when it gets written, so when
// this becomes a hosted app it becomes a Supabase call and nothing else changes. It has exactly one
// import site (App.jsx), which is what makes that swap safe.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE:
//
// 1. load() RETURNS A STATE, not just a document. "There is no document yet" and "I could not read the
//    document" look identical if all you hand back is an empty object — and the caller will cheerfully
//    save that empty object over the real one moments later. That was a live data-loss bug (a transient
//    IndexedDB read failure destroyed the document), and a network makes the same failure routine.
//
// 2. WRITE CADENCE BELONGS HERE, not in the caller. App says "the document changed"; this file decides
//    when that reaches storage — debounced, coalesced, skipping no-op writes, with the pending document
//    held so a failure can be retried rather than lost.

import { emptyDoc, migrate } from "./document";
import { track } from "./funnel.js";
import { createLocalBackend, adoptionDismissed, dismissAdoption,
         readActiveCompany, writeActiveCompany, clearActiveCompany } from "./backends/local.js";
import { createSupabaseBackend } from "./backends/supabase.js";
import { createDemoBackend, clearDemo, demoInProgress, demoExpired, demoRemainingMs, DEMO_WINDOW_MS,
         stashPromotion, pendingPromotion, clearPromotion, markDemoReset, takeDemoReset } from "./backends/demo.js";
import { ERR_CONFLICT, ERR_PAYMENT_REQUIRED, ERR_STALE_CLIENT, isRetryable, kindOf } from "./backends/errors.js";

// WHICH BACKEND. Local is the default and stays the fallback for the whole hosted build: the app must
// remain fully functional with sync switched off. Hosting is opt-in and requires all three of a URL, an
// anon key, and an auth provider — a half-configured hosted backend must never silently degrade into
// "there is no document", because that is the input to the clobber this file exists to prevent.
let _backend = null;

export function setBackend(b) {
  _backend = b;
  _lastWritten = null;          // a different store may hold something different
}
// NOT hooks, despite living beside React code — these are plain selectors, and naming them use* would
// invite a reader to think an activateDemoBackend() call inside a useState initialiser was a rules-of-hooks
// violation.
export function activateLocalBackend() { setBackend(createLocalBackend()); }

/** Enter demo mode: a working model that reaches neither the database nor this browser's real storage.
 *  The backend seam is what makes this small — cadence, status, conflicts and the journal all carry on
 *  working, and the only thing that changes is where a write goes, which is nowhere durable. */
export function activateDemoBackend(seed) { setBackend(createDemoBackend(seed)); }
export { clearDemo, demoInProgress, demoExpired, demoRemainingMs, DEMO_WINDOW_MS,
         stashPromotion, pendingPromotion, clearPromotion, markDemoReset, takeDemoReset };
export const isDemo = () => backend().name === "demo";
export function activateHostedBackend(cfg) { setBackend(createSupabaseBackend(cfg)); }
export function backendName() { return backend().name; }

function backend() {
  if (!_backend) _backend = createLocalBackend();
  return _backend;
}

/** Is a hosted backend configured in this build? Opt-in: absent config means local. */
export function syncConfigured(env = import.meta.env) {
  return syncConfigReport(env).ok;
}

/** WHICH of the three requirements is missing. "Not configured" is a useless thing to tell someone who
 *  believes they configured it — three separate things gate this, and two of them fail silently in ways
 *  that look identical from the outside. */
export function syncConfigReport(env = import.meta.env) {
  const missing = [];
  const flag = env?.VITE_SYNC_ENABLED;
  if (flag !== "true") {
    missing.push(flag === undefined
      ? 'VITE_SYNC_ENABLED is not set (note: Vite inlines VITE_* at BUILD time — after editing .env you must rebuild, not just restart)'
      : `VITE_SYNC_ENABLED must be exactly "true", got ${JSON.stringify(flag)}`);
  }
  if (!env?.VITE_SUPABASE_URL) missing.push("VITE_SUPABASE_URL is empty or unset");
  if (!env?.VITE_SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY is empty or unset");
  // VITE_SITE_URL is NOT required — omitting it falls back to the current origin, which is right in
  // local dev and in preview builds. It matters only in the case that bit us: a canonical domain
  // exists, the app is also reachable at per-deployment URLs, and an auth link asked for at one of
  // those comes back to a host behind its own login wall.
  return { ok: missing.length === 0, missing };
}

// ok     — the document loaded. Includes a legitimately new, empty document.
// stale  — a document exists but this build is too old to read it. Do not save; tell the user to reload.
// failed — storage was unreachable. Do not save; the document may still be there.
export const LOAD_OK = "ok";
export const LOAD_STALE = "stale";
export const LOAD_FAILED = "failed";

// THE DEBOUNCE BELONGS TO THE BACKEND, not to this file. Local writes are cheap, so a short wait keeps
// "saved" honest; pushing a 40-300KB body over a network every 400ms while somebody types a project
// name is wasteful and pointless. This constant is now only the FALLBACK for a backend that declares
// no cadence of its own — test fakes, mostly — and the local value it happens to equal.
export const SAVE_DEBOUNCE_MS = 400;
// Never let unsaved work sit indefinitely behind a stream of edits that keeps resetting the debounce.
export const MAX_UNSAVED_MS = 30000;
const RETRY_MS = [400, 1500, 4000];

/** The scheduler's wait, ASKED OF THE ACTIVE BACKEND every time rather than captured once.
 *  The backend changes during a session — sign-in swaps in the hosted one, demo mode swaps in its own —
 *  so a value read at module load would give a hosted session the local cadence for its whole life,
 *  which is the bug this indirection exists to prevent rather than a style preference. */
export const saveDebounceMs = () => backend().saveDebounceMs ?? SAVE_DEBOUNCE_MS;

export async function load() {
  let found;
  try {
    found = await backend().read();
  } catch (e) {
    // Could not reach the store. Hand back something renderable, but flag it so the caller refuses to
    // save: the real document is almost certainly still there, and a save now would overwrite it.
    if (kindOf(e) === ERR_STALE_CLIENT) {
      return { state: LOAD_STALE, doc: emptyDoc(), error: e };
    }
    console.error("Storage unavailable", e);
    return { state: LOAD_FAILED, doc: emptyDoc(), error: e };
  }

  if (!found) {
    // A brand-new, untouched document must not be written back. Treating it as already-saved means the
    // debounced save sees no change and stays quiet — otherwise signing in silently creates an empty
    // document row, which (a) is noise and (b) makes the account no longer "new", permanently
    // suppressing the offer to adopt a model left in this browser. Nothing is persisted until the user
    // actually does something.
    const fresh = emptyDoc();
    _lastWritten = serialise(fresh);
    return { state: LOAD_OK, doc: fresh, isNew: true };
  }

  try {
    const doc = migrate(found.raw);
    _lastWritten = serialise(doc);      // loaded == saved; don't rewrite it unchanged
    return { state: LOAD_OK, doc, meta: found.meta };
  } catch (e) {
    // Never destroy a document you can't read. Park a copy, and refuse to save over the original.
    console.error("Could not read the stored document; the original has been kept", e);
    await backend().park(found.raw);
    return { state: LOAD_STALE, doc: emptyDoc(), error: e };
  }
}

// ---------------------------------------------------------------- write path --

// saved    — nothing pending, the last write succeeded
// unsaved  — changes are pending (in the debounce window, or queued behind a write)
// saving   — a write is in flight
// error    — the last write failed; the changes are still held and will be retried
// conflict — the document moved elsewhere; retrying would overwrite it, so we stop and ask
// stale    — this build is older than the stored document; it must reload, not write
let _status = { state: "saved", at: null, error: null };
const _subs = new Set();

let _pending = null;        // the newest document awaiting a write
let _lastWritten = null;    // serialised form of what storage already holds
let _timer = null;
let _deadline = null;       // hard flush time, so a stream of edits can't starve the write
let _inFlight = false;
let _attempt = 0;
// Set when a write fails in a way that must NOT be retried (conflict, stale build, forbidden). Without
// it the "something arrived mid-write" reschedule below fires anyway and quietly retries the very write
// we just refused — which for a conflict means overwriting the other device after all.
let _halted = false;

const serialise = (doc) => JSON.stringify(doc);

function emit(next) {
  _status = { ..._status, ...next, at: new Date() };
  for (const fn of _subs) { try { fn(_status); } catch { /* a bad subscriber must not break saving */ } }
}

export function status() { return _status; }

export function subscribe(fn) {
  _subs.add(fn);
  fn(_status);
  return () => _subs.delete(fn);
}

/** The document changed. This schedules a write; it does not perform one. */
export function save(doc) {
  if (_halted) {                       // hold everything until the halt is resolved; keep the newest edit
    _pending = doc;
    return;
  }
  const body = serialise(doc);
  if (body === _lastWritten && !_pending) {
    // A no-op write is not free over a network, and it makes "saved at" lie about when work happened.
    emit({ state: "saved", error: null });
    return;
  }
  _pending = doc;
  emit({ state: "unsaved" });

  if (_deadline == null) _deadline = Date.now() + MAX_UNSAVED_MS;
  if (_timer) clearTimeout(_timer);
  const wait = Math.max(0, Math.min(saveDebounceMs(), _deadline - Date.now()));
  _timer = setTimeout(() => { _timer = null; flush(); }, wait);
}

/** Write anything pending right now. Safe to call when nothing is pending. */
export async function flush() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (_inFlight || _pending == null) return _status;

  const doc = _pending;
  const body = serialise(doc);
  _inFlight = true;
  emit({ state: "saving" });

  try {
    await backend().write(doc);
    _lastWritten = body;
    _attempt = 0;
    _deadline = null;
    _halted = false;
    // Only clear the pending slot if nothing newer arrived while this write was in flight.
    if (_pending === doc) {
      _pending = null;
      emit({ state: "saved", error: null });
      // A SAVE THAT ACTUALLY LANDED, which is the activation moment worth measuring — not a keystroke,
      // not an intent, a document in the database. Recorded once per device by `track`.
      void track("first_save");
    }
    else { emit({ state: "unsaved" }); }
  } catch (e) {
    // Hold the document. Losing an edit because a write blipped is the failure this whole file exists
    // to prevent — and some failures must NOT be retried, because retrying is how you overwrite
    // somebody else's work or push a document this build no longer understands.
    console.error("Could not save", e);
    const kind = kindOf(e);
    if (kind === ERR_CONFLICT)     { emit({ state: "conflict", error: e }); }
    else if (kind === ERR_STALE_CLIENT) { emit({ state: "stale", error: e }); }
    // A DISTINCT STATE, not a generic error. "Could not save" invites somebody to retry, reload, and
    // conclude the product is broken; this one has an answer and the UI needs to be able to say it.
    // The edit is still held in memory by the halt below, so nothing is lost by paying and retrying.
    else if (kind === ERR_PAYMENT_REQUIRED) { emit({ state: "unpaid", error: e }); }
    else { emit({ state: "error", error: e }); }

    if (isRetryable(e)) {
      const delay = RETRY_MS[Math.min(_attempt, RETRY_MS.length - 1)];
      _attempt += 1;
      if (_attempt <= RETRY_MS.length) _timer = setTimeout(() => { _timer = null; flush(); }, delay);
    } else {
      _halted = true;   // stop. The document is still held; resolving is a decision, not a retry.
    }
  } finally {
    _inFlight = false;
  }

  // something arrived mid-write, or a retry is due
  if (_pending != null && _timer == null && _attempt === 0 && !_halted) {
    // Same cadence as the scheduler above: work that arrived mid-write is not more urgent than work
    // that arrived before one, and a second timing rule here would drift from the first.
    _timer = setTimeout(() => { _timer = null; flush(); }, saveDebounceMs());
  }
  return _status;
}

export const hasUnsavedWork = () => _pending != null;
export const isHalted = () => _halted;
export const pendingDoc = () => _pending;

/** The document sitting in THIS BROWSER, regardless of which backend is active. Signing in switches
 *  reads to the server, which makes a locally-built model invisible — not lost, but invisible, which is
 *  worse in some ways because nothing tells you it is still there. This is how the app finds it in order
 *  to offer it back. It never deletes anything. */
export async function peekLocal() {
  try {
    const found = await createLocalBackend().read();
    if (!found) return null;
    return migrate(found.raw);
  } catch {
    return null;
  }
}

export { adoptionDismissed, dismissAdoption, readActiveCompany, clearActiveCompany };

/** The server's current document, without adopting it. Used to show a conflict as a comparison rather
 *  than as an alarming sentence — nobody can choose between two versions they cannot see. */
export async function peekRemote() {
  const found = await backend().read();
  if (!found) return null;
  try { return migrate(found.raw); } catch { return null; }
}

/** Point the app at a different company and hand back its document.
 *
 *  FLUSHES FIRST, and that ordering is the whole point: a pending write belongs to the company you were
 *  looking at, and landing it after the switch files your numbers against the wrong company. Then the
 *  write state is reset — a different company holds a different document, so `_lastWritten` from the old
 *  one would suppress the first save in the new one. */
export async function switchCompany(auth, companyId) {
  await flush();

  // BLOCKING THE SWITCH ONLY MAKES SENSE FOR A SAVE THAT MIGHT LATER SUCCEED.
  //
  // The guard exists so a network failure does not silently discard work. But `payment_required` is
  // not transient: it will refuse forever until somebody pays. Treating it like a dropped connection
  // trapped people on the one company they cannot edit — unable to reach a company they CAN edit, and
  // unable to reach the page where they would pay. A guard meant to protect your work had taken the
  // product away instead.
  //
  // So this refuses only on RETRYABLE failures. On payment_required the switch proceeds and the caller
  // is told what was left behind, which is honest: the edit was never going to save, and holding
  // somebody hostage on that screen does not preserve it. Reads and export stay open throughout.
  if (hasUnsavedWork()) {
    if (kindOf(_status.error) === ERR_PAYMENT_REQUIRED) {
      console.warn("[runway] switching away from an unpaid company; its unsaved edit was not kept");
    } else {
      throw new BackendErrorLike("Couldn't save your current work, so nothing was switched.");
    }
  }

  auth.setActiveCompany(companyId);
  await writeActiveCompany(companyId, await auth.userId?.());

  _pending = null; _lastWritten = null; _deadline = null; _attempt = 0; _halted = false;
  emit({ state: "saved", error: null });

  return load();
}

// A local stand-in so this module needn't import the error class just to refuse politely.
class BackendErrorLike extends Error {}

/** Leave a company that is being deleted, and load whatever comes next.
 *
 *  The opposite of switchCompany on purpose: it does NOT flush. Pending work belongs to a company that
 *  is about to stop existing, so writing it first would only push data into a row we are deleting a
 *  moment later — and on a slow connection it could land AFTER the delete and resurrect a document with
 *  no company. Dropping it is the correct answer, and the caller is responsible for having offered an
 *  export before getting here.
 *
 *  `nextCompanyId` of null means "there are none left": the selection is cleared and current_company()
 *  creates a fresh one, so a person is never left with an account pointing at nothing. */
export async function abandonCompany(auth, nextCompanyId) {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _pending = null; _lastWritten = null; _deadline = null; _attempt = 0; _halted = false;

  if (nextCompanyId) {
    auth.setActiveCompany(nextCompanyId);
    await writeActiveCompany(nextCompanyId, await auth.userId?.());
  } else {
    auth.clearSelection();
    await writeActiveCompany(null);
  }

  emit({ state: "saved", error: null });
  return load();
}

/** Settle a conflict.
 *
 *  "mine"   — keep this device's work. Re-reads first so the write carries the CURRENT version and
 *             therefore passes the precondition; the server's copy is not lost, save_document files it
 *             into document_versions before overwriting.
 *  "theirs" — take the server's copy. Returns it so the caller can adopt it. The local edit is dropped,
 *             which is why the UI must offer an export before calling this.
 *
 *  Deliberately explicit and deliberately not automatic: a conflict is a question about intent, and
 *  guessing is how you silently destroy the version somebody cared about. */
export async function resolveConflict(choice) {
  const server = await backend().read();          // also refreshes the version the next write will carry

  if (choice === "theirs") {
    _pending = null; _halted = false; _attempt = 0; _deadline = null;
    const doc = server ? migrate(server.raw) : emptyDoc();
    _lastWritten = serialise(doc);                // adopted == saved; don't immediately rewrite it
    emit({ state: "saved", error: null });
    return { adopted: doc };
  }

  _halted = false; _attempt = 0;
  await flush();
  return { adopted: null };
}

/** Clear a halt after the user has decided what to do (kept their version, or reloaded the other one).
 *  Deliberately explicit: a halt is a question, and it should not un-ask itself. */
export function resumeAfterHalt() {
  _halted = false;
  _attempt = 0;
  if (_pending != null) { emit({ state: "unsaved", error: null }); flush(); }
  else emit({ state: "saved", error: null });
}

/** Test seam: forget module-level write state between cases. */
export function _resetWriteState() {
  if (_timer) clearTimeout(_timer);
  _timer = null; _pending = null; _lastWritten = null; _deadline = null;
  _inFlight = false; _attempt = 0; _halted = false;
  _status = { state: "saved", at: null, error: null };
}
