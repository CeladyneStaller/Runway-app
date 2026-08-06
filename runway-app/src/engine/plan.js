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

/** The entries of a project, in the order the filed table prints them.
 *
 *  TARGET FIRST, THEN ITS TASKS. Sorting by month would interleave the tasks of one milestone with
 *  another's, which is not the shape the agency asked for — and a table somebody rearranges for reading
 *  is one they file in the wrong order the first time they export without looking.
 */
export function planRows(project) {
  const all = project?.plan || [];
  const targets = all.filter(isTarget);
  const out = [];
  for (const t of targets) {
    out.push(t);
    for (const e of all) if (e?.kind === "task" && e.parentId === t.id) out.push(e);
  }
  // Orphans last rather than dropped: a task whose parent was deleted is still work somebody entered,
  // and losing it silently is worse than showing it needs re-homing.
  for (const e of all) if (e?.kind === "task" && !targets.some(t => t.id === e.parentId)) out.push(e);
  return out;
}

/** Assign the next number at the right depth.
 *
 *  NUMBERS ARE ASSIGNED, NEVER TYPED. They are what an agency cites, and typed numbers collide. A new
 *  target continues the target sequence; a task continues its own parent's.
 */
export function nextNumber(project, kind, parentId = null) {
  const all = project?.plan || [];
  if (kind !== "task") {
    const used = all.filter(isTarget).map(e => String(e.number || ""));
    // Group by the leading integer so 1.1, 1.2 sit under task group 1.
    const groups = used.map(n => +String(n).split(".")[0]).filter(Number.isFinite);
    const g = groups.length ? Math.max(...groups) : 1;
    const within = used.filter(n => +String(n).split(".")[0] === g)
                       .map(n => +String(n).split(".")[1] || 0);
    return `${g}.${(within.length ? Math.max(...within) : 0) + 1}`;
  }
  const parent = all.find(e => e?.id === parentId);
  if (!parent) return "1.1.1";
  const kids = all.filter(e => e?.kind === "task" && e.parentId === parentId)
                  .map(e => +String(e.number || "").split(".")[2] || 0);
  return `${parent.number}.${(kids.length ? Math.max(...kids) : 0) + 1}`;
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
    parentId: kind === "task" ? parentId : null,
    number: nextNumber(project, kind, parentId),
    // The milestone number an agency cites — M1.1, G1. Tasks have none and the form prints a dash.
    label: kind === "task" ? null : (rest.label || autoLabel(project, kind)),
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
    taskNumber: e.number,
    title: e.title,
    type: (PLAN_KINDS.find(k => k[0] === e.kind) || [])[1] || "Task",
    milestoneNumber: e.kind === "task" ? "\u2014" : (e.label || ""),
    description: e.description,
    verification: e.verification,
    month: String(clean(e.month)),
    quarter: quarterOf(e.month),
    isTask: e.kind === "task",
    isGate: e.kind === "gate",
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
