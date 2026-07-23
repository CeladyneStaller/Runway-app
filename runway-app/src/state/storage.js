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

import { get, set } from "idb-keyval";
import { emptyDoc, migrate } from "./document";

const KEY = "runway:doc";

// ok     — the document loaded. Includes a legitimately new, empty document.
// stale  — a document exists but this build is too old to read it. Do not save; tell the user to reload.
// failed — storage was unreachable. Do not save; the document may still be there.
export const LOAD_OK = "ok";
export const LOAD_STALE = "stale";
export const LOAD_FAILED = "failed";

// Local writes are cheap, so a short debounce keeps "saved" honest. Over a network this becomes ~2500ms:
// pushing a 40-300KB body every 400ms while someone types a project name is wasteful and pointless.
export const SAVE_DEBOUNCE_MS = 400;
// Never let unsaved work sit indefinitely behind a stream of edits that keeps resetting the debounce.
export const MAX_UNSAVED_MS = 30000;
const RETRY_MS = [400, 1500, 4000];

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
    const doc = migrate(raw);
    _lastWritten = serialise(doc);      // loaded == saved; don't rewrite it unchanged
    return { state: LOAD_OK, doc };
  } catch (e) {
    // Never destroy a document you can't read. Park a copy, and refuse to save over the original.
    console.error("Could not read the stored document; the original has been kept", e);
    try { await set(`${KEY}:unreadable:${Date.now()}`, raw); } catch { /* nothing further to try */ }
    return { state: LOAD_STALE, doc: emptyDoc(), error: e };
  }
}

// ---------------------------------------------------------------- write path --

// saved   — nothing pending, the last write succeeded
// unsaved — changes are pending (in the debounce window, or queued behind a write)
// saving  — a write is in flight
// error   — the last write failed; the changes are still held and will be retried
let _status = { state: "saved", at: null, error: null };
const _subs = new Set();

let _pending = null;        // the newest document awaiting a write
let _lastWritten = null;    // serialised form of what storage already holds
let _timer = null;
let _deadline = null;       // hard flush time, so a stream of edits can't starve the write
let _inFlight = false;
let _attempt = 0;

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
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, _deadline - Date.now()));
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
    await set(KEY, { ...doc, updatedAt: new Date().toISOString() });
    _lastWritten = body;
    _attempt = 0;
    _deadline = null;
    // Only clear the pending slot if nothing newer arrived while this write was in flight.
    if (_pending === doc) { _pending = null; emit({ state: "saved", error: null }); }
    else { emit({ state: "unsaved" }); }
  } catch (e) {
    // Hold the document. Losing an edit because a write blipped is the failure this whole file exists
    // to prevent.
    console.error("Could not save", e);
    emit({ state: "error", error: e });
    const delay = RETRY_MS[Math.min(_attempt, RETRY_MS.length - 1)];
    _attempt += 1;
    if (_attempt <= RETRY_MS.length) _timer = setTimeout(() => { _timer = null; flush(); }, delay);
  } finally {
    _inFlight = false;
  }

  // something arrived mid-write, or a retry is due
  if (_pending != null && _timer == null && _attempt === 0) {
    _timer = setTimeout(() => { _timer = null; flush(); }, SAVE_DEBOUNCE_MS);
  }
  return _status;
}

export const hasUnsavedWork = () => _pending != null;

/** Test seam: forget module-level write state between cases. */
export function _resetWriteState() {
  if (_timer) clearTimeout(_timer);
  _timer = null; _pending = null; _lastWritten = null; _deadline = null;
  _inFlight = false; _attempt = 0;
  _status = { state: "saved", at: null, error: null };
}
