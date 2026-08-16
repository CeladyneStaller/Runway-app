import React, { useState } from "react";

// The published documents live on the marketing site, which is the version anybody could also have read
// before signing up. Linking to an in-app copy would create two texts to keep in step.
// `SITE` removed with the acceptance block — it existed only to link the two documents from here, and
// `TermsGate` links them where acceptance is now asked.
import { passwordRules, passwordScore } from "../engine/password";

// ONE component, two entry points: choosing a password while creating an account, and choosing a new one
// after following a reset link. The rules, the checklist and the confirm field are identical in both
// cases, so splitting them into two screens would mean two places for the same logic to be wrong.
//
// The checklist is the interface, not the strength bar. "Weak / medium / strong" tells someone they
// failed without telling them what to change; four rules that tick as you type tell them what to do.
// The bar is a summary OF the checklist and can never disagree with it, because it counts the same list.

export function SetPassword({
  mode = "create",              // "create" | "reset"
  email = "",
  busy = false,
  error = null,
  onSubmit,                     // (password) => void
  onCancel = null,
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);

  const rules = passwordRules(password, { email, confirm });
  const { passed, total } = passwordScore(password, { email, confirm });
  const resetting = mode === "reset";

  // AGREEMENT IS PART OF READINESS, so the same disabled button covers both. A separate validation
  // message for the checkbox would be a second way to be blocked, and people read neither.
  // ⚠️ THIS GATED THE SUBMIT BUTTON. Removing the checkbox without this line would have left the form
  // permanently unsubmittable on the account-creation path — `agreed` starts false and nothing could
  // ever set it. **Deleting a control means finding what depended on it, not only where it rendered.**
  const ready = rules.every(r => r.ok);

  const submit = () => { if (ready && !busy) onSubmit(password); };

  return (
    <div className="rw"><div className="splash signin">
      <span className="eyebrow">Startup runway</span>
      <h2>{resetting ? "Set a new password" : "Choose a password"}</h2>
      <p>
        {resetting
          ? "Pick a new one and you'll be signed straight in. Your model hasn't been touched."
          : "This protects your company's financial model. Make it one you don't use anywhere else."}
      </p>

      <label className="signin-label" htmlFor="pw-new">{resetting ? "New password" : "Password"}</label>
      <div className="pw-wrap">
        <input
          id="pw-new"
          className="signin-input"
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <button
          type="button"
          className="pw-reveal"
          aria-label={reveal ? "Hide password" : "Show password"}
          onClick={() => setReveal(r => !r)}
        >{reveal ? "Hide" : "Show"}</button>
      </div>

      <div className="pw-bar" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < passed ? "on" : ""} />
        ))}
      </div>

      <ul className="pw-rules">
        {rules.map(r => (
          <li key={r.id} className={r.ok ? "ok" : ""}>
            <span aria-hidden="true">{r.ok ? "✓" : "○"}</span>
            {r.label}
          </li>
        ))}
      </ul>

      <label className="signin-label" htmlFor="pw-confirm">Confirm password</label>
      <input
        id="pw-confirm"
        className="signin-input"
        type={reveal ? "text" : "password"}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />

      {error && <div className="signin-error" role="alert">{error}</div>}

      {/* ONLY WHEN CREATING AN ACCOUNT. Somebody resetting a password agreed a long time ago, and
          asking again would imply the reset was a new agreement. */}
      {!resetting && (
        {/* ⚠️ THE THIRD ACCEPTANCE CHECKBOX, REMOVED. Acceptance was asked on the email step, here on
            the password step, and again by `TermsGate` once the company exists — **three times, which is
            not three times the consent.** It is a person clicking past something they have already
            agreed to, and that is weaker evidence than asking once.
            `TermsGate` is the one that stays: it renders in the shell, so it covers every route into the
            app rather than one step of one flow. */}
      )}

      <button className="addbtn signin-go" disabled={!ready || busy} onClick={submit}>
        {busy ? "Saving…" : resetting ? "Set password and sign in" : "Create account"}
      </button>

      {onCancel && (
        <button className="linkbtn pw-cancel" onClick={onCancel} disabled={busy}>Back</button>
      )}
    </div></div>
  );
}
