// Asking again when the terms have changed.
//
// SHOWN ONLY WHEN `my_profile()` SAYS SO. The server compares the recorded version against
// `terms_current()` and returns `terms_required`; nothing here re-derives that, because a client-side
// comparison would need the current version hard-coded in two places and would disagree with the
// database the moment one of them shipped without the other.
//
// BLOCKING, AND DELIBERATELY SO. A banner people can dismiss forever produces a record that says
// somebody saw a notice, which is not the same as agreeing to anything — and if the record is not worth
// relying on there was no reason to collect it. What it does not do is take the model away: the two
// escapes are reading the terms and signing out.
import React, { useState } from "react";

export function TermsGate({ version, onAccept, onSignOut, site = "https://waterline-runway.com" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [agreed, setAgreed] = useState(false);

  if (!version) return null;

  const accept = async () => {
    setBusy(true); setError(null);
    try {
      await onAccept(version);
    } catch (e) {
      // A REFUSAL HERE IS USUALLY A STALE TAB. `accept_terms` rejects any version that is not current,
      // so a browser left open across a terms change sends the old one — and reloading is the fix,
      // which is worth saying rather than leaving somebody clicking a button that keeps failing.
      setError(/mismatch/i.test(e?.message || "")
        ? "These terms have changed again. Reload the page to see the current version."
        : (e?.message || "Could not record your agreement."));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay terms-gate" role="dialog" aria-modal="true"
         aria-labelledby="terms-gate-h">
      {/* NO onClick ON THE OVERLAY. Every other modal closes when you click outside it; this one must
          not, or the agreement is optional in practice while looking mandatory. */}
      <div className="modal" style={{ width: "min(520px,100%)" }}>
        <div className="modal-h"><h3 id="terms-gate-h">The terms have changed</h3></div>

        <div className="modal-b">
          <p className="acct-row-s">
            We have published a new version of our terms and privacy notice. Please read them and agree
            to carry on using Waterline.
          </p>

          <p className="acct-row-s">
            <a href={`${site}/terms/`} target="_blank" rel="noreferrer">Read the terms</a>
            {" · "}
            <a href={`${site}/privacy/`} target="_blank" rel="noreferrer">Read the privacy notice</a>
          </p>

          <label className="agree">
            <input type="checkbox" checked={agreed} disabled={busy}
                   onChange={e => setAgreed(e.target.checked)} />
            <span>I agree to the terms and the privacy notice.</span>
          </label>

          {error && <p className="acct-row-s acct-warn">{error}</p>}

          <p className="acct-row-s meta">
            {/* SAID PLAINLY. Somebody who does not want to agree should know their model is not being
                held — the alternative is a person who feels trapped, and that is a support request and
                a bad review rather than a decision. */}
            Your model is not affected by this and can still be exported. If you would rather not agree,
            sign out and write to us.
          </p>
        </div>

        <div className="modal-f">
          <button className="linkbtn" onClick={onSignOut} disabled={busy}>Sign out</button>
          <button className="addbtn" disabled={!agreed || busy} onClick={accept}>
            {busy ? "Saving…" : "Agree and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
