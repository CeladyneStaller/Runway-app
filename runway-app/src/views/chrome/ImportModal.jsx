import React, { useMemo, useState } from "react";
import { fileToGrid, applyProfile, mergeImport } from "../../engine/importer";
import { unresolvedLines } from "../../engine/coding";
import { moneyFull } from "../../engine/money";
import { I } from "./icons";

// The fields the ledger understands. date + amount are required; the rest are optional.
const FIELDS = [
  ["date", "Date", true],
  ["amount", "Amount", true],
  ["customer", "Customer", false],
  ["code", "Cost code / class", false],
  ["category", "Object class", false],
  ["period", "Budget period", false],
  ["note", "Memo / note", false],
];
const DATE_FORMATS = [["MDY", "MM/DD/YYYY (US)"], ["DMY", "DD/MM/YYYY"], ["YMD", "YYYY-MM-DD (ISO)"]];
const AMOUNT_MODES = [
  ["signed", "Signed — positive is spend, negative is money in"],
  ["expensesPositive", "Expenses only — every row is spend"],
];

// Guess a column for a field by fuzzy header match, so the dropdowns start pre-filled sensibly.
const guess = (headers, needles) => headers.find(h => needles.some(n => h.toLowerCase().includes(n))) || "";

export function ImportModal({ startY, startM, hist, profiles = [], onCommit, onSaveProfile, onClose }) {
  const [grid, setGrid] = useState(null);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState(null);
  const [columns, setColumns] = useState({});
  const [dateFormat, setDateFormat] = useState("MDY");
  const [amountMode, setAmountMode] = useState("signed");
  const [profileName, setProfileName] = useState("");

  const onFile = async (file) => {
    if (!file) return;
    setErr(null); setFileName(file.name);
    try {
      const g = await fileToGrid(file);
      if (!g.headers.length) { setErr("No columns found in that file."); return; }
      setGrid(g);
      // pre-fill from a saved profile whose headers match, else guess
      const match = profiles.find(p => (p.headers || []).join("|") === g.headers.join("|"));
      if (match) {
        setColumns(match.columns); setDateFormat(match.dateFormat); setAmountMode(match.amountMode);
        setProfileName(match.name);
      } else {
        setColumns({
          date: guess(g.headers, ["date"]), amount: guess(g.headers, ["amount", "amt", "total"]),
          customer: guess(g.headers, ["customer", "client", "name"]),
          code: guess(g.headers, ["class", "code", "account"]),
          note: guess(g.headers, ["memo", "note", "description"]),
        });
      }
    } catch (e) { setErr("Couldn't read that file: " + (e.message || e)); }
  };

  const profile = { columns, dateFormat, amountMode };
  const rows = useMemo(() => grid ? applyProfile(grid, profile) : [], [grid, columns, dateFormat, amountMode]);
  const preview = useMemo(() => {
    if (!grid) return null;
    const { history, report } = mergeImport(hist, rows, startY, startM);
    const unresolved = unresolvedLines(history, { codeMap: {}, customerMap: {} }).length;
    return { report, unresolved, sampleMerged: history };
  }, [grid, rows, hist, startY, startM]);

  const canCommit = grid && columns.date && columns.amount && preview?.report.imported > 0;
  const commit = () => {
    const { history } = mergeImport(hist, rows, startY, startM);
    if (profileName.trim() && onSaveProfile) onSaveProfile({ name: profileName.trim(), headers: grid.headers, columns, dateFormat, amountMode });
    onCommit(history);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(720px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div><div className="modal-title">Import spend & revenue</div><div className="modal-sub">From a QuickBooks export, or any CSV/Excel with a date and an amount.</div></div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {!grid ? (
            <label className="dropzone">
              <input type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: "none" }}
                onChange={e => onFile(e.target.files?.[0])} />
              <div className="dz-icon">{I.plus}</div>
              <b>Choose a file</b>
              <span>CSV or Excel. A transaction-level export — one row per line, with a date and amount.</span>
            </label>
          ) : (
            <>
              <div className="imp-file"><span>{fileName}</span> · {grid.rows.length} rows · {grid.headers.length} columns
                <button className="linkbtn" onClick={() => { setGrid(null); setPreviewNull(); }}>Change file</button></div>

              <div className="imp-section">Map your columns</div>
              <div className="imp-map">
                {FIELDS.map(([field, label, req]) => (
                  <label key={field} className="imp-field">
                    <span>{label}{req && <b className="req"> *</b>}</span>
                    <select className="sel" value={columns[field] || ""} onChange={e => setColumns(c => ({ ...c, [field]: e.target.value }))}>
                      <option value="">{req ? "Choose…" : "— none —"}</option>
                      {grid.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="imp-opts">
                <label className="imp-field"><span>Date format</span>
                  <select className="sel" value={dateFormat} onChange={e => setDateFormat(e.target.value)}>
                    {DATE_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="imp-field"><span>Amounts</span>
                  <select className="sel" value={amountMode} onChange={e => setAmountMode(e.target.value)}>
                    {AMOUNT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>

              {columns.date && columns.amount && (
                <div className="imp-preview">
                  <div className="imp-section">Preview</div>
                  <table className="tbl compact">
                    <thead><tr><th>Date</th><th>Customer</th><th>Code</th><th style={{ textAlign: "right" }}>Amount</th><th>Kind</th></tr></thead>
                    <tbody>{rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td className="num" style={{ fontSize: 12 }}>{r.date ? r.date.toLocaleDateString() : <span style={{ color: "var(--danger)" }}>—</span>}</td>
                        <td style={{ fontSize: 12 }}>{r.customer || ""}</td>
                        <td className="num" style={{ fontSize: 12 }}>{r.code || ""}</td>
                        <td className="amt num">{Number.isFinite(r.amount) ? moneyFull(r.amount) : "—"}</td>
                        <td style={{ fontSize: 11.5, color: r.kind === "revenue" ? "var(--signal-ink)" : "var(--muted)" }}>{r.kind}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {preview && (
                    <div className="imp-report">
                      <b>{preview.report.imported}</b> rows import
                      {preview.report.beforeStart > 0 && <> · <span className="warn">{preview.report.beforeStart} before your start date</span></>}
                      {(preview.report.badDate + preview.report.badAmount) > 0 && <> · {preview.report.badDate + preview.report.badAmount} skipped (no date/amount)</>}
                      {preview.unresolved > 0 && <> · <span className="warn">{preview.unresolved} will need a project mapping</span></>}
                    </div>
                  )}
                  <label className="imp-save">
                    <span>Save this mapping as</span>
                    <input className="inp" style={{ textAlign: "left", width: 220 }} value={profileName} placeholder="e.g. QuickBooks — Transaction Detail" onChange={e => setProfileName(e.target.value)} />
                    <em>so the next import from this source skips these steps</em>
                  </label>
                </div>
              )}
            </>
          )}
          {err && <div className="imp-err">{err}</div>}
        </div>

        <div className="modal-foot">
          <button className="addbtn ghost" onClick={onClose}>Cancel</button>
          <button className="addbtn" disabled={!canCommit} onClick={commit}>{I.plus} Import {preview?.report.imported || 0} rows</button>
        </div>
      </div>
    </div>
  );

  function setPreviewNull() { setColumns({}); setFileName(""); setErr(null); }
}
