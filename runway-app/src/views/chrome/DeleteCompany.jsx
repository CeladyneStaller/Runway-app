import React, { useState } from "react";
import { toJSON } from "../../state/document";

// Deleting a company. Typed confirmation rather than an "are you sure" — the friction is the point, and
// re-typing the name is the one gesture that cannot be performed by muscle memory on autopilot.
//
// The wording is careful about what this actually does. It removes the company, its model and every
// saved version; it does NOT remove your sign-in, because deleting an auth user needs the service key
// and therefore a server function that does not exist yet. Saying "account deleted" would be a lie, and
// a lie about deletion is the worst kind to tell.

export function DeleteCompany({ company, isActive, isLast, doc, onConfirm, onCancel }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const matches = typed.trim() === company.name.trim();

  const exportModel = () => {
    // The model on screen belongs to the ACTIVE company; there is nothing local to export for another.
    const blob = new Blob([toJSON(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runway-${company.name.replace(/[^\w-]+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const go = async () => {
    setError(null); setBusy(true);
    try { await onConfirm(); }
    catch (e) { setError(e?.message || "Could not delete it. Nothing has been changed."); setBusy(false); }
  };

  return (
    <div className="cf-backdrop" role="dialog" aria-modal="true" aria-label={`Delete ${company.name}`}>
      <div className="cf-card">
        <h2>Delete {company.name}</h2>
        <p>
          This removes the company, its model, and every saved version of it. It cannot be undone.
        </p>

        <div className="del-facts">
          <div><b>Stays:</b> your sign-in and any other company you belong to.</div>
          <div><b>Goes:</b> the model, its spend history, and its forecast journal.</div>
          {isLast && <div><b>Because this is your last company</b>, a new empty one will be created so
            you're not left with nowhere to work.</div>}
          {isActive && !isLast && <div><b>You're currently in this company</b>, so you'll be moved to
            another one.</div>}
        </div>

        {isActive && (
          <div className="cf-fine" style={{ borderLeft: "3px solid var(--caution)", paddingLeft: 10, margin: "12px 0" }}>
            Unsaved edits in this company are discarded rather than written first — they'd only be going
            into a row that is about to be removed.{" "}
            <button className="linkbtn" onClick={exportModel}>Export it first</button> if you might want it.
          </div>
        )}

        <div className="del-confirm">
          <label className="signin-label" htmlFor="del-name">
            Type <b className="num">{company.name}</b> to confirm
          </label>
          <input id="del-name" className="signin-input" value={typed} autoComplete="off"
                 onChange={(e) => setTyped(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && matches && !busy) go(); }} />
        </div>

        {error && <div className="cf-error" role="alert">{error}</div>}

        <div className="cf-actions">
          <button className="addbtn danger" disabled={!matches || busy} onClick={go}>
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
          <button className="addbtn ghost" disabled={busy} onClick={onCancel}>Keep it</button>
        </div>
      </div>
    </div>
  );
}
