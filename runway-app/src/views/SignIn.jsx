import React, { useState } from "react";
import { SetPassword } from "./SetPassword";

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

export function SignIn({ session }) {
  const [mode, setMode] = useState(CREATE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);   // { kind, email }
  const [choosing, setChoosing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
  const creating = mode === CREATE;

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
        const r = await run("signup", () => session.signUpWithPassword(email, pw, { redirectTo }));
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
      <p className="signin-fine">No link after a minute? Check spam, then try again — a fresh link invalidates the old one.</p>
      <button className="addbtn ghost" onClick={() => setNotice(null)}>Back</button>
    </div></div>
  );

  if (notice?.kind === "confirm") return (
    <div className="rw"><div className="splash signin">
      <h2>Confirm your email</h2>
      <p>Your account is created. Open the link we sent to <b>{notice.email}</b> to activate it, then
        come back and sign in.</p>
      <p className="signin-fine">Nothing arrived? An owner can turn off email confirmation in the
        project's authentication settings, or configure a mail provider.</p>
      <button className="addbtn ghost" onClick={() => { setNotice(null); setMode(SIGNIN); }}>Go to sign in</button>
    </div></div>
  );

  if (notice?.kind === "reset") return (
    <div className="rw"><div className="splash signin">
      <h2>Check your email</h2>
      <p>We sent a reset link to <b>{notice.email}</b>. Opening it lets you choose a new password.</p>
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

  const google = async () => {
    const r = await run("google", () => session.signInWithProvider("google", { redirectTo }));
    if (r?.ok) setBusy("google");   // the browser should be navigating away
  };

  return (
    <div className="rw"><div className="splash signin">
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
      <button className="addbtn ghost signin-go" disabled={busy != null} onClick={google}>
        {busy === "google" ? "Opening…" : "Continue with Google"}
      </button>

      <p className="signin-fine" style={{ marginTop: 16 }}>
        {creating
          ? "Already have an account? Switch to Sign in above."
          : "New here? Switch to Create account above — there's no separate sign-up step."}
      </p>
    </div></div>
  );
}
