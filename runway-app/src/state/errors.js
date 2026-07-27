// Error reporting.
//
// `ViewBoundary` already catches render crashes and `console.error`s them — where nobody sees them.
// Today you find out about bugs because you personally hit them, which does not survive contact with
// a second user, let alone three hundred.
//
// WHY A SEAM AND NOT `@sentry/react` DIRECTLY. This app holds salaries, runway and funding status.
// Error SDKs are built to capture generously by default — breadcrumbs, URLs, request bodies, DOM text
// in session replays — because for most apps that is a feature. Here it is a leak: an unhandled
// exception carrying a `doc` object in its message would ship somebody's payroll to a third party,
// and nobody would notice until it mattered. So the vendor sits behind an adapter, exactly like the
// auth client and the storage backend, and everything passes through a scrubber on the way out.
//
// It is also OFF by default. No DSN, no reporting, no network call — which keeps local development
// and the test suite silent, and makes turning it on a deliberate act with a reviewable diff.

const MAX_MESSAGE = 500;

/** Fields whose VALUES must never leave the browser, matched case-insensitively on the key. */
const SECRET_KEYS = /(token|password|secret|key|authorization|cookie|session|jwt|apikey)/i;

/** Things that look like money, in messages. A stack trace has no business containing a salary, but
 *  `new Error(`Cannot read x of ${JSON.stringify(doc)}`)` is one careless line away at any time. */
const MONEYISH = /\b\d[\d,]{3,}(\.\d+)?\b/g;

/** Email addresses, which identify a person even when nothing else does. */
const EMAILISH = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** Reduce an arbitrary thrown value to a short, boring string.
 *
 *  DELIBERATELY LOSSY. A truncated message that says "Cannot read properties of null" is enough to
 *  find the bug; the object that was null is not, and is exactly the thing that must not be shipped. */
export function scrubMessage(input) {
  let s = typeof input === "string" ? input : (input?.message ?? String(input ?? ""));
  s = s.replace(EMAILISH, "<email>").replace(MONEYISH, "<number>");
  return s.length > MAX_MESSAGE ? s.slice(0, MAX_MESSAGE) + "…" : s;
}

/** Strip a context object down to values that are safe to send: short strings, booleans and small
 *  numbers. Anything nested, long, or secret-shaped is dropped rather than truncated — a partial
 *  document is still a document. */
export function scrubContext(ctx) {
  const out = {};
  for (const [k, v] of Object.entries(ctx || {})) {
    if (SECRET_KEYS.test(k)) { out[k] = "<redacted>"; continue; }
    if (typeof v === "boolean") { out[k] = v; continue; }
    if (typeof v === "number") { out[k] = Number.isFinite(v) && Math.abs(v) < 1000 ? v : "<number>"; continue; }
    if (typeof v === "string") { out[k] = v.length <= 120 ? scrubMessage(v) : "<long>"; continue; }
    out[k] = "<omitted>";      // objects, arrays, functions — never sent
  }
  return out;
}

/** Stack frames, with any query string or fragment stripped off the file URLs. A magic-link token in
 *  the address bar would otherwise ride along in every frame of every stack. */
export function scrubStack(stack) {
  if (!stack) return null;
  return String(stack)
    .split("\n").slice(0, 20)
    .map(l => l.replace(/(https?:\/\/[^\s)]+?)[?#][^\s)]*/g, "$1"))
    .join("\n");
}

let sink = null;
let appContext = {};

/** Install a reporter. Called once at startup when a DSN is configured; never in tests. */
export function initErrorReporting(fn, context = {}) {
  sink = typeof fn === "function" ? fn : null;
  appContext = scrubContext(context);
}

/** For tests and for turning it off again. */
export function _resetErrorReporting() { sink = null; appContext = {}; }

export const isReportingEnabled = () => sink !== null;

/** Report an error. Safe to call from anywhere, including inside an error handler: it never throws,
 *  because an error reporter that can fail is a way of losing the original error. */
export function reportError(err, context = {}) {
  const event = {
    message: scrubMessage(err),
    name: err?.name || "Error",
    stack: scrubStack(err?.stack),
    context: { ...appContext, ...scrubContext(context) },
    at: new Date().toISOString(),
  };
  // Always log locally, whether or not a sink is installed — the console is the developer's channel
  // and it should not go quiet just because reporting was switched on.
  console.error("[runway]", event.message, event.context);
  if (!sink) return event;
  try { sink(event); } catch { /* reporting must never mask the thing being reported */ }
  return event;
}

/** Catch what escapes React: async rejections and errors outside the render tree, which is most of
 *  the storage and sync layer. Returns a teardown so tests can install it without leaking. */
export function installGlobalHandlers(target = globalThis) {
  const onError = (e) => reportError(e?.error || e?.message, { kind: "uncaught" });
  const onRejection = (e) => reportError(e?.reason, { kind: "unhandled-rejection" });
  target.addEventListener?.("error", onError);
  target.addEventListener?.("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener?.("error", onError);
    target.removeEventListener?.("unhandledrejection", onRejection);
  };
}
