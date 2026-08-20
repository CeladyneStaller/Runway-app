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

    /** Subscribe to sign-in / sign-out / token-refresh / password-recovery. The EVENT is passed as a
     *  second argument because arriving from a reset link looks like an ordinary sign-in unless you
     *  read it — and sending someone to their dashboard when they came to change their password is a
     *  dead end they cannot get out of. Returns an unsubscribe function. */
    onChange(cb) {
      const res = authClient.onAuthStateChange((event, session) => cb(session ?? null, event));
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
    /** ⚠️ NO CALLERS. The "Continue with Google" button was removed because the provider is not
     *  configured in Supabase — the button existed and every click failed.
     *
     *  **Kept rather than deleted**, because this is the correct implementation and the reason it is
     *  unused is a dashboard setting rather than a code problem. Deleting it would mean rewriting it
     *  from scratch the day OAuth is turned on.
     *
     *  A function with no callers is normally a smell; this one is a documented pause.
     */
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

    /** Create an account with a password. Depending on the project's "Confirm email" setting this
     *  either signs you straight in or sends a confirmation mail — the caller is told which, because
     *  "nothing happened" is the worst possible outcome here. */
    async signUpWithPassword(email, password, { redirectTo, termsVersion } = {}) {
      try {
        // THE ACCEPTANCE TRAVELS IN SIGNUP METADATA, not through an RPC.
        //
        // With email confirmation on, `signUp` returns no session — so nothing can be written to
        // `profiles` until the user confirms and signs in, which may be days later or never. Recording
        // it then would timestamp the confirmation rather than the agreement. `my_profile()` copies
        // this across the first time it runs with a session.
        const data_ = termsVersion
          ? { terms_version: termsVersion, terms_accepted_at: new Date().toISOString() }
          : undefined;
        const { data, error } = await authClient.signUp({
          email: String(email || "").trim(),
          password,
          options: (redirectTo || data_)
            ? { ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
                ...(data_ ? { data: data_ } : {}) }
            : undefined,
        });
        if (error) return { ok: false, message: error.message };
        // A user with no session came back pending confirmation.
        return { ok: true, needsConfirmation: !data?.session };
      } catch (e) {
        return { ok: false, message: e?.message || "Could not create the account." };
      }
    },

    /** ⚠️ RESEND, BECAUSE "TRY AGAIN" MEANT RETYPING EVERYTHING. The confirm screen told people to
     *  check spam and then start over — and starting over on an address that already exists is a
     *  different, more confusing error. Supabase re-sends without creating a second account.
     */
    /** The terms version this person last accepted, or null. Read from the same user metadata
     *  `signUpWithPassword` writes, so there is one place the answer lives. */
    acceptedTermsVersion(user) {
      return user?.user_metadata?.terms_version ?? null;
    },

    /** ⚠️ RECORDS THE VERSION AND THE MOMENT, and never overwrites the ORIGINAL acceptance date.
     *  `terms_first_accepted_at` is kept because "when did they first agree to anything" and "which
     *  version are they on now" are different questions, and a re-acceptance flow that flattens them
     *  loses the first one permanently.
     */
    async acceptTerms(version) {
      try {
        const { data: got } = await authClient.getUser();
        const prev = got?.user?.user_metadata || {};
        const { error } = await authClient.updateUser({
          data: {
            ...prev,
            terms_version: version,
            terms_accepted_at: new Date().toISOString(),
            terms_first_accepted_at: prev.terms_first_accepted_at || prev.terms_accepted_at
              || new Date().toISOString(),
          },
        });
        return { ok: !error, error: error?.message || null };
      } catch (e) { return { ok: false, error: e?.message || "Could not record acceptance" }; }
    },

    async resendConfirmation(email, { redirectTo } = {}) {
      try {
        const { error } = await authClient.resend({
          type: "signup", email,
          options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
        });
        // A FAILURE HERE IS NOT WORTH BLOCKING ON. The first email may well have arrived; saying "we
        // could not resend" beside "check your spam folder" is two problems where there was one.
        return { ok: !error, error: error?.message || null };
      } catch (e) { return { ok: false, error: e?.message || "Could not resend" }; }
    },

    async signInWithPassword(email, password) {
      try {
        const { error } = await authClient.signInWithPassword({
          email: String(email || "").trim(), password,
        });
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || "Could not sign in." };
      }
    },

    /** Send a reset link. Needs working email — without SMTP this is the one flow that cannot work. */
    async sendPasswordReset(email, { redirectTo } = {}) {
      const clean = String(email || "").trim();
      if (!clean.includes("@")) return { ok: false, message: "Enter an email address." };
      try {
        const { error } = await authClient.resetPasswordForEmail(clean, redirectTo ? { redirectTo } : undefined);
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || "Could not send the reset link." };
      }
    },

    /** Set a new password for the signed-in (or recovering) user. */
    async updatePassword(password) {
      try {
        const { error } = await authClient.updateUser({ password });
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || "Could not set the password." };
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
