// Demo backend: a fully working model that goes nowhere permanent.
//
// For showing the app to someone who has not signed up. Every edit behaves normally — the projection
// moves, the journal records, scenarios run — and none of it reaches the database. The model is kept in
// THIS BROWSER for a fixed window and then resets.
//
// WHY localStorage AND NOT IndexedDB, which the rest of the app uses for real documents: a demo written
// to IndexedDB would look exactly like a real locally-built model, and the adoption flow would later
// offer to upload a fictional company into somebody's real account. `peekLocal()` reads IndexedDB; the
// demo lives in a store the app never consults for real documents, so that collision is impossible
// rather than merely unlikely. That reasoning is unchanged from when this used sessionStorage — only
// the mechanism moved.
//
// WHY NOT sessionStorage, which it used to be: sessionStorage dies with the tab, which makes a
// twelve-hour window unreachable, and — the stronger reason — it loses the demo across a sign-up round
// trip. Confirming an email frequently opens a DIFFERENT TAB, so a tab-scoped demo evaporates at exactly
// the moment somebody is doing the thing we most want them to do: turning the demo into an account.
//
// Falls back to memory when localStorage is unavailable (private modes, embedded webviews). A demo that
// resets on refresh is a nuisance; a demo that refuses to open is a lost customer.

const KEY = "runway:demo";
const PROMOTE_KEY = "runway:demo:promote";
const RESET_KEY = "runway:demo:reset";

/** Twelve hours of WALL CLOCK from first entry — not twelve hours of tracked activity. A window you can
 *  name ("expires at 9pm") is one someone can plan around; a usage budget that pauses when you switch
 *  tabs is not explainable in a pill, and it invites a per-edit ticking clock that the demo does not
 *  need. The clock starts once, at first entry, and no edit or refresh touches it again. */
export const DEMO_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Deliberately much longer than the demo itself. Somebody who clicked "keep this" has told us what they
 *  want; making that intent expire on the same schedule as the browsing session would throw their work
 *  away while they were off confirming an email — which can take a day, not twelve hours. */
const PROMOTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Memory fallback lives at MODULE scope, not inside createDemoBackend, because the helpers below
// (demoInProgress, demoRemainingMs, the promotion stash) are called by App WITHOUT a backend instance
// in hand. Holding it per-instance is how those helpers end up silently reporting "no demo" on exactly
// the browsers where the fallback is doing the work.
const memory = { doc: null, promo: null };
const slot = (key) => (key === KEY ? "doc" : "promo");

// Probed once and remembered. Availability is not the same as writability — Safari's private mode
// throws on setItem, so the probe writes rather than merely reading.
let _store;
const store = () => {
  if (_store !== undefined) return _store;
  try {
    const s = globalThis.localStorage;
    s.setItem(`${KEY}:probe`, "1");
    s.removeItem(`${KEY}:probe`);
    _store = s;
  } catch { _store = null; }
  return _store;
};

const get = (key) => {
  const s = store();
  if (!s) return memory[slot(key)];
  const raw = s.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }   // corrupt; treat as absent
};

const put = (key, val) => {
  const s = store();
  if (s) { try { s.setItem(key, JSON.stringify(val)); return; } catch { /* quota — fall through */ } }
  memory[slot(key)] = val;
};

const drop = (key) => {
  const s = store();
  if (s) { try { s.removeItem(key); } catch { /* already gone */ } }
  memory[slot(key)] = null;
};

/** An envelope is `{ startedAt, doc }`. Returns it only while inside its window; null otherwise. */
const live = (env, windowMs) =>
  env && typeof env.startedAt === "number" && Date.now() - env.startedAt < windowMs ? env : null;

