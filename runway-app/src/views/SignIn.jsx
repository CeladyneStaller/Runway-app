import React, { useState } from "react";
import { TERMS_VERSION } from "../state/plans";
import { LegalModal } from "./chrome/LegalDoc";
import { siteOrigin, linkDestination } from "../state/siteurl";
import { SetPassword } from "./SetPassword";
import { track } from "../state/funnel";

// The landing screen for hosted mode. Local-first builds never reach it — there is nobody to be,
// because the document lives in this browser.
//
// SIGN-IN AND SIGN-UP ARE ONE SCREEN WITH AN EXPLICIT TOGGLE. The previous version conflated them and
// simply said "Sign in", which meant someone without an account had no way to know the screen was for
// them. A screen that works but looks like it does not is indistinguishable from one that does not.
//
// Password is the PRIMARY path and the magic link is secondary — the reverse of what security alone
// would suggest. Passwordless depends on email actually being deliverable, and a project without SMTP
// configured has no working link flow at all. Better to lead with the method that works and keep the
// better one visible for when it does.
//
// No <form> element: this codebase avoids them, so submission is an explicit click / Enter handler.

const CREATE = "create";
const SIGNIN = "signin";

export function SignIn({ session, onDemo, initialMode = CREATE, onBack, banner = null }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);   // { kind, email }
  const [resent, setResent] = useState(null);   // null | "busy" | "sent" | "failed"
  const [choosing, setChoosing] = useState(false);
  const [resetting, setResetting] = useState(false);

  // NOT window.location.origin any more. That sent the link back to whatever host you asked from —
  // so a link requested on a Vercel preview deployment returned to that preview, which sits behind
  // Vercel's Deployment Protection and answers with a Vercel login page instead of this app.
  const redirectTo = siteOrigin() || undefined;
  const dest = linkDestination();
  const creating = mode === CREATE;
  const [legal, setLegal] = useState(null);

  const run = async (key, fn) => {
    setError(null);
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r?.ok) setError(r?.message || "That didn't work.");
    return r;
  };

  // --- account creation: collect the email here, then hand off to the password screen ---------------
  if (choosing) return (
    <SetPassword
      mode="create"
      email={email}
      busy={busy === "signup"}
      error={error}
      onCancel={() => { setChoosing(false); setError(null); }}
      onSubmit={async (pw) => {
        // HERE, not on the "Get started" button. A click is curiosity — it costs nothing and tells you
        // nothing. A submitted email and password is an ATTEMPT, which makes signup_started ->
        // signup_completed a conversion worth reading: a gap between them means accounts are being
        // created and not reached, which is almost always the confirmation email.
        void track("signup_started");
        // The version the person actually saw beside the checkbox travels with the signup, so the
        // record names the document rather than "whatever was current when they confirmed".
        const r = await run("signup", () =>
          session.signUpWithPassword(email, pw, { redirectTo, termsVersion: TERMS_VERSION }));
        if (r?.ok) {
          setChoosing(false);
          // Told explicitly, because "nothing happened" is the worst outcome at this point: with email
          // confirmation on, the account exists but cannot be used until a link is opened.
          if (r.needsConfirmation) setNotice({ kind: "confirm", email });
        }
      }}
    />
  );

  if (notice?.kind === "link") return (
    <div className="rw"><div className="splash signin">
      <h2>Check your email</h2>
      <p>We sent a link to <b>{notice.email}</b>. Opening it on this device signs you in — and sets up
        your account if this is your first time.</p>
      {dest && (
        <p className="signin-fine">The link opens <b>{dest.host}</b>.
          {dest.ephemeral && <> That's a per-deployment preview address — if it asks you to log in to
            something that isn't this app, that's the host's own access protection, not your account.
            Set <code>VITE_SITE_URL</code> to the real domain to point links there instead.</>}</p>
      )}
      <p className="signin-fine">No link after a minute? Check your spam folder first — the
        confirmation comes from a no-reply address and lands there more often than it should.</p>
      {/* ⚠️ RESENDING IS NOT "TRY AGAIN". Signing up a second time on an address that already exists
          produces a different and more confusing error, so the screen that says "no link?" has to be
          the screen that can send another one. */}
      <div className="signin-resend">
        <button className="addbtn ghost" disabled={resent === "busy"}
                onClick={async () => {
                  setResent("busy");
                  const r = await session.resendConfirmation(notice.email, { redirectTo });
                  setResent(r.ok ? "sent" : "failed");
                }}>
          {resent === "busy" ? "Sending…" : resent === "sent" ? "Sent again" : "Resend the link"}
        </button>
        {resent === "sent" && (
          <span className="meta">Check the same inbox — the newest link is the one that works.</span>
        )}
        {resent === "failed" && (
          <span className="meta">We could not resend just now. The first one may still arrive.</span>
        )}
      </div>
      <button className="addbtn ghost" onClick={() => setNotice(null)}>Back</button>
    </div></div>
  );

  if (notice?.kind === "confirm") return (
    <div className="rw"><div className="splash signin">
      <h2>Confirm your email</h2>
      <p>Your account is created. Open the link we sent to <b>{notice.email}</b> to activate it, then
        come back and sign in.</p>
      {dest && (
        <p className="signin-fine">The link opens <b>{dest.host}</b>.
          {dest.ephemeral && <> That's a per-deployment preview address — if it asks you to log in to
            something that isn't this app, that's the host's own access protection, not your account.
            Set <code>VITE_SITE_URL</code> to the real domain to point links there instead.</>}</p>
      )}
      <p className="signin-fine">Nothing arrived? An owner can turn off email confirmation in the
        project's authentication settings, or configure a mail provider.</p>
      <button className="addbtn ghost" onClick={() => { setNotice(null); setMode(SIGNIN); }}>Go to sign in</button>
    </div></div>
  );

  if (notice?.kind === "reset") return (
    <div className="rw"><div className="splash signin">
      <h2>Check your email</h2>
      <p>We sent a reset link to <b>{notice.email}</b>. Opening it lets you choose a new password.</p>
      {dest && (
        <p className="signin-fine">The link opens <b>{dest.host}</b>.
          {dest.ephemeral && <> That's a per-deployment preview address — if it asks you to log in to
            something that isn't this app, that's the host's own access protection, not your account.
            Set <code>VITE_SITE_URL</code> to the real domain to point links there instead.</>}</p>
      )}

      <button className="addbtn ghost" onClick={() => { setNotice(null); setResetting(false); }}>Back</button>
    </div></div>
  );

  // --- forgotten password ---------------------------------------------------------------------------
  if (resetting) return (
    <div className="rw"><div className="splash signin">
      <span className="eyebrow">Startup runway</span>
      <h2>Reset your password</h2>
      <p>We'll email a link that lets you set a new one. Your model isn't affected.</p>
      <label className="signin-label" htmlFor="reset-email">Email</label>
      <input id="reset-email" className="signin-input" type="email" autoComplete="email"
             placeholder="name@company.com" value={email}
             onChange={(e) => setEmail(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Enter" && !busy) sendReset(); }} />
      {error && <div className="signin-error" role="alert">{error}</div>}
      <button className="addbtn signin-go" disabled={busy != null} onClick={sendReset}>
        {busy === "reset" ? "Sending…" : "Send reset link"}
      </button>
      <button className="linkbtn pw-cancel" onClick={() => { setResetting(false); setError(null); }}>Back</button>
    </div></div>
  );

  async function sendReset() {
    const r = await run("reset", () => session.sendPasswordReset(email, { redirectTo }));
    if (r?.ok) setNotice({ kind: "reset", email });
  }

  const primary = async () => {
    if (!email.includes("@")) { setError("Enter an email address."); return; }
    if (creating) { setError(null); setChoosing(true); return; }
    await run("signin", () => session.signInWithPassword(email, password));
  };

  const magicLink = async () => {
    if (!email.includes("@")) { setError("Enter an email address."); return; }
    const r = await run("link", () => session.signInWithEmail(email, { redirectTo }));
    if (r?.ok) setNotice({ kind: "link", email });
  };


  return (
    <div className="rw"><div className="splash signin">
      {/* WHY THEY ARE LOOKING AT A SIGN-IN FORM. Signing somebody out after they successfully set a
          password looks like a failure unless you say what happened — and the one thing they must not
          conclude is that the reset did not work. */}
      {banner && <p className="signin-note" role="status">{banner}</p>}
      <span className="eyebrow">Startup runway</span>
      <h2>Know your runway</h2>
      <p>Your model lives in your account, so it follows you between devices.</p>

      <div className="seg" role="tablist" aria-label="Sign in or create an account">
        <button role="tab" aria-selected={creating} className={"seg-b" + (creating ? " on" : "")}
                onClick={() => { setMode(CREATE); setError(null); }}>Create account</button>
        <button role="tab" aria-selected={!creating} className={"seg-b" + (!creating ? " on" : "")}
                onClick={() => { setMode(SIGNIN); setError(null); }}>Sign in</button>
      </div>

      <label className="signin-label" htmlFor="signin-email">Email</label>
      <input id="signin-email" className="signin-input" type="email" autoComplete="email"
             placeholder="name@company.com" value={email}
             onChange={(e) => setEmail(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Enter" && !busy) primary(); }} />

      {!creating && (<>
        <label className="signin-label" htmlFor="signin-password">Password</label>
        <input id="signin-password" className="signin-input" type="password" autoComplete="current-password"
               value={password} onChange={(e) => setPassword(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && !busy) primary(); }} />
      </>)}

      {error && <div className="signin-error" role="alert">{error}</div>}

      {/* ⚠️ THE CHECKBOX MOVED TO THE POST-CREATION MODAL, and it should never have been here.
          Acceptance was being asked THREE TIMES — on the email step, on the password step, and again in
          `TermsGate` after the company exists. **Asking three times is not three times the consent; it
          is a person clicking past a thing they have already agreed to**, which is worse evidence than
          asking once and meaning it.
          `termsVersion` still travels with the signup, so the record is written; `TermsGate` is where
          the person actually reads and accepts. */}
      <button className="addbtn signin-go" disabled={busy != null} onClick={primary}>
        {busy === "signin" ? "Signing in…" : creating ? "Continue" : "Sign in"}
      </button>

      {!creating && (
        <button className="linkbtn pw-cancel" onClick={() => { setResetting(true); setError(null); }}>
          Forgotten your password?
        </button>
      )}

      <div className="signin-or"><span>or</span></div>

      <button className="addbtn ghost signin-go" disabled={busy != null} onClick={magicLink}>
        {busy === "link" ? "Sending…" : "Email me a link instead"}
      </button>


      <p className="signin-fine" style={{ marginTop: 16 }}>
        {creating
          ? "Already have an account? Switch to Sign in above."
          : "New here? Switch to Create account above — there's no separate sign-up step."}
      </p>

      {/* The demo used to be offered HERE, at the bottom of the form, which is the last place a
          person who has not decided yet will look. It now sits on the landing screen as one of the two
          doors, so this is just the way back to that fork. `onDemo` is kept as a fallback for any
          caller that renders SignIn without a landing screen in front of it. */}
      {onBack
        ? <div className="signin-demo"><button className="linkbtn" onClick={onBack}>Back</button></div>
        : onDemo && (
          <div className="signin-demo">
            <button className="linkbtn" onClick={onDemo}>Look around with sample data first</button>
            <div className="signin-fine">No account needed. Nothing you do there is saved.</div>
          </div>
        )}
      {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
    </div></div>
  );
}
