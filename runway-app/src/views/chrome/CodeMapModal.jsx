import React, { useState } from "react";
import { codesInLedger, OVERHEAD } from "../../engine/coding";
import { moneyFull } from "../../engine/money";
import { I } from "./icons";

// View and edit every cost-code -> project mapping. Distinct from the "Unmapped cost codes" panel on
// the ledger (which only prompts for codes seen in spend but not yet mapped) — this is the full table,
// including codes mapped to Overhead and codes pre-mapped before they appear in any transaction.
export function CodeMapModal({ codeMap, setCodeMap, hist, projects, onClose }) {
  const [newCode, setNewCode] = useState("");
  const [newDest, setNewDest] = useState("");

  const entries = Object.entries(codeMap || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const projName = (id) => id === OVERHEAD ? "Overhead (baseline)" : (projects.find(p => p.id === id)?.name || "— removed project —");
  const realProjects = projects.filter(p => !p.stage || p.stage !== "prospective");

  // total spend seen against a code, so a user recognises what they're mapping
  const codeTotal = (code) => (hist || []).reduce((a, m) =>
    a + (m.lines || []).filter(l => (l.code || "").trim() === code).reduce((b, l) => b + (Number(l.amount) || 0), 0), 0);

  const setDest = (code, dest) => setCodeMap(m => ({ ...m, [code]: dest }));
  const removeCode = (code) => setCodeMap(m => { const n = { ...m }; delete n[code]; return n; });
  const addMapping = () => {
    const c = newCode.trim();
    if (!c || !newDest) return;
    setCodeMap(m => ({ ...m, [c]: newDest }));
    setNewCode(""); setNewDest("");
  };

  // codes present in the ledger but not in the map — offered as quick suggestions in the add row
  const suggestions = codesInLedger(hist).filter(c => !(codeMap && codeMap[c]));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(620px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div><div className="modal-title">Cost code mappings</div><div className="modal-sub">Every code your books use, and the project its spend counts toward. Uncoded lines stay in the company baseline.</div></div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {entries.length > 0 ? (
            <table className="tbl">
              <thead><tr><th>Code</th><th style={{ textAlign: "right" }}>Spend seen</th><th>Maps to</th><th /></tr></thead>
              <tbody>{entries.map(([code, dest]) => (
                <tr key={code}>
                  <td className="num" style={{ fontWeight: 600 }}>{code}</td>
                  <td className="amt num" style={{ color: "var(--muted)" }}>{codeTotal(code) ? moneyFull(codeTotal(code)) : "—"}</td>
                  <td>
                    <select className="sel" value={dest} onChange={e => setDest(code, e.target.value)}>
                      <option value={OVERHEAD}>Overhead (baseline)</option>
                      {realProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      {/* keep a stale mapping visible rather than silently dropping it */}
                      {dest !== OVERHEAD && !realProjects.some(p => p.id === dest) && <option value={dest}>{projName(dest)}</option>}
                    </select>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="iconbtn" onClick={() => removeCode(code)} aria-label={`Remove mapping for ${code}`}>{I.trash}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          ) : (
            <div className="cm-empty">No mappings yet. Add one below, or map codes from the ledger as they appear in your spend.</div>
          )}

          <div className="cm-add">
            <div className="cm-add-h">Add a mapping</div>
            <div className="cm-add-row">
              <input className="inp" style={{ textAlign: "left", width: 130 }} list="cm-codes" placeholder="Code" value={newCode} onChange={e => setNewCode(e.target.value)} />
              <datalist id="cm-codes">{suggestions.map(c => <option key={c} value={c} />)}</datalist>
              <span className="cm-arrow">→</span>
              <select className="sel" value={newDest} onChange={e => setNewDest(e.target.value)}>
                <option value="" disabled>Choose project…</option>
                <option value={OVERHEAD}>Overhead (baseline)</option>
                {realProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="addbtn" disabled={!newCode.trim() || !newDest} onClick={addMapping}>{I.plus} Add</button>
            </div>
            {suggestions.length > 0 && (
              <div className="cm-sugg">Unmapped in your ledger: {suggestions.map(c => (
                <button key={c} className="cm-chip" onClick={() => setNewCode(c)}>{c}</button>
              ))}</div>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="addbtn ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
