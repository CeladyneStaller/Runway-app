import { useState, useMemo } from "react";
import { planToTSV, parsePlanPaste, draftsToPlan, planCollisions, renumberIncoming } from "../../engine/planio";
import { quarterOf } from "../../engine/plan";

// ⚠️ THRUST WAS MISSING FROM THIS LIST. The parser reads "TASK 1" rows as thrusts, but the review's
// type dropdown could not express one — so a row read wrongly could not be corrected TO a thrust, and a
// thrust misread as a milestone could not be corrected either. The review is the last chance to fix
// what gets filed; a level it cannot name is a level it cannot fix.
const KINDS = [["thrust", "Thrust (TASK n)"], ["milestone", "Milestone"],
               ["gate", "Go/No-Go"], ["task", "Task"]];

/** Import / export for the milestone table.
 *
 *  THE SAME SHAPE AS THE SF-424A MODAL — trigger, header, Export section, Import section, footer —
 *  with ONE deliberate divergence: import offers ADD as well as REPLACE.
 *
 *  ⚠️ THE BUDGET'S IMPORT REPLACES EVERYTHING AND HAS NO UNDO. That is survivable for a budget, which
 *  is one screen of numbers somebody can retype. A milestone table can be an afternoon of typing, and
 *  a single "Import" over the top of it is one keystroke. The divergence goes where the risk is rather
 *  than everywhere for consistency's sake, and both buttons name their OUTCOME — "Add 14 rows",
 *  "Replace all 11" — so nobody has to remember which importer they are in.
 */
