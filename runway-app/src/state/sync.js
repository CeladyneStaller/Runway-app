// One call to turn hosted sync on. Composes the auth adapter and the hosted backend and hands them to
// storage.js, so the app entry point does not need to know how any of those fit together.
//
// The ONLY thing the caller supplies that this repo cannot build itself is `getSession` — a one-line
// wrapper around @supabase/supabase-js. Everything else here is dependency-free and tested.
import { createSupabaseAuth } from "./auth.js";
import { syncConfigured, useHostedBackend, useLocalBackend } from "./storage.js";

/**
 * @param getSession  () => Promise<{ access_token } | null>  — from the Supabase SDK
 * @returns { enabled, reason?, auth? }
 */
export function enableHostedSync({ getSession, env = import.meta.env, fetchImpl } = {}) {
  if (!syncConfigured(env)) {
    // Not an error. Local-first is the fallback for the whole hosted build, and a half-configured
    // hosted backend must never quietly stand in for a working one.
    useLocalBackend();
    return { enabled: false, reason: "sync not configured" };
  }
  if (typeof getSession !== "function") {
    useLocalBackend();
    return { enabled: false, reason: "no getSession() supplied" };
  }

  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const auth = createSupabaseAuth({ url, anonKey, getSession, fetchImpl });
  useHostedBackend({ url, anonKey, auth, fetchImpl });
  return { enabled: true, auth };
}
