// ── The project plan: milestones, go/no-go gates, and the tasks that reach them ───────────────────
//
// ONE FLAT LIST, ONE VOCABULARY. `kind` is "milestone" | "gate" | "task"; a task carries `parentId`.
// The alternative — milestones owning a nested `tasks[]` — reads better in a mockup and is worse here,
// because the FILED TABLE is flat: one row per entry, in a fixed order, and every reordering,
// renumbering and export walk would have to flatten it first.
//
// ⚠️ THE NAMING IS GENUINELY CONFUSING AND THAT IS THE FORM'S FAULT. On Appendix E a milestone occupies
// a TASK row — column 1 is "Task Number or Subtask Number" — and the work beneath it occupies SUBTASK
// rows which are typed "Task". So `kind: "milestone"` prints in the task-number column, and
// `kind: "task"` prints in the subtask-number column. Storing the form's words would mean a field
// called `task` that is sometimes a milestone; storing ours and translating once, at export, keeps
// every other file honest.

const clean = (n) => (Number.isFinite(+n) ? +n : 0);

export const PLAN_KINDS = [
  // ⚠️ A THRUST PRINTS AS "TASK 1" WITH EVERY OTHER CELL EMPTY. It has no type of its own in the filed
  // table — the template writes only its number and title — so it maps to an empty Type cell.
  ["thrust", ""],
  ["milestone", "Milestone"],
  ["gate", "Go/No-Go Decision Point"],
  ["task", "Task"],
];

/** What a failed gate does to the award. No default is honest, so the field is required at entry. */
export const GATE_OUTCOMES = [
  ["stop", "stops entirely"],
  ["reduce", "continues at a reduced scope"],
  ["pause", "pauses pending remediation"],
];

const isTarget = (e) => e && (e.kind === "milestone" || e.kind === "gate");
const isThrust = (e) => e && e.kind === "thrust";

/** The entries of a project, in the order the filed table prints them.
 *
 *  TARGET FIRST, THEN ITS TASKS. Sorting by month would interleave the tasks of one milestone with
 *  another's, which is not the shape the agency asked for — and a table somebody rearranges for reading
 *  is one they file in the wrong order the first time they export without looking.
 */
export function planRows(project) {
  const all = project?.plan || [];
  const out = [];

  const tasksOf = (t) => all.filter(e => e?.kind === "task" && e.parentId === t.id);
  const targetsOf = (parentId) => all.filter(e => isTarget(e) && (e.parentId ?? null) === parentId);

  const pushTarget = (t) => { out.push(t); for (const k of tasksOf(t)) out.push(k); };

  for (const th of all.filter(isThrust)) {
    out.push(th);
    const inside = targetsOf(th.id);
    // ⚠️ THE GATE RENDERS LAST WITHIN ITS THRUST, whatever its month. That is where the template puts
    // it and what it means — the decision on this block of work, taken when the block is done. Sorting
    // it by date would scatter it among the milestones it judges.
    for (const t of inside.filter(e => e.kind !== "gate")) pushTarget(t);
    for (const t of inside.filter(e => e.kind === "gate")) pushTarget(t);
  }

  // LOOSE TARGETS — those with no thrust — follow. A plan written before thrusts existed is valid and
  // renders exactly as it did; adding a thrust does not adopt them.
  for (const t of targetsOf(null)) pushTarget(t);

  // Orphans last rather than dropped: a task whose parent was deleted is still work somebody entered.
  const placed = new Set(out.map(e => e.id));
  for (const e of all) if (!placed.has(e.id)) out.push(e);
  return out;
}

/** Assign the next number at the right depth.
 *
 *  NUMBERS ARE ASSIGNED, NEVER TYPED. They are what an agency cites, and typed numbers collide. A new
 *  target continues the target sequence; a task continues its own parent's.
 */
export function nextNumber(project, kind, parentId = null) {
  const all = project?.plan || [];

  // A THRUST IS NUMBERED 1, 2, 3 — printed as "TASK 1".
  if (kind === "thrust") {
    const used = all.filter(isThrust).map(e => +String(e.number || "").replace(/\D/g, "") || 0);
    return String((used.length ? Math.max(...used) : 0) + 1);
  }

  // A GATE HAS NO NUMBER, by the form's own convention.
  if (kind === "gate") return "";

  if (kind === "milestone") {
    const th = all.find(e => e?.id === parentId && isThrust(e));
    const g = th ? String(th.number) : "1";
    const sibs = all.filter(e => e?.kind === "milestone" && (e.parentId ?? null) === (th ? th.id : null))
                    .map(e => +String(e.number || "").split(".")[1] || 0);
    return `${g}.${(sibs.length ? Math.max(...sibs) : 0) + 1}`;
  }

  const parent = all.find(e => e?.id === parentId);
  if (!parent || !parent.number) return "1.1.1";
  const kids = all.filter(e => e?.kind === "task" && e.parentId === parentId)
                  .map(e => +String(e.number || "").split(".")[2] || 0);
  return `${parent.number}.${(kids.length ? Math.max(...kids) : 0) + 1}`;
}

/** Move a target into a thrust, or out of one.
 *
 *  ⚠️ IT RENUMBERS THE MOVED TARGET AND ITS TASKS, because the number encodes the thrust — a milestone
 *  1.2 dragged into thrust 3 that stayed 1.2 would be a lie in a filed document. The tasks follow so
 *  1.2.1 becomes 3.1.1.
 *
 *  Everything it LEAVES BEHIND keeps its number. The delete rule applies here for the same reason:
 *  those numbers may already be in a document somebody sent.
 */
