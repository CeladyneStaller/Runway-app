// Sessions. Wraps the Supabase SDK's auth object behind a small, normalised interface so that every
// screen and test in this repo can drive sign-in without the SDK being installed.
//
// The SDK is passed IN (`supabase.auth`), never imported. That keeps the whole auth path testable with
// a fake, and keeps the dependency confined to main.jsx — the one file that genuinely needs it.
//
// What the SDK actually returns is inconsistent enough to be worth flattening here rather than at every
// call site: getSession() yields { data: { session }, error }, onAuthStateChange() yields
// { data: { subscription } }, and the sign-in calls yield { data, error } where the error is a value,
// not a throw. Normalising once means the UI can be written against something predictable.

export function createSession(authClient) {
  if (!authClient) throw new Error("createSession needs an auth client (supabase.auth)");

  const unwrap = (r) => r?.data?.session ?? null;

  return {
    /** The current session, or null. Also refreshes an expiring token as a side effect. */
    async current() {
      try {
        return unwrap(await authClient.getSession());
      } catch {
        return null;      // an unreadable session is a signed-out session as far as the UI is concerned
      }
    },

    /** Subscribe to sign-in / sign-out / token-refresh. Returns an unsubscribe function. */
    onChange(cb) {
      const res = authClient.onAuthStateChange((_event, session) => cb(session ?? null));
      const sub = res?.data?.subscription;
      return () => { try { sub?.unsubscribe?.(); } catch { /* already gone */ } };
    },

    /** Email magic link. This is BOTH sign-in and sign-up — the same link creates the account if there
     *  isn't one. `shouldCreateUser` is stated explicitly rather than left to the SDK default: account
     *  creation is the behaviour this product depends on, and depending on a default is how it silently
     *  stops working one library version later. Resolves to { ok } or { ok: false, message }. */
    async signInWithEmail(email, { redirectTo } = {}) {
      const clean = String(email || "").trim();
      if (!clean || !clean.includes("@")) return { ok: false, message: "Enter an email address." };
      try {
        const { error } = await authClient.signInWithOtp({
          email: clean,
          options: { shouldCreateUser: true, ...(redirectTo ? { emailRedirectTo: redirectTo } : {}) },
        });
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || "Could not send the link." };
      }
    },

    /** OAuth. The browser navigates away, so a resolved value here mostly means "redirect failed". */
    async signInWithProvider(provider, { redirectTo } = {}) {
      try {
        const { error } = await authClient.signInWithOAuth({
          provider,
          options: redirectTo ? { redirectTo } : undefined,
        });
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || "Could not start sign-in." };
      }
    },

    async signOut() {
      try {
        const { error } = (await authClient.signOut()) || {};
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || "Could not sign out." };
      }
    },
  };
}