export function createDemoBackend(seed, { replace = false } = {}) {
  const existing = live(get(KEY), DEMO_WINDOW_MS);
  // Adopt the EXISTING start time when there is one. Stamping `Date.now()` here unconditionally would
  // restart the twelve hours on every refresh, which is a demo that never expires.
  const startedAt = existing ? existing.startedAt : Date.now();
  // ⚠️ `!existing` IS RIGHT FOR A REFRESH AND WRONG FOR A DELIBERATE SWITCH. Without `replace`, picking
  // a different demo company set the backend up again and **kept the document already in memory** — the
  // modal closed, the archetype changed, and the screen showed the same company.
  //
  // The twelve-hour clock is NOT restarted on a switch: somebody exploring three archetypes has not
  // earned three fresh windows, and the guard above exists precisely so a refresh cannot do that.
  if (seed && (replace || !existing)) put(KEY, { startedAt, doc: seed });

  return {
    name: "demo",
    // 400, matching local, and stated here rather than imported from `local.js`: the two share a
    // REASON, not a dependency. Nothing in a demo crosses a network, and a demo is exactly where
    // somebody closes the tab abruptly, so the window stays short.
    saveDebounceMs: 400,
    async read() {
      const env = live(get(KEY), DEMO_WINDOW_MS);
      return env ? { raw: env.doc, meta: {} } : null;
    },
    async write(raw) {
      // Writes carry the ORIGINAL startedAt forward. An edit must not buy you another twelve hours.
      put(KEY, { startedAt, doc: raw });
      return { meta: {} };
    },
    async park() {},
  };
}

/** Wipe the demo. Called when leaving demo mode and when the window closes, so the next visitor starts
 *  from the same place. Deliberately does NOT touch the promotion stash: leaving the demo is exactly
 *  what somebody does on their way to creating the account they asked to promote it into. */
export function clearDemo() { drop(KEY); }

/** Is there a demo in progress in this browser? Used to restore it across a refresh. False once the
 *  window has closed, so an expired demo does not silently resurrect. */
export function demoInProgress() { return !!live(get(KEY), DEMO_WINDOW_MS); }

/** A demo exists but its window has closed. Distinct from `!demoInProgress()`, which is also true when
 *  there was never a demo at all — the difference is whether we owe somebody an explanation. */
export function demoExpired() {
  const env = get(KEY);
  return !!env && typeof env.startedAt === "number" && !live(env, DEMO_WINDOW_MS);
}

/** Milliseconds until the window closes, or null when there is no live demo. Drives the countdown in
 *  the pill — the reset has to be visible on approach, because a model that vanishes mid-sentence is
 *  worse than one that never persisted. */
export function demoRemainingMs() {
  const env = live(get(KEY), DEMO_WINDOW_MS);
  return env ? Math.max(0, env.startedAt + DEMO_WINDOW_MS - Date.now()) : null;
}

/** Snapshot the demo AT THE MOMENT OF INTENT, not at the moment of arrival. Between "keep this" and a
 *  confirmed email sits an unbounded amount of time, and the demo's own window can close inside it.
 *  Copying the document here means the promotion survives the expiry it outran. */
export function stashPromotion(doc) { put(PROMOTE_KEY, { startedAt: Date.now(), doc }); }

/** The document somebody asked to carry into an account, or null. */
export function pendingPromotion() {
  const env = live(get(PROMOTE_KEY), PROMOTE_WINDOW_MS);
  return env ? env.doc : null;
}

export function clearPromotion() { drop(PROMOTE_KEY); }

// The one-shot "your demo reset" notice. sessionStorage IS right here where it was wrong above: the
// notice is about this tab's reload and must not follow the person to a new tab tomorrow.
export function markDemoReset() {
  try { globalThis.sessionStorage?.setItem(RESET_KEY, "1"); } catch { /* nothing to mark */ }
}

/** Read-and-clear, so the notice shows exactly once. */
export function takeDemoReset() {
  try {
    const s = globalThis.sessionStorage;
    if (!s?.getItem(RESET_KEY)) return false;
    s.removeItem(RESET_KEY);
    return true;
  } catch { return false; }
}
