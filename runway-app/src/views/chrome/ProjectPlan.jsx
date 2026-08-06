import { useState } from "react";
import { planRows, appendixERows, planGaps, addPlanEntry, updatePlanEntry,
         removePlanEntry, quarterOf, GATE_OUTCOMES } from "../../engine/plan";
import { monthLabel } from "../../engine/time";

/** The milestone table, entered in the order it will be filed.
 *
 *  THE LIST IS THE PREVIEW. No separate preview mode and no sorting control — a table somebody
 *  rearranges for reading is one they file in the wrong order the first time they export without
 *  looking.
 */
export function ProjectPlan({ project, setProject, startY, startM, canWrite = true }) {
  const [openId, setOpenId] = useState(null);
  const rows = planRows(project);
  const gaps = planGaps(project);
  const targets = rows.filter(e => e.kind !== "task");

  const add = (kind, parentId = null) => setProject(p => {
    const next = addPlanEntry(p, { kind, parentId });
    setOpenId(next.plan[next.plan.length - 1].id);
    return next;
  });
  const set = (id, patch) => setProject(p => updatePlanEntry(p, id, patch));

  if (!rows.length) {
    return (
      <section className="panel">
        <div className="panel-h"><div>
          <h3>Milestones and deliverables</h3>
          <p>The targets this project is judged on, and the work that reaches them. Exports as
             Appendix E.</p>
        </div></div>
        <p className="acct-row-s meta plan-empty">
          Nothing here yet. Most projects already have this table in the proposal — add the first
          milestone, then the tasks beneath it.
        </p>
        {canWrite && <div className="plan-add">
          <button className="linkbtn" onClick={() => add("milestone")}>+ Milestone</button>
          <button className="linkbtn" onClick={() => add("gate")}>+ Go/no-go</button>
        </div>}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <div><h3>Milestones and deliverables</h3>
          <p>Shown in the order it will be filed — each target followed by the tasks that reach it.</p></div>
        <span className="chip">{targets.length} target{targets.length === 1 ? "" : "s"} · {rows.length} rows</span>
      </div>

      {gaps.length > 0 && (
        /* REPORTED, NOT ENFORCED. Requiring these before a row can be saved would stop people
           recording the DATE, which is the part the model needs. */
        <p className="plan-gaps">
          {gaps.length} row{gaps.length === 1 ? "" : "s"} incomplete for the filed table —
          {" "}{gaps.slice(0, 3).map(g => g.number).join(", ")}{gaps.length > 3 ? "…" : ""}.
          They will export with the cells blank.
        </p>
      )}

      <div className="plan-rows">
        {rows.map(e => {
          const open = openId === e.id;
          const cls = "plan-r" + (e.kind === "task" ? " task" : e.kind === "gate" ? " gate" : " ms")
                    + (open ? " open" : "");
          return (
            <div key={e.id}>
              <div className={cls} onClick={() => setOpenId(open ? null : e.id)}
                   role="button" tabIndex={0}
                   onKeyDown={ev => ev.key === "Enter" && setOpenId(open ? null : e.id)}>
                <span className="pn">{e.number}</span>
                <span className="pt">{e.title || <i className="meta">untitled</i>}</span>
                <span className="py">
                  {e.kind === "task"
                    ? <span className="chip">task</span>
                    : <span className={"chip " + (e.kind === "gate" ? "gate" : "ms")}>
                        {e.kind === "gate" ? "go/no-go" : "milestone"} · {e.label}
                      </span>}
                </span>
                <span className="pm">mo {e.month}</span>
              </div>
              {open && <Editor entry={e} set={set} canWrite={canWrite}
                               startY={startY} startM={startM}
                               onAddSibling={() => add("task", e.kind === "task" ? e.parentId : e.id)}
                               onDelete={() => { setOpenId(null); setProject(p => removePlanEntry(p, e.id)); }} />}
              {e.kind !== "task" && canWrite && (
                <div className="plan-add sub">
                  {/* NAMES ITS PARENT. A bare "+ Task" in a list this shape adds to whichever target the
                      cursor last touched, which is how work lands under the wrong milestone. */}
                  <button className="linkbtn" onClick={() => add("task", e.id)}>
                    + Task under {e.number}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canWrite && <div className="plan-add">
        <button className="linkbtn" onClick={() => add("milestone")}>+ Milestone</button>
        <button className="linkbtn" onClick={() => add("gate")}>+ Go/no-go</button>
      </div>}
    </section>
  );
}

function Editor({ entry: e, set, canWrite, startY, startM, onAddSibling, onDelete }) {
  const at = monthLabel(startY, startM, e.month || 0);
  return (
    <div className={"plan-ed" + (e.kind === "gate" ? " gate" : "")}>
      <div className="plan-g3">
        <label className="fl">Title
          <input className="inp" value={e.title} disabled={!canWrite}
                 onChange={ev => set(e.id, { title: ev.target.value })} />
        </label>
        <label className="fl">Month from project start
          <input className="inp" type="number" value={e.month} disabled={!canWrite}
                 onChange={ev => set(e.id, { month: +ev.target.value || 0 })} />
          {/* BOTH FORMS. The month is what the agency asked for and what is stored; the date is the
              only form a person can sanity-check. */}
          <span className="plan-hint">→ {at} · {quarterOf(e.month)}</span>
        </label>
        {e.kind !== "task" && (
          <label className="fl">Number
            <input className="inp" value={e.label || ""} disabled={!canWrite}
                   onChange={ev => set(e.id, { label: ev.target.value })} />
            <span className="plan-hint">printed in the Milestone Number column</span>
          </label>
        )}
      </div>

      <label className="fl">{e.kind === "gate" ? "Decision criteria — what the agency will judge" : "Description"}
        <textarea className="inp ta" value={e.description} disabled={!canWrite}
                  onChange={ev => set(e.id, { description: ev.target.value })} />
      </label>

      {/* ONE FIELD, NOT FOUR. The form prints a single cell, so four inputs would mean joining them back
          and guessing the punctuation. The hint says what to cover. */}
      <label className="fl">Verification process
        <textarea className="inp ta" value={e.verification} disabled={!canWrite}
                  onChange={ev => set(e.id, { verification: ev.target.value })} />
        <span className="plan-hint">what · how · who · where — one cell in the filed table</span>
      </label>

      {e.kind === "gate" && (
        <label className="fl">If this fails, the award
          <select className="sel" value={e.outcome || ""} disabled={!canWrite}
                  onChange={ev => set(e.id, { outcome: ev.target.value || null })}>
            <option value="">— choose —</option>
            {GATE_OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="plan-hint">a term of the award, so there is no safe default</span>
        </label>
      )}

      {canWrite && (
        <div className="plan-acts">
          {/* TASKS ARRIVE IN GROUPS. Closing the editor and hunting for the right "+" between each one
              is the difference between entering eight and entering three and giving up. */}
          <button className="linkbtn" onClick={onAddSibling}>Add another task here</button>
          <button className="linkbtn danger" onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}

/** The filed table, for the export and the copy button. */
export function planToTable(project) {
  return appendixERows(project);
}