export function PlanIOModal({ project, setProject, onClose }) {
  const [text, setText] = useState(null);          // null = nothing loaded yet
  const [drafts, setDrafts] = useState(null);      // the editable review
  const [fileName, setFileName] = useState(null);
  const [err, setErr] = useState(null);
  const [choice, setChoice] = useState({});        // per-row collision decision

  const existing = project?.plan || [];
  const collisions = useMemo(() => (drafts ? planCollisions(project, drafts) : {}), [project, drafts]);
  const nCollide = Object.keys(collisions).length;
  const nFlagged = drafts ? drafts.filter(d => d.notes?.length).length : 0;

  const load = (raw, name = null) => {
    const p = parsePlanPaste(raw);
    setFileName(name);
    if (p.error) { setErr(p.error); setText(raw); setDrafts(null); return; }
    setErr(null); setText(raw); setDrafts(p.rows); setChoice({});
  };

  const setCell = (i, patch) =>
    setDrafts(ds => ds.map(d => (d.i === i ? { ...d, ...patch } : d)));

  const commit = (mode) => {
    const taken = new Set(mode === "replace" ? [] : existing.map(e => String(e.number || "").trim()));
    const kept = drafts.filter(d => choice[d.i] !== "skip");
    const prepared = kept.map(d => {
      // "Keep both" renumbers the INCOMING row. "Overwrite mine" keeps the number and the existing row
      // is dropped below.
      const c = choice[d.i] || "both";
      if (mode === "add" && collisions[d.i] && c === "both") {
        const n = renumberIncoming(taken, d.number);
        taken.add(n);
        return { ...d, number: n };
      }
      if (d.number) taken.add(String(d.number).trim());
      return d;
    });
    const fresh = draftsToPlan(prepared);
    const overwritten = new Set(kept.filter(d => choice[d.i] === "over" && collisions[d.i])
                                    .map(d => collisions[d.i].existing.id));
    setProject(p => ({
      ...p,
      plan: mode === "replace" ? fresh
                               : [...existing.filter(e => !overwritten.has(e.id)), ...fresh],
    }));
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={"modal" + (drafts ? " modal-wide" : "")} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <div className="modal-title">Milestone table · import / export</div>
            <div className="modal-sub">{project?.name || "Project"} · SOPO Milestone Summary Table</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {!drafts && (
            <>
              {/* EXPORT FIRST. It is the safe action and import overwrites, so the destructive one sits
                  further down the reading order — the same order as SF-424A. */}
              <div className="modal-sec">Export</div>
              <div className="brow">
                <button className="addbtn ghost" disabled={!existing.length}
                        onClick={async () => {
                          const XLSX = await import("xlsx");
                          const { exportPlanWorkbook } = await import("../../engine/planio");
                          XLSX.writeFile(exportPlanWorkbook(XLSX, project),
                            `${(project?.name || "project").replace(/[^\w -]/g, "")} milestones.xlsx`);
                        }}>SOPO workbook (.xlsx)</button>
                <button className="addbtn ghost" disabled={!existing.length}
                        onClick={() => navigator.clipboard?.writeText?.(planToTSV(project))}>
                  Copy as a table</button>
              </div>

              <div className="modal-sec">Import</div>
              <div className="brow">
                <label className="addbtn ghost filebtn">Choose file
                  <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                         onChange={async ev => {
                           const f = ev.target.files?.[0]; if (!f) return;
                           try {
                             const XLSX = await import("xlsx");
                             const { sheetToText } = await import("../../engine/planio");
                             const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
                             // A FAILED READ DROPS ITS CONTENTS INTO THE BOX rather than showing an
                             // error alone — seeing that the file was obviously a budget turns "it did
                             // not work" into "wrong file".
                             load(sheetToText(XLSX, wb) || "", f.name);
                           } catch { setErr("That file could not be read."); }
                           ev.target.value = "";
                         }} />
                </label>
                <span className="meta">or paste below</span>
              </div>
              {err && <p className="plan-gaps">{fileName ? `${fileName} — ` : ""}{err}</p>}
              <textarea className="inp io-ta" value={text || ""} onChange={e => setText(e.target.value)}
                        placeholder="Paste the milestone table from your proposal or award. Columns are matched by name, so the order does not matter and extra columns are ignored." />
              <div className="brow" style={{ marginTop: 8 }}>
                <button className="addbtn ghost" disabled={!text?.trim()}
                        onClick={() => load(text)}>Review {text?.trim() ? "" : ""}</button>
              </div>
            </>
          )}

          {drafts && (
            <>
              <div className="modal-sec">Import · review and edit</div>
              <p className="io-ok">
                {fileName ? <b>{fileName} — </b> : null}{drafts.length} rows read
                {nFlagged > 0 && <> · <b>{nFlagged} need a look</b>, shaded below</>}
                {nCollide > 0 && <> · <b>{nCollide} numbers already exist</b></>}
              </p>

              <div className="io-gridwrap">
                <table className="io-grid">
                  <thead><tr>
                    <th>Task №</th><th>Title</th><th>Type</th><th>M №</th>
                    <th>Description</th><th>Verification</th><th>Month</th><th>Qtr</th>
                    {nCollide > 0 && <th>Clash</th>}<th />
                  </tr></thead>
                  <tbody>
                    {drafts.map(d => {
                      const note = (f) => (d.notes || []).find(n => n.includes(f));
                      const dateNote = note("month") || note("date") || note("quarter");
                      return (
                        <tr key={d.i} className={
                          d.kind === "thrust" ? "thrust" : d.kind === "gate" ? "gate"
                          : d.kind === "task" ? "task" : ""}>
                          <td><input className="ci num" value={d.number}
                                     onChange={e => setCell(d.i, { number: e.target.value })} /></td>
                          <td><input className={"ci" + (note("title") ? " flag" : "")} value={d.title}
                                     onChange={e => setCell(d.i, { title: e.target.value })} /></td>
                          <td><select className="cs" value={d.kind}
                                      onChange={e => setCell(d.i, { kind: e.target.value })}>
                            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select></td>
                          {/* A THRUST CARRIES ONLY A NUMBER AND A TITLE. Leaving these editable would
                              let somebody type a description into a cell the export drops, which is
                              worse than showing nothing — they would believe it was saved. */}
                          <td>{d.kind === "thrust" ? <span className="ci derived">—</span>
                            : <input className="ci num" value={d.label || ""}
                                     onChange={e => setCell(d.i, { label: e.target.value })} />}</td>
                          <td>{d.kind === "thrust" ? <span className="ci derived">—</span>
                            : <textarea className="ci" rows={2} value={d.description}
                                        onChange={e => setCell(d.i, { description: e.target.value })} />}</td>
                          <td>{d.kind === "thrust" ? <span className="ci derived">—</span>
                            : <textarea className="ci" rows={2} value={d.verification}
                                        onChange={e => setCell(d.i, { verification: e.target.value })} />}</td>
                          <td>
                            {d.kind === "thrust" ? <span className="ci derived">—</span> :
                            <input className={"ci num" + (dateNote ? " flag" : "")}
                                   value={Number.isFinite(d.month) ? d.month : ""} placeholder="—"
                                   onChange={e => setCell(d.i, {
                                     month: e.target.value === "" ? null : (+e.target.value || 0) })} />}
                            {dateNote && d.kind !== "thrust" && <span className="flagnote">{dateNote}</span>}
                          </td>
                          {/* DERIVED, NOT EDITABLE. Two editable date columns is two places for a date
                              to live and disagree, and the form's quarter is a function of its month. */}
                          <td><span className="ci derived">
                            {d.kind !== "thrust" && Number.isFinite(d.month) ? quarterOf(d.month) : "—"}</span></td>
                          {nCollide > 0 && (
                            <td>{collisions[d.i] ? (
                              <select className="cs" value={choice[d.i] || "both"}
                                      onChange={e => setChoice(c => ({ ...c, [d.i]: e.target.value }))}>
                                <option value="both">Keep both</option>
                                <option value="skip">Skip incoming</option>
                                <option value="over">Overwrite mine</option>
                              </select>
                            ) : <span className="meta">—</span>}</td>
                          )}
                          {/* A ROW CAN BE DROPPED HERE AND NOWHERE ELSE. Importing something unwanted
                              and deleting it afterwards leaves a numbering gap the app will not close. */}
                          <td><button className="io-rx" title="Drop this row"
                                      onClick={() => setDrafts(ds => ds.filter(x => x.i !== d.i))}>×</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="meta">
            {drafts
              ? `${existing.length} rows already in this table${nFlagged ? ` · ${nFlagged} flagged` : ""}`
              : ".xlsx · .xls · .csv"}
          </span>
          <div className="brow">
            <button className="addbtn ghost" onClick={drafts ? () => setDrafts(null) : onClose}>
              {drafts ? "Back" : "Close"}
            </button>
            {drafts && existing.length > 0 && (
              <button className="addbtn ghost danger" onClick={() => commit("replace")}>
                Replace all {existing.length}
              </button>
            )}
            {drafts && (
              <button className="addbtn" disabled={!drafts.length} onClick={() => commit("add")}>
                {existing.length ? `Add ${drafts.length} rows` : `Import ${drafts.length} rows`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
