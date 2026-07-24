import React, { useState } from "react";

// Shown only in hosted mode, and only when there is no session. Local-first builds never reach this —
// there is nobody to be, because the document lives in this browser.
//
// THIS IS SIGN-UP AS WELL AS SIGN-IN. The magic link creates the account if there isn't one, and so does
// Google. That was already true and the screen never said so, which is a worse failure than a missing
// feature: someone with no account reads "Sign in", assumes it is not for them, and leaves. A screen
// that works but looks like it does not is indistinguishable from one that does not work.
//
// Deliberately plain. This is the first thing a user sees, and the failure that matters is not an ugly
// button, it is somebody staring at a screen that will not tell them what went wrong. Every error the
// SDK returns is surfaced verbatim rather than flattened into "something went wrong".
//
// No <form> element: this codebase avoids them, so submission is an explicit click / Enter handler.

export function SignIn({ session, onSignedIn }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(null);       // "email" | "google" | null
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;

  const sendLink = async () => {
    setError(null);
    setBusy("email");
    const r = await session.signInWithEmail(email, { redirectTo });
    setBusy(null);
    if (r.ok) { setSent(true); onSignedIn?.(); }
    else setError(r.message);
  };

  const google = async () => {
    setError(null);
    setBusy("google");
    const r = await session.signInWithProvider("google", { redirectTo });
    // On success the browser navigates away, so reaching here at all usually means it did not.
    setBusy(null);
    if (!r.ok) setError(r.message);
  };

  if (sent) return (
    <div className="rw"><div className="splash signin">
      <h2>Check your email</h2>
      <p>We sent a link to <b>{email}</b>. Opening it on this device signs you in — and sets up your
        account if this is your first time.</p>
      <p className="signin-fine">No link after a minute? Check spam, then try again — a fresh link invalidates the old one.</p>
      <button className="addbtn ghost" onClick={() => { setSent(false); setError(null); }}>Use a different email</button>
    </div></div>
  );

  return (
    <div className="rw"><div className="splash signin">
      <span className="eyebrow">Startup runway</span>
      <h2>Sign in or create an account</h2>
      <p>
        No password, and no separate sign-up step — enter your email and we'll send a link. If you don't
        have an account yet, opening it creates one. Your model is stored against that account, so it
        follows you between devices.
      </p>

      <label className="signin-label" htmlFor="signin-email">Email</label>
      <input
        id="signin-email"
        className="signin-input"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) sendLink(); }}
      />
      <button className="addbtn signin-go" disabled={busy != null} onClick={sendLink}>
        {busy === "email" ? "Sending\u2026" : "Email me a link"}
      </button>

      <div className="signin-or"><span>or</span></div>

      <button className="addbtn ghost signin-go" disabled={busy != null} onClick={google}>
        {busy === "google" ? "Opening\u2026" : "Continue with Google"}
      </button>

      {error && (
        <div className="signin-error" role="alert">
          {error}
          {/* The one provider error whose wording explains nothing to the person reading it. */}
          {/signup|not allowed|disabled/i.test(error) && (
            <div className="signin-fine" style={{ marginTop: 6 }}>
              New accounts are turned off for this project. An owner can enable them under
              Authentication → Sign In / Providers in Supabase.
            </div>
          )}
        </div>
      )}

      <p className="signin-fine" style={{ marginTop: 16 }}>
        First time here? There's nothing else to do — the link above is how accounts get made.
      </p>
    </div></div>
  );
}
