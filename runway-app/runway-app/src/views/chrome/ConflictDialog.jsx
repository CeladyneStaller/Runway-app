import React, { useEffect, useState } from "react";
import { peekRemote, resolveConflict, pendingDoc } from "../../state/storage";
import { headline, SUMMARY_ROWS } from "./docsummary";
import { toJSON } from "../../state/document";

// Shown when the same document was changed somewhere else. The storage layer has already stopped and is
// holding this device's work, so nothing is lost while this is on screen — but it cannot decide which
// version somebody meant, and guessing is how you silently destroy the one they cared about.
//
// The comparison is the point. "There is a conflict, pick one" is unanswerable; four numbers people
// recognise — runway, cash, headcount, line items — make it a real choice. Anything that differs is
// highlighted, because the useful question is not "what are these documents" but "what changed".

export function ConflictDialog({ onAdopt, onDone }) {
  const [remote, setRemote] = useState(undefined);   // undefined = loading
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const mine = pendingDoc();

  useEffect(() => {
    let alive = true;
    peekRemote().then(d => { if (alive) setRemote(d); }).catch(() => { if (alive) setRemote(null); });
    return () => { alive = false; };
  }, []);

  const a = headline(mine);
  const b = headline(remote);

  const choose = async (choice) => {
    setError(null);
    setBusy(choice);
    try {
      const { adopted } = await resolveConflict(choice);
      if (adopted) onAdopt?.(adopted);
      onDone?.();
    } catch (e) {
      setError(e?.message || "Could not resolve that.");
      setBusy(null);
    }
  };

  const exportMine = () => {
    if (!mine) return;
    const blob = new Blob([toJSON(mine)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url;
    a2.download = `runway-this-device-${new Date().toISOString().slice(0, 10)}.json`;
    a2.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cf-backdrop" role="dialog" aria-modal="true" aria-label="This model was changed elsewhere">
      <div className="cf-card">
        <h2>This model was changed somewhere else</h2>
        <p>
          Your work on this device hasn't been saved over anything, and nothing here has been lost yet.
          Pick which version to keep going with.
        </p>

        {remote === undefined ? (
          <div className="cf-loading">Fetching the other version…</div>
        ) : (
          <table className="cf-table">
            <thead>
              <tr><th /><th>This device</th><th>Saved elsewhere</th></tr>
            </thead>
            <tbody>
              {SUMMARY_ROWS.map(([label, key]) => {
                const differs = a && b && String(a[key]) !== String(b[key]);
                return (
                  <tr key={key} className={differs ? "cf-differs" : ""}>
                    <th scope="row">{label}</th>
                    <td className="num">{a ? a[key] : "—"}</td>
                    <td className="num">{b ? b[key] : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {error && <div className="cf-error" role="alert">{error}</div>}

        <div className="cf-actions">
          <button className="addbtn" disabled={busy != null} onClick={() => choose("mine")}>
            {busy === "mine" ? "Saving…" : "Keep this device's version"}
          </button>
          <button className="addbtn ghost" disabled={busy != null} onClick={() => choose("theirs")}>
            {busy === "theirs" ? "Loading…" : "Use the other version"}
          </button>
        </div>

        <div className="cf-fine">
          Keeping this device's version files the other one into history, so it stays recoverable.
          Using the other version discards the unsaved edits on this device —{" "}
          <button className="linkbtn" onClick={exportMine}>export them first</button> if you might want them.
        </div>
      </div>
    </div>
  );
}
