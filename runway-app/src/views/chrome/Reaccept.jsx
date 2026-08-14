import { useState } from "react";
import { LEGAL_VERSION, LEGAL_EFFECTIVE, DOCS } from "../../legal";
import { LegalModal } from "./LegalDoc";

/** Asked once, on the next sign-in, when the terms somebody accepted are no longer the terms in force.
 *
 *  ⚠️ THIS IS NOT A NAG SCREEN. It exists because every account created before the checkbox carries a
 *  `terms_accepted_at` for terms that were never shown or linked — **a record asserting something that
 *  did not happen.** One screen converts that into a true one.
 *
 *  ⚠️ AND IT IS NOT DISMISSIBLE, because a dismissed prompt leaves the false record in place while
 *  looking like it was dealt with. There is a way out — sign out — and it is offered plainly.
 */
export function Reaccept({ email, onAccept, onSignOut }) {
  const [ticked, setTicked] = useState(false);
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-scrim">
      <div className="modal-card" role="dialog" aria-label="Accept the current terms">
        <div className="modal-h">
          <span className="modal-t">Our terms have been published</span>
          <span className="meta">Version {LEGAL_VERSION}</span>
        </div>
        <div className="modal-b">
          <p className="reac-p">
            {/* ⚠️ SAYS WHAT ACTUALLY HAPPENED. "We have updated our terms" would be the usual wording
                and it would be false — these are the first published versions, and the earlier record
                was made against documents that were not available to read. Somebody who notices the
                difference should find us honest about it rather than smooth. */}
            Waterline&rsquo;s Terms of Service and Privacy Policy are now published in full. Your
            account predates that, so we would like you to read them and confirm.
          </p>
          <p className="reac-p meta">Effective {LEGAL_EFFECTIVE} · {email}</p>
          <label className="signin-terms reac-check">
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            <span>
              I have read and accept the{" "}
              <button type="button" className="linkbtn" onClick={() => setDoc("terms")}>
                {DOCS.terms.title}</button>{" "}and{" "}
              <button type="button" className="linkbtn" onClick={() => setDoc("privacy")}>
                {DOCS.privacy.title}</button>.
            </span>
          </label>
        </div>
        <div className="modal-f">
          {/* NOT "CANCEL". Declining is signing out, and saying so is more honest than a button that
              looks like it postpones something it cannot postpone. */}
          <button className="linkbtn" onClick={onSignOut}>Sign out instead</button>
          <button className="addbtn" disabled={!ticked || busy}
                  onClick={async () => { setBusy(true); await onAccept(LEGAL_VERSION); }}>
            {busy ? "Saving…" : "Accept and continue"}
          </button>
        </div>
      </div>
      {doc && <LegalModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}
