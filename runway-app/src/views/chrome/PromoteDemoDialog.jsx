import React, { useState } from "react";
import { headline, SUMMARY_ROWS } from "./docsummary";

// Shown once, when somebody who asked to keep their demo arrives in a brand-new empty account.
//
// BOTH DOORS ARE ALWAYS OPEN, and that is the whole design. The demo starts as a FICTIONAL COMPANY —
// its employees, grants and purchase orders are invented — so promoting it wholesale can hand a paying
// customer a first model they have to spend an afternoon deleting. Equally, somebody who spent an hour
// replacing every number with their own would be furious to lose it. There is no reliable way to tell
// those two people apart from the document alone, so the app does not guess: it shows what would land,
// says plainly that the sample data comes with it, and lets them choose.
//
// Sibling of AdoptLocalDialog, which solves the neighbouring problem (a model stranded in IndexedDB
// from before sign-in). Same summary table, deliberately: what lands in the account should be described
// the same way whichever door it came through.

export function PromoteDemoDialog({ demoDoc, onPromote, onStartClean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const h = headline(demoDoc);

  const promote = async () => {
    setError(null);
    setBusy(true);
    try {
      await onPromote();
    } catch (e) {
      setError(e?.message || "Could not save it to your account. Nothing has been changed.");
      setBusy(false);
    }
  };

  return (
    <div className="cf-backdrop" role="dialog" aria-modal="true" aria-label="Keep your demo model">
      <div className="cf-card">
        <h2>Bring your demo into this account?</h2>
        <p>
          You asked to keep the model you were working on in the demo. Your account is empty, so it can
          become your real model — edits, projections and all.
        </p>

        <table className="cf-table">
          <tbody>
            {SUMMARY_ROWS.map(([label, key]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td className="num">{h ? h[key] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {error && <div className="cf-error" role="alert">{error}</div>}

        <div className="cf-actions">
          <button className="addbtn" disabled={busy} onClick={promote}>
            {busy ? "Saving…" : "Use this as my model"}
          </button>
          <button className="addbtn ghost" disabled={busy} onClick={onStartClean}>
            Start clean instead
          </button>
        </div>

        <div className="cf-fine">
          The demo began as a sample company, so anything you didn't change is still invented data —
          worth a look before you build on it. Choosing "start clean" gives you an empty model and
          discards the demo; either way this is asked only once.
        </div>
      </div>
    </div>
  );
}
