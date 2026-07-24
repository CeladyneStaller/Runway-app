import React, { useState } from "react";
import { headline, SUMMARY_ROWS } from "./docsummary";
import { toJSON } from "../../state/document";

// Offered once, when someone signs in on a browser that already holds a model and their account is
// empty. Signing in switches reads to the server, which makes a locally-built model INVISIBLE — not
// deleted, but invisible, and nothing else in the app would ever mention it again.
//
// Only shown when the account is genuinely new. If there is already a document on the server, offering
// to replace it with whatever happens to be in this browser is not a migration, it is a conflict — and
// the answer to a conflict is never a cheerful blue button.
//
// Declining is remembered. Asking once is help; asking on every load is nagging.

export function AdoptLocalDialog({ localDoc, onUpload, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const h = headline(localDoc);

  const upload = async () => {
    setError(null);
    setBusy(true);
    try {
      await onUpload(localDoc);
    } catch (e) {
      setError(e?.message || "Could not upload it. Nothing has been changed.");
      setBusy(false);
    }
  };

  const exportLocal = () => {
    const blob = new Blob([toJSON(localDoc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runway-this-browser-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cf-backdrop" role="dialog" aria-modal="true" aria-label="Model found on this device">
      <div className="cf-card">
        <h2>There's a model saved in this browser</h2>
        <p>
          You built this before signing in, and your account is currently empty. Upload it and it becomes
          your account's model, available on any device you sign in to.
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
          <button className="addbtn" disabled={busy} onClick={upload}>
            {busy ? "Uploading…" : "Upload it to my account"}
          </button>
          <button className="addbtn ghost" disabled={busy} onClick={onDismiss}>
            Start fresh instead
          </button>
        </div>

        <div className="cf-fine">
          Either way this browser's copy is left exactly where it is — nothing is deleted. You can also{" "}
          <button className="linkbtn" onClick={exportLocal}>download it as JSON</button> and import it later.
          Choosing "start fresh" won't ask again on this browser.
        </div>
      </div>
    </div>
  );
}
