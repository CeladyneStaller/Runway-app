// The activation funnel. Seven steps, and nothing else.
//
// WHY THIS IS NOT PostHog, Segment, or any other SDK — the same reason `state/sentry.js` posts its own
// envelope instead of calling `Sentry.init()`. Analytics SDKs AUTOCAPTURE by default: click targets,
// DOM text, input values, page URLs, sometimes session replay. For most apps that is the feature you
// are paying for. This app holds salaries, funding status and runway dates, and a product that asks
// people to trust it with those cannot also ship a library whose default behaviour is to record the
// screen.
//
// So the whole surface is: a fixed list of event NAMES, an anonymous id, and a timestamp.
//
// WHAT IS DELIBERATELY NOT SENT:
//   * no user id, no email, no company id or name
//   * no URL, referrer, or query string
//   * no properties, payloads, or custom fields — the API takes a name and nothing else, so there is
//     no parameter through which a number from somebody's model could ever arrive
//   * no user agent, screen size, or anything else that would narrow a person down
//
// The funnel is therefore computable — how many visitors reached each step — and useless for anything
// else, which is the point rather than a limitation. You cannot accidentally build surveillance on top
// of an API that accepts no arguments.
//
// OFF UNLESS CONFIGURED. Without `VITE_SYNC_ENABLED` and a Supabase URL there is nowhere to send
// anything and every call is a no-op, so local-first users emit nothing at all.

/** THE ALLOWLIST. Adding a step means adding it here AND to the CHECK constraint in migration 020 —
 *  deliberately two places, because a funnel that quietly grows new events is a funnel nobody can read
 *  a chart of six months later. */
export const FUNNEL_EVENTS = Object.freeze([
  "landed",              // saw the landing screen
  "demo_started",        // opened the demo
  "signup_started",      // submitted the create-account form
  "signup_completed",    // reached an authenticated session
  "setup_completed",     // finished the new-company wizard
  "first_save",          // a model saved successfully for the first time on this device
  "checkout_started",    // clicked a plan
  "checkout_completed",  // came back from Stripe with a live subscription
]);

const KEY = "runway:anon";
const SENT = "runway:funnel-sent";

/** A random id, not a fingerprint.
 *
 *  A funnel needs to know that the visitor who landed is the one who signed up, which requires SOME
 *  continuity. The honest way to get it is to generate a random value and store it; the dishonest way
 *  is to derive one from the browser, which works without consent and cannot be cleared. Clearing site
 *  data resets this, and that is correct behaviour rather than a gap. */
function anonId(storage) {
  try {
    let id = storage?.getItem(KEY);
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      storage.setItem(KEY, id);
    }
    return id;
  } catch { return null; }   // storage blocked: no id, no events, no error
}

/** Steps already recorded on this device, so a reload does not count a visitor twice.
 *
 *  The database enforces this too (unique on `anon_id, event`), because a client-side guard is a
 *  convenience and a server-side constraint is a guarantee. This one exists to avoid the request, not
 *  to avoid the duplicate. */
function alreadySent(storage) {
  try { return new Set(JSON.parse(storage?.getItem(SENT) || "[]")); } catch { return new Set(); }
}

export function createFunnel({ url, anonKey, enabled = true, fetchImpl, storage } = {}) {
  const store = storage ?? globalThis.localStorage;
  const doFetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const base = String(url || "").replace(/\/+$/, "");
  const live = !!(enabled && base && anonKey);

  return {
    live,

    /** Record a step. Returns true if it was sent.
     *
     *  NEVER THROWS AND NEVER AWAITS ANYTHING THE CALLER CARES ABOUT. This is instrumentation: it sits
     *  in the middle of signup and checkout, and an analytics failure must not be able to interrupt
     *  somebody paying. Every error path returns false and does nothing else. */
    async track(event) {
      if (!live) return false;
      if (!FUNNEL_EVENTS.includes(event)) {
        // Loud in development, silent in production — a typo'd event name is a chart that stays empty
        // for a month before anybody wonders why.
        console.warn(`[funnel] unknown event "${event}" — add it to FUNNEL_EVENTS and migration 020`);
        return false;
      }
      const id = anonId(store);
      if (!id) return false;

      const sent = alreadySent(store);
      if (sent.has(event)) return false;

      try {
        const res = await doFetch(`${base}/rest/v1/rpc/record_funnel_event`, {
          method: "POST",
          headers: { apikey: anonKey, "Content-Type": "application/json" },
          body: JSON.stringify({ p_event: event, p_anon: id }),
        });
        if (!res?.ok) return false;
        sent.add(event);
        try { store.setItem(SENT, JSON.stringify([...sent])); } catch { /* nothing to remember with */ }
        return true;
      } catch { return false; }
    },

    /** For tests and for a person who wants to see their own trail cleared. */
    reset() {
      try { store?.removeItem(KEY); store?.removeItem(SENT); } catch { /* nothing to clear */ }
    },
  };
}

// The instance the app uses. Registered from `main.jsx`, which is the only place that reads env.
let _funnel = createFunnel({ enabled: false });
export const setFunnel = (f) => { _funnel = f; };
export const track = (event) => _funnel.track(event);
