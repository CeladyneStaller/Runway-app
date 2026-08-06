import { useState } from "react";
import { planRows, appendixERows, planGaps, addPlanEntry, updatePlanEntry,
         removePlanEntry, moveToThrust, moveTask, reorderThrust, setPlanKind, deleteImpact, quarterOf, GATE_OUTCOMES } from "../../engine/plan";
import { monthLabel } from "../../engine/time";
import { PlanIOModal } from "./PlanIOModal";

/** The milestone table, entered in the order it will be filed.
 *
 *  THE LIST IS THE PREVIEW. No separate preview mode and no sorting control — a table somebody
 *  rearranges for reading is one they file in the wrong order the first time they export without
 *  looking.
 */
export function ProjectPlan({ project, setProject, startY, startM, canWrite = true }) {
  const [openId, setOpenId] = useState(null);
  const [io, setIo] = useState(false);
  // COLLAPSE STATE IS A SET OF WHAT IS SHUT, not of what is open. A new thrust arrives expanded, which
  // is what somebody who just created it expects — the opposite default would hide the thing they made.
  const [shut, setShut] = useState(() => new Set());
  const [panelShut, setPanelShut] = useState(false);
  const toggle = (id) => setShut(sh => {
    const n = new Set(sh); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const hiddenBy = (e) => {
    // A row is hidden if ANY ancestor is shut — a task under a collapsed milestone stays hidden even
    // when its thrust is open.
    if (e.kind === "thrust") return false;
    const all = project?.plan || [];
    let cur = e;
    while (cur?.parentId) {
      if (shut.has(cur.parentId)) return true;
      cur = all.find(x => x.id === cur.parentId);
    }
    return false;
  };

  const [drag, setDrag] = useState(null);        // id of the target being dragged
  const [over, setOver] = useState(null);        // thrust id it is over
  const rows = planRows(project);
  const gaps = planGaps(project);
  const targets = rows.filter(e => e.kind !== "task");

  const add = (kind, parentId = null) => setProject(p => {
    const next = addPlanEntry(p, { kind, parentId });
    setOpenId(next.plan[next.plan.length - 1].id);
    return next;
  });
  const set = (id, patch) => setProject(p => updatePlanEntry(p, id, patch));
  const [kindMsg, setKindMsg] = useState(null);
  const setKind = (id, kind) => setProject(p => {
    const { project: next, orphaned } = setPlanKind(p, id, kind);
    // ⚠️ SAY WHEN TASKS WERE CUT LOOSE. Nothing is refused and nothing is re-homed — but a dropdown
    // that quietly detaches three rows is how somebody loses work they then cannot find. They are at
    // the end of the list, and this says so.
    setKindMsg(orphaned
      ? `${orphaned} task${orphaned === 1 ? "" : "s"} left without a milestone — they are at the end of the list.`
      : null);
    return next;
  });

  // ONE ROUTE. The inline paste box and file button were replaced by a single trigger opening the same
  // modal the budget uses for SF-424A — two routes to one action is how somebody learns the app has two
  // importers, and then finds out it does not.
  const ioBtn = canWrite ? (
    <button className="iobtn" onClick={() => setIo(true)} title="Import / export the milestone table">
      ⇅ Import / export
    </button>
  ) : null;

  if (!rows.length) {
    return (
      <section className="panel">
        {/* THE TRIGGER BELONGS IN THE HEADER, in both states — it sat below the empty state's copy,
            which put it in a different place depending on whether the table had rows. SF-424A's is
            always top-right, and a control that moves is one people look for twice. */}
        <div className="panel-h">
          <div>
            <h3>Milestones and deliverables</h3>
            <p>The targets this project is judged on, and the work that reaches them. Exports as
               Appendix E.</p>
          </div>
          {ioBtn}
        </div>
        <p className="acct-row-s meta plan-empty">
          Nothing here yet. Most projects already have this table in the proposal — add the first
          milestone, then the tasks beneath it.
        </p>
        {canWrite && <div className="plan-add">
          <button className="linkbtn" onClick={() => add("thrust")}>+ Thrust</button>
          <button className="linkbtn" onClick={() => add("milestone")}>+ Milestone</button>
        </div>}
        {io && <PlanIOModal project={project} setProject={setProject} onClose={() => setIo(false)} />}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <div><h3>Milestones and deliverables</h3>
          <p>Shown in the order it will be filed — each target followed by the tasks that reach it.</p></div>
        <div className="plan-h-r">
          <span className="chip">{targets.length} target{targets.length === 1 ? "" : "s"} · {rows.length} rows</span>
          {ioBtn}
          {/* THE WHOLE PANEL COLLAPSES, but the trigger above stays — collapsing to get the table out
              of the way should not take the import/export control with it. */}
          <button className="fold-c panel-fold" aria-expanded={!panelShut}
                  aria-label={panelShut ? "Expand milestones" : "Collapse milestones"}
                  onClick={() => setPanelShut(v => !v)}>{panelShut ? "+" : "\u2212"}</button>
        </div>
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

      {!panelShut && <div className="plan-rows">
        {rows.filter(e => !hiddenBy(e)).map(e => {
          const open = openId === e.id;
          const foldable = e.kind === "thrust" || e.kind === "milestone";
          const isShut = shut.has(e.id);
          const inside = foldable
            ? (project?.plan || []).filter(x => x?.parentId === e.id).length : 0;
          // ⚠️ AN ORPHAN IS MARKED, not hidden. A task with no milestone still prints in the filed
          // table under whatever precedes it, so it has to be findable and obviously wrong.
          const orphan = e.kind === "task" && !(project?.plan || []).some(x => x.id === e.parentId);
          // EVERY ROW IS DRAGGABLE. A thrust has no parent to move into, but it has a POSITION — and
          // its position is its number, so reordering thrusts is a real operation rather than a
          // destination-less move.
          const canDrag = canWrite;

          // WHAT ACCEPTS A DROP DEPENDS ON WHAT IS BEING DRAGGED. A task goes into a milestone; a
          // milestone or gate goes into a thrust. Letting anything land anywhere would create shapes
          // the form cannot print — a task under a thrust has no number, and a milestone inside a
          // milestone has no meaning.
          const dragged = drag ? (project?.plan || []).find(x => x.id === drag) : null;
          // A task lands in a milestone; a milestone or gate lands in a thrust; a THRUST lands before
          // another thrust. Same rule as before with one more case — and still nothing lands somewhere
          // the form cannot print.
          const accepts = !!dragged && dragged.id !== e.id && (
            dragged.kind === "task" ? e.kind === "milestone" : e.kind === "thrust");
          const cls = "plan-r"
            + (e.kind === "task" ? " task" : e.kind === "gate" ? " gate"
               : e.kind === "thrust" ? " thrust" : " ms")
            + (open ? " open" : "")
            + (over === e.id && accepts ? " dropping" : "")
            + (orphan ? " orphan" : "");
          // ⚠️ ONLY A MILESTONE OR GATE IS DRAGGABLE. A task moves with its milestone and a thrust is
          // the destination — making everything draggable would let somebody drop a thrust into itself.
          return (
            <div key={e.id}>
              <div className={cls} onClick={() => setOpenId(open ? null : e.id)}
                   role="button" tabIndex={0}
                   draggable={canDrag}
                   onDragStart={canDrag ? (ev => { setDrag(e.id); ev.dataTransfer.effectAllowed = "move"; }) : undefined}
                   onDragEnd={() => { setDrag(null); setOver(null); }}
                   onDragOver={accepts ? (ev => { ev.preventDefault(); setOver(e.id); }) : undefined}
                   onDragLeave={accepts ? (() => setOver(null)) : undefined}
                   onDrop={accepts ? (ev => {
                     ev.preventDefault();
                     setProject(p2 => (
                       dragged.kind === "thrust" ? reorderThrust(p2, drag, e.id)
                       : dragged.kind === "task" ? moveTask(p2, drag, e.id)
                       : moveToThrust(p2, drag, e.id)));
                     setDrag(null); setOver(null);
                   }) : undefined}
                   onKeyDown={ev => ev.key === "Enter" && setOpenId(open ? null : e.id)}>
                {/* THE CARET IS PART OF THE NUMBER CELL, not a separate column — a column that is
                    empty on two of four row kinds reads as a missing control. */}
                <span className="pn">
                  {foldable && inside > 0 && (
                    <button className="fold-c" aria-expanded={!isShut}
                            aria-label={isShut ? "Expand" : "Collapse"}
                            onClick={ev => { ev.stopPropagation(); toggle(e.id); }}>
                      {isShut ? "+" : "\u2212"}
                    </button>
                  )}
                  {e.kind === "thrust" ? `TASK ${e.number}` : (e.number || "\u2014")}
                </span>
                <span className="pt">{e.title || <i className="meta">untitled</i>}</span>
                <span className="py">
                  {e.kind === "thrust"
                    ? <span className="chip th">thrust</span>
                    : e.kind === "task"
                    ? <span className={"chip" + (orphan ? " warn" : "")}>
                        {orphan ? "no milestone" : "task"}
                      </span>
                    : <span className={"chip " + (e.kind === "gate" ? "gate" : "ms")}>
                        {e.kind === "gate" ? "go/no-go" : "milestone"} · {e.label}
                      </span>}
                </span>
                {/* A THRUST'S DATES ARE DERIVED — the span of what sits inside it. Letting somebody
                    type one creates a fourth place for a date to live, and the form has no cell. */}
                <span className="pm">
                  {/* A SHUT ROW SAYS WHAT IT IS HIDING. A caret with nothing beside it is a control
                      people learn not to open. */}
                  {isShut && inside > 0 && <em className="pn-hid">{inside} hidden · </em>}
                  {e.kind === "thrust" ? spanOf(project, e) : `mo ${e.month}`}
                </span>
              </div>
              {open && <Editor entry={e} set={set} setKind={setKind} kindMsg={kindMsg} canWrite={canWrite}
                               impact={deleteImpact(project, e.id)}
                               startY={startY} startM={startM}
                               onAddSibling={() => add("task", e.kind === "task" ? e.parentId : e.id)}
                               onDelete={() => { setOpenId(null); setProject(p => removePlanEntry(p, e.id)); }} />}
              {e.kind === "thrust" && canWrite && !isShut && (
                <div className="plan-add sub">
                  <button className="linkbtn" onClick={() => add("milestone", e.id)}>
                    + Milestone in TASK {e.number}
                  </button>
                  <button className="linkbtn" onClick={() => add("gate", e.id)}>
                    + Go/no-go for TASK {e.number}
                  </button>
                </div>
              )}
              {(e.kind === "milestone" || e.kind === "gate") && canWrite && !isShut && (
                <div className="plan-add sub deep">
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
      </div>}

      {canWrite && !panelShut && <div className="plan-add">
        <button className="linkbtn" onClick={() => add("thrust")}>+ Thrust</button>
        <button className="linkbtn" onClick={() => add("milestone")}>+ Milestone</button>
      </div>}
      {io && <PlanIOModal project={project} setProject={setProject} onClose={() => setIo(false)} />}
    </section>
  );
}

function Editor({ entry: e, set, setKind, kindMsg, canWrite, impact = { total: 0 },
                  startY, startM, onAddSibling, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const at = monthLabel(startY, startM, e.month || 0);
  return (
    <div className={"plan-ed" + (e.kind === "gate" ? " gate" : "") + (e.kind === "task" ? " notarget" : "")}>
      <>
        <label className="fl">Type
          {/* THE ONE CONTROL THAT MOVES THE ROW. Everything else here edits a cell. */}
          <select className="sel" value={e.kind} disabled={!canWrite}
                  onChange={ev => setKind(e.id, ev.target.value)}>
            <option value="thrust">Thrust (TASK n)</option>
            <option value="milestone">Milestone</option>
            <option value="gate">Go/No-Go</option>
            <option value="task">Task</option>
          </select>
        </label>
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
      </>

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

      {kindMsg && <p className="plan-kindmsg">{kindMsg}</p>}
      {canWrite && (
        <div className="plan-acts">
          {/* TASKS ARRIVE IN GROUPS. Closing the editor and hunting for the right "+" between each one
              is the difference between entering eight and entering three and giving up. */}
          <button className="linkbtn" onClick={onAddSibling}>Add another task here</button>

          {/* ⚠️ CONFIRM ONLY WHEN SOMETHING ELSE GOES WITH IT. A thrust or milestone takes its whole
              subtree; a task takes only itself. Asking on every delete teaches people to click through
              the question, and then they click through it on the thrust. */}
          {!confirming ? (
            <button className="linkbtn danger"
                    onClick={() => (impact.total > 0 ? setConfirming(true) : onDelete())}>
              Delete
            </button>
          ) : (
            <span className="plan-confirm">
              {/* COUNTED, NOT VAGUE. "Are you sure?" is a question somebody can answer wrongly. */}
              <b>Delete this {e.kind === "thrust" ? "thrust" : e.kind}?</b> It will also remove{" "}
              {[impact.milestones && `${impact.milestones} milestone${impact.milestones === 1 ? "" : "s"}`,
                impact.gates && `${impact.gates} go/no-go`,
                impact.tasks && `${impact.tasks} task${impact.tasks === 1 ? "" : "s"}`]
                .filter(Boolean).join(", ")}.
              <button className="linkbtn danger" onClick={onDelete}>Delete anyway</button>
              <button className="linkbtn" onClick={() => setConfirming(false)}>Keep</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The filed table, for the export and the copy button. */
export function planToTable(project) {
  return appendixERows(project);
}

/** The months a thrust spans, from what sits inside it. Derived, never entered. */
function spanOf(project, thrust) {
  const kids = (project?.plan || []).filter(e => e?.parentId === thrust.id);
  const months = kids.map(k => k.month).filter(Number.isFinite);
  if (!months.length) return "\u2014";
  const lo = Math.min(...months), hi = Math.max(...months);
  return lo === hi ? `mo ${lo}` : `mo ${lo}\u2013${hi}`;
}