export function moveToThrust(project, targetId, thrustId) {
  const all = project?.plan || [];
  const t = all.find(e => e?.id === targetId);
  if (!t || !isTarget(t)) return project;
  const moved = { ...t, parentId: thrustId || null };
  const num = t.kind === "gate" ? "" : nextNumber({ plan: all.filter(e => e.id !== t.id) },
                                                  "milestone", thrustId || null);
  let i = 0;
  return {
    ...project,
    plan: all.map(e => {
      if (e.id === targetId) return { ...moved, number: num };
      if (e.kind === "task" && e.parentId === targetId) { i += 1; return { ...e, number: `${num}.${i}` }; }
      return e;
    }),
  };
}

/** Quarters from the start of the project, as the form asks for them.
 *
 *  MONTH 0 IS Q1, not Q0. The form counts quarters of the project the way people count them aloud —
 *  the first three months are the first quarter — and an off-by-one here is printed in a filed table.
 */
export const quarterOf = (month) => `Q${Math.floor(clean(month) / 3) + 1}`;

/** Add an entry. Returns the new project. */
export function addPlanEntry(project, { kind = "task", parentId = null, ...rest } = {}) {
  const id = `pl_${Math.random().toString(36).slice(2, 9)}`;
  const entry = {
    id, kind,
    // A TASK POINTS AT ITS MILESTONE; A MILESTONE OR GATE POINTS AT ITS THRUST. Only a thrust has no
    // parent — it is the top of the tree.
    parentId: kind === "thrust" ? null : (parentId || null),
    number: nextNumber(project, kind, parentId),
    // The milestone number an agency cites — M1.1, G1. Tasks have none and the form prints a dash.
    label: (kind === "task" || kind === "thrust") ? null : (rest.label || autoLabel(project, kind)),
    title: rest.title || "",
    description: rest.description || "",
    verification: rest.verification || "",
    month: clean(rest.month),
    // Gates only. NO DEFAULT: what a failed gate does to an award is a term of that award, and
    // guessing "stops entirely" would put a cliff in the projection nobody agreed to.
    outcome: kind === "gate" ? (rest.outcome || null) : null,
    status: "not-started",
  };
  return { ...project, plan: [...(project?.plan || []), entry] };
}

function autoLabel(project, kind) {
  const pre = kind === "gate" ? "G" : "M";
  const n = (project?.plan || []).filter(e => e?.kind === kind).length + 1;
  return kind === "gate" ? `${pre}${n}` : `${pre}${n}`;
}

export function updatePlanEntry(project, id, patch) {
  return { ...project, plan: (project?.plan || []).map(e => (e?.id === id ? { ...e, ...patch } : e)) };
}

/** Remove an entry and, for a target, its tasks.
 *
 *  ⚠️ SIBLINGS ARE NOT RENUMBERED. Tempting and wrong: the numbers are in a filed document, so a
 *  deleted 1.2 leaves a gap and the gap is correct.
 */
export function removePlanEntry(project, id) {
  const all = project?.plan || [];
  const gone = new Set([id, ...all.filter(e => e?.parentId === id).map(e => e.id)]);
  return { ...project, plan: all.filter(e => !gone.has(e.id)) };
}

/** The filed table, one object per printed row. Nothing is invented here. */
export function appendixERows(project) {
  return planRows(project).map(e => ({
    // A THRUST PRINTS "TASK 1" in the number column and leaves everything after the title empty.
    taskNumber: e.kind === "thrust" ? `TASK ${e.number}` : e.number,
    title: e.title,
    type: (PLAN_KINDS.find(k => k[0] === e.kind) || [])[1] ?? "Task",
    milestoneNumber: e.kind === "thrust" ? ""
                     : e.kind === "task" ? "\u2014" : (e.label || ""),
    description: e.kind === "thrust" ? "" : e.description,
    verification: e.kind === "thrust" ? "" : e.verification,
    month: e.kind === "thrust" ? "" : String(clean(e.month)),
    quarter: e.kind === "thrust" ? "" : quarterOf(e.month),
    isTask: e.kind === "task",
    isGate: e.kind === "gate",
    isThrust: e.kind === "thrust",
  }));
}

/** Everything the form requires and does not have yet.
 *
 *  REPORTED, NEVER ENFORCED. Requiring verification text before an entry can be saved would stop people
 *  recording the DATE, which is the part the model needs — so the gaps are listed and the row saves.
 */
export function planGaps(project) {
  const gaps = [];
  for (const e of planRows(project)) {
    // A THRUST IS A HEADING. The form gives it a number and a title and no other cell, so requiring a
    // date or a verification process would report a gap that cannot be filled.
    if (e.kind === "thrust") { if (!e.title) gaps.push({ id: e.id, number: e.number, missing: ["title"] }); continue; }
    const miss = [];
    if (!e.title) miss.push("title");
    if (!e.description) miss.push("description");
    if (!e.verification) miss.push("verification");
    if (!Number.isFinite(+e.month)) miss.push("month");
    if (e.kind === "gate" && !e.outcome) miss.push("what a failure does to the award");
    if (miss.length) gaps.push({ id: e.id, number: e.number, missing: miss });
  }
  return gaps;
}
