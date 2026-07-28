// One call to turn hosted sync on. Composes the auth adapter and the hosted backend and hands them to
// storage.js, so the app entry point does not need to know how any of those fit together.
//
// The ONLY thing the caller supplies that this repo cannot build itself is `getSession` — a one-line
// wrapper around @supabase/supabase-js. Everything else here is dependency-free and tested.
import { createSupabaseAuth } from "./auth.js";
import { createAccountApi } from "./account.js";
import { createSession } from "./session.js";
import { syncConfigured, activateHostedBackend, activateLocalBackend, clearActiveCompany } from "./storage.js";

// The live session provider and company resolver, registered once at start-up so the UI can reach them
// without threading them through every component. Null in local mode, which is how the app knows not to
// ask anyone to sign in.
let _session = null;
let _auth = null;
let _account = null;
export const getSessionProvider = () => _session;
export const getAuthAdapter = () => _auth;
export const getAccountApi = () => _account;

/**
 * @param getSession  () => Promise<{ access_token } | null>  — from the Supabase SDK
 * @returns { enabled, reason?, auth? }
 */
export function enableHostedSync({ authClient, getSession, env = import.meta.env, fetchImpl, activeCompany } = {}) {
  if (!syncConfigured(env)) {
    // Not an error. Local-first is the fallback for the whole hosted build, and a half-configured
    // hosted backend must never quietly stand in for a working one.
    activateLocalBackend();
    _session = null; _auth = null; _account = null;
    return { enabled: false, reason: "sync not configured" };
  }

  // `authClient` is supabase.auth; `getSession` alone is the headless path used by tests.
  const session = authClient ? createSession(authClient) : null;
  const readSession = session ? () => session.current() : getSession;
  if (typeof readSession !== "function") {
    activateLocalBackend();
    _session = null; _auth = null; _account = null;
    return { enabled: false, reason: "no authClient or getSession() supplied" };
  }

  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const auth = createSupabaseAuth({ url, anonKey, getSession: readSession, fetchImpl, activeCompany });
  activateHostedBackend({ url, anonKey, auth, fetchImpl });

  _session = session;
  _auth = auth;
  _account = createAccountApi({ url, anonKey, auth, fetchImpl });

  // Signing out must clear the resolved company, or the next person to sign in on this browser inherits
  // the previous user's document. Wiring it here rather than in the button means it cannot be forgotten.
  if (session) {
    // Belt AND braces: `auth.reset()` clears the resolved company in memory, `clearActiveCompany()`
    // clears the copy on disk. The disk copy is also user-keyed, because this handler does not fire
    // for every way a session ends — an expired refresh token, cleared cookies, a tab closed offline.
    session.onChange((s) => { if (!s) { auth.reset(); void clearActiveCompany(); } });
  }

  return { enabled: true, auth, session, account: _account };
}
