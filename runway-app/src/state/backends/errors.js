// One error taxonomy for every backend, so storage.js can react to a failure without knowing whether
// it came from IndexedDB or PostgREST.
export const ERR_UNREACHABLE = "unreachable";   // could not talk to the store at all — retry
export const ERR_CONFLICT = "conflict";         // the document moved since we loaded it — ask the user
export const ERR_STALE_CLIENT = "stale_client"; // this build is older than the stored document — reload
// A write refused for BILLING, not permission. Distinct from forbidden because the two want
// completely different words on screen: one is a mistake, the other is a purchase. Reads are never
// refused this way — an unpaid account can always open and export its own model.
export const ERR_PAYMENT_REQUIRED = "payment_required";
export const ERR_FORBIDDEN = "forbidden";       // not permitted — do not retry, do not discard

export class BackendError extends Error {
  constructor(kind, message, cause) {
    super(message || kind);
    this.name = "BackendError";
    this.kind = kind;
    this.cause = cause;
  }
}

// Checked by KIND, not by instanceof. An error can cross a module registry, a bundle chunk or a
// structured-clone boundary and lose its prototype — and an instanceof that quietly returns false here
// would classify a CONFLICT as retryable, which is precisely how you overwrite another device's work.
export const kindOf = (e) => (e && typeof e.kind === "string" ? e.kind : null);
export const isRetryable = (e) => {
  const k = kindOf(e);
  return k == null || k === ERR_UNREACHABLE;
};
