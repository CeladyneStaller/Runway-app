import { describe, it, expect } from "vitest";
import { addPlanEntry, updatePlanEntry, removePlanEntry, planRows, nextNumber,
         quarterOf, appendixERows, planGaps, moveToThrust, moveTask, setPlanKind, deleteImpact, reorderThrust } from "../../src/engine/plan.js";

const P = () => ({ id: "pr1", name: "Catalyst scale-up", plan: [] });
const withPlan = () => {
  let p = P();
  p = addPlanEntry(p, { kind: "milestone", title: "Baseline membrane", month: 6 });
  const m1 = p.plan[0].id;
  p = addPlanEntry(p, { kind: "task", parentId: m1, title: "Formulation screening", month: 3 });
  p = addPlanEntry(p, { kind: "task", parentId: m1, title: "Coupon fabrication", month: 5 });
  p = addPlanEntry(p, { kind: "milestone", title: "Pilot line commissioned", month: 11 });
  const m2 = p.plan[3].id;
  p = addPlanEntry(p, { kind: "task", parentId: m2, title: "Vendor selection", month: 7 });
  p = addPlanEntry(p, { kind: "gate", title: "5 kW stack at 92%", month: 14, outcome: "stop" });
  return p;
};

describe("numbering", () => {
  it("ASSIGNS, never accepts a typed number", () => {
    // Numbers are what an agency cites, and typed numbers collide.
    const p = withPlan();
    // ⚠️ THE GATE HAS NO NUMBER NOW. The template gives go/no-go rows a blank number cell — I had them
    // sharing the milestone sequence, which put a number in a filed cell the form leaves empty.
    expect(p.plan.map(e => e.number)).toEqual(["1.1", "1.1.1", "1.1.2", "1.2", "1.2.1", ""]);
  });

  it("a task continues its own parent's sequence", () => {
    const p = withPlan();
    expect(nextNumber(p, "task", p.plan[0].id)).toBe("1.1.3");
    expect(nextNumber(p, "task", p.plan[3].id)).toBe("1.2.2");
  });

  it("A GATE IS NOT NUMBERED AT ALL", () => {
    // I had gates sharing the milestone sequence on the reasoning that both occupy a task row. The real
    // template leaves the cell blank — the gate belongs to its THRUST and is identified by position.
    expect(nextNumber(withPlan(), "gate")).toBe("");
  });

  it("labels count within their own kind", () => {
    const p = withPlan();
    expect(p.plan.filter(e => e.kind === "milestone").map(e => e.label)).toEqual(["M1", "M2"]);
    expect(p.plan.find(e => e.kind === "gate").label).toBe("G1");
  });

  it("DELETING DOES NOT RENUMBER SIBLINGS", () => {
    // The numbers are in a filed document. A deleted 1.1 leaves a gap, and the gap is correct.
    const p = withPlan();
    const after = removePlanEntry(p, p.plan[0].id);
    expect(after.plan.map(e => e.number)).toEqual(["1.2", "1.2.1", ""]);
  });

  it("deleting a target takes its tasks with it", () => {
    const p = withPlan();
    expect(removePlanEntry(p, p.plan[0].id).plan.some(e => e.title === "Formulation screening")).toBe(false);
  });
});

describe("order", () => {
  it("IS TARGET FIRST, THEN ITS TASKS — not by date", () => {
    // Sorting by month would interleave one milestone's tasks with another's, which is not the shape
    // the agency asked for. Task 1.1.1 is month 3 and still prints after its month-6 milestone.
    // And the gate still lands last, now because it is a gate rather than because of its date.
    expect(planRows(withPlan()).map(e => e.number))
      .toEqual(["1.1", "1.1.1", "1.1.2", "1.2", "1.2.1", ""]);
  });

  it("keeps an orphaned task rather than dropping it", () => {
    // A task whose parent was deleted is still work somebody entered.
    const p = withPlan();
    const orphaned = { ...p, plan: p.plan.filter(e => e.number !== "1.1") };
    expect(planRows(orphaned).map(e => e.number)).toContain("1.1.1");
  });
});

describe("quarters", () => {
  it("MONTH 0 IS Q1, not Q0", () => {
    // The form counts quarters the way people count them aloud, and an off-by-one here is printed in a
    // filed table.
    expect(quarterOf(0)).toBe("Q1");
    expect(quarterOf(2)).toBe("Q1");
    expect(quarterOf(3)).toBe("Q2");
    expect(quarterOf(14)).toBe("Q5");
    expect(quarterOf(36)).toBe("Q13");
  });
});

describe("the filed table", () => {
  const rows = appendixERows(withPlan());

  it("prints a milestone in the task-number column", () => {
    // THE MILESTONE NUMBER IS ITS OWN NUMBER now, not the internal M-label. The task number and the
    // milestone number are the same thing on this form.
    expect(rows[0]).toMatchObject({ taskNumber: "1.1", type: "Milestone", milestoneNumber: "1.1" });
  });

  it("A TASK CITES THE MILESTONE IT SERVES", () => {
    // It used to print an em dash, on the reasoning that a task has no milestone number of its own.
    // Citing its PARENT is better: the column then says which target each row serves.
    expect(rows[1]).toMatchObject({ taskNumber: "1.1.1", type: "Task", milestoneNumber: "1.1" });
  });

  it("names the gate type as the form does", () => {
    expect(rows[5].type).toBe("Go/No-Go Decision Point");
    expect(rows[5].isGate).toBe(true);
  });

  it("derives the quarter rather than storing it", () => {
    expect(rows[0].quarter).toBe("Q3");     // month 6
    expect(rows[5].quarter).toBe("Q5");     // month 14
  });
});

describe("gaps are reported, never enforced", () => {
  it("lists what the form still needs", () => {
    // Requiring verification before a row can be saved would stop people recording the DATE, which is
    // the part the model needs.
    const gaps = planGaps(withPlan());
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].missing).toContain("description");
  });

  it("A GATE WITH NO OUTCOME IS A GAP", () => {
    // What a failed gate does to an award is a term of that award. Defaulting to "stops entirely" would
    // put a cliff in the projection nobody agreed to.
    let p = P();
    p = addPlanEntry(p, { kind: "gate", title: "G", month: 4 });
    expect(planGaps(p)[0].missing).toContain("what a failure does to the award");
  });

  it("a complete entry reports nothing", () => {
    let p = P();
    p = addPlanEntry(p, { kind: "milestone", title: "T", month: 4,
                          description: "d", verification: "v" });
    expect(planGaps(p)).toEqual([]);
  });
});

describe("editing", () => {
  it("updates in place", () => {
    const p = withPlan();
    const after = updatePlanEntry(p, p.plan[0].id, { month: 8 });
    expect(after.plan[0].month).toBe(8);
    expect(after.plan.length).toBe(p.plan.length);
  });

  it("a gate carries no parent", () => {
    expect(withPlan().plan.find(e => e.kind === "gate").parentId).toBeNull();
  });
});

describe("thrusts — the level above milestones", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "Catalyst development" });
    const t1 = p.plan[0].id;
    p = addPlanEntry(p, { kind: "milestone", parentId: t1, title: "3 A/cm2", month: 6 });
    const m1 = p.plan[1].id;
    p = addPlanEntry(p, { kind: "task", parentId: m1, title: "Ink dev", month: 2 });
    p = addPlanEntry(p, { kind: "gate", parentId: t1, title: "Review", month: 12 });
    p = addPlanEntry(p, { kind: "milestone", parentId: t1, title: "Full CCM", month: 10 });
    p = addPlanEntry(p, { kind: "thrust", title: "Stack integration" });
    return p;
  };

  it("NUMBERS FALL OUT OF THE TREE", () => {
    const p = built();
    expect(p.plan.map(e => `${e.kind}:${e.number}`)).toEqual([
      "thrust:1", "milestone:1.1", "task:1.1.1", "gate:", "milestone:1.2", "thrust:2",
    ]);
  });

  it("A GATE HAS NO NUMBER, by the form's own convention", () => {
    expect(built().plan.find(e => e.kind === "gate").number).toBe("");
  });

  it("THE GATE RENDERS LAST IN ITS THRUST, whatever its month", () => {
    // That is where the template puts it and what it means — the decision on this block of work.
    // Sorting it by date (month 12, after the month-10 milestone anyway) would scatter it among the
    // milestones it judges the moment somebody moved a date.
    const order = planRows(built()).map(e => `${e.kind}${e.number ? ":" + e.number : ""}`);
    expect(order).toEqual([
      "thrust:1", "milestone:1.1", "task:1.1.1", "milestone:1.2", "gate", "thrust:2",
    ]);
  });

  it("LOOSE MILESTONES SURVIVE AND ARE NOT ADOPTED", () => {
    // A plan written before thrusts existed is valid and renders as it did. Adding a thrust must not
    // silently swallow work somebody entered under a different mental model.
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "milestone", title: "Loose", month: 3 });
    p = addPlanEntry(p, { kind: "thrust", title: "New thrust" });
    const rows = planRows(p);
    expect(rows.map(e => e.kind)).toEqual(["thrust", "milestone"]);
    expect(rows.find(e => e.kind === "milestone").parentId).toBeNull();
  });

  it("MOVING A MILESTONE RENUMBERS IT AND ITS TASKS", () => {
    // The number encodes the thrust. A milestone 1.2 dragged into thrust 3 that stayed 1.2 would be a
    // lie in a filed document.
    const p = built();
    const th2 = p.plan.find(e => e.kind === "thrust" && e.number === "2").id;
    const m1 = p.plan.find(e => e.number === "1.1").id;
    const after = moveToThrust(p, m1, th2);
    expect(after.plan.find(e => e.id === m1).number).toBe("2.1");
    expect(after.plan.find(e => e.kind === "task").number).toBe("2.1.1");
  });

  it("and what it leaves behind keeps its number", () => {
    // The delete rule applies here for the same reason: those numbers may already be in a filed
    // document.
    const p = built();
    const th2 = p.plan.find(e => e.number === "2").id;
    const after = moveToThrust(p, p.plan.find(e => e.number === "1.1").id, th2);
    expect(after.plan.find(e => e.title === "Full CCM").number).toBe("1.2");
  });

  it("moving OUT of a thrust is allowed", () => {
    const p = built();
    const after = moveToThrust(p, p.plan.find(e => e.number === "1.1").id, null);
    expect(after.plan.find(e => e.title === "3 A/cm2").parentId).toBeNull();
  });

  it("a thrust prints as TASK n with every other cell empty", () => {
    const r = appendixERows(built())[0];
    expect(r).toMatchObject({ taskNumber: "TASK 1", type: "", milestoneNumber: "",
                              description: "", month: "", quarter: "" });
    expect(r.isThrust).toBe(true);
  });

  it("A THRUST IS NEVER A GAP for a missing date", () => {
    // The form gives it a number and a title and no other cell, so requiring a date would report a gap
    // that cannot be filled.
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "Named" });
    expect(planGaps(p)).toEqual([]);
  });
});

describe("changing an entry's kind", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "B", month: 3 });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M2", month: 9 });
    return p;
  };
  const id = (p, t) => p.plan.find(e => e.title === t).id;

  it("A TASK BECOMING A MILESTONE PARENTS TO ITS THRUST and renumbers", () => {
    // The kind decides what an entry's parent may be and what its number means, so changing it moves
    // the row in the tree — it is not a field edit.
    const p = built();
    const { project } = setPlanKind(p, id(p, "A"), "milestone");
    const a = project.plan.find(e => e.title === "A");
    expect(a.parentId).toBe(id(p, "T1"));
    expect(a.number).toBe("1.3");
  });

  it("A MILESTONE BECOMING A TASK ORPHANS ITS TASKS WITH IT", () => {
    // Not re-homed to a milestone nobody picked. An earlier version guessed a parent and refused the
    // change when it could not find one — both were the app making a structural decision on somebody's
    // behalf, silently, in a document they file. An orphan is visible and one drag from correct; a
    // wrong parent is invisible and prints.
    const p = built();
    const { project, orphaned } = setPlanKind(p, id(p, "M"), "task");
    expect(orphaned).toBe(2);
    expect(project.plan.find(e => e.title === "M").parentId).toBeNull();
    expect(project.plan.find(e => e.title === "A").parentId).toBeNull();
    expect(project.plan.find(e => e.title === "B").parentId).toBeNull();
  });

  it("THE ONLY MILESTONE CAN STILL BECOME A TASK — nothing is refused", () => {
    // The refusal was the same mistake as the guess: the app deciding structure for somebody. It
    // becomes an orphan, which the list shows at the end.
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "Only", month: 1 });
    const { project } = setPlanKind(p, id(p, "Only"), "task");
    expect(project.plan.find(e => e.title === "Only").kind).toBe("task");
    expect(project.plan.find(e => e.title === "Only").parentId).toBeNull();
  });

  it("BECOMING A GATE LOSES THE NUMBER, because the form leaves that cell blank", () => {
    const p = built();
    const { project } = setPlanKind(p, id(p, "M2"), "gate");
    const g = project.plan.find(e => e.title === "M2");
    expect(g.kind).toBe("gate");
    expect(g.number).toBe("");
    expect(g.parentId).toBe(id(p, "T1"));
  });

  it("becoming a thrust loses its parent — a thrust is the top of the tree", () => {
    const p = built();
    const { project } = setPlanKind(p, id(p, "M2"), "thrust");
    const t = project.plan.find(e => e.title === "M2");
    expect(t.parentId).toBeNull();
    expect(t.number).toBe("2");
  });

  it("keeps its tasks when it stays a milestone-like parent", () => {
    const p = built();
    const { project, orphaned } = setPlanKind(p, id(p, "M"), "milestone");
    expect(orphaned).toBe(0);
    expect(project.plan).toEqual(p.plan);        // no change at all
  });
});

describe("moving a task", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M1", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M2", month: 9 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[3].id, title: "B", month: 8 });
    return p;
  };
  const id = (p, t) => p.plan.find(e => e.title === t).id;

  it("RENUMBERS INTO ITS NEW MILESTONE", () => {
    // 1.1.1 under milestone 1.2 has to become 1.2.n or the filed table contradicts itself.
    const p = built();
    const after = moveTask(p, id(p, "A"), id(p, "M2"));
    expect(after.plan.find(e => e.title === "A").number).toBe("1.2.2");
    expect(after.plan.find(e => e.title === "A").parentId).toBe(id(p, "M2"));
  });

  it("leaves the milestone it came from alone", () => {
    const p = built();
    const after = moveTask(p, id(p, "A"), id(p, "M2"));
    expect(after.plan.find(e => e.title === "M1").number).toBe("1.1");
    expect(after.plan.find(e => e.title === "B").number).toBe("1.2.1");
  });

  it("A NULL DESTINATION ORPHANS IT, deliberately", () => {
    // The same escape the type control offers: the app never invents a parent, so it must let somebody
    // remove one.
    const p = built();
    const after = moveTask(p, id(p, "A"), null);
    expect(after.plan.find(e => e.title === "A").parentId).toBeNull();
  });

  it("REFUSES A THRUST OR A GATE as a destination", () => {
    // A thrust owns milestones and a gate owns nothing — dropping a task on either would create a shape
    // the form cannot print.
    const p = built();
    expect(moveTask(p, id(p, "A"), id(p, "T1"))).toBe(p);
  });

  it("ignores anything that is not a task", () => {
    const p = built();
    expect(moveTask(p, id(p, "M1"), id(p, "M2"))).toBe(p);
  });
});

describe("deleting", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "B", month: 3 });
    p = addPlanEntry(p, { kind: "gate", parentId: p.plan[0].id, title: "G", month: 12 });
    return p;
  };
  const id = (p, t) => p.plan.find(e => e.title === t).id;

  it("TAKES THE WHOLE SUBTREE, not one level", () => {
    // Removing a thrust took its milestones and LEFT THEIR TASKS — which then rendered as orphans
    // nobody had created, from a delete they thought they understood.
    const p = built();
    expect(removePlanEntry(p, id(p, "T1")).plan).toEqual([]);
  });

  it("a milestone takes its tasks and leaves the thrust", () => {
    const p = built();
    const after = removePlanEntry(p, id(p, "M"));
    expect(after.plan.map(e => e.title)).toEqual(["T1", "G"]);
  });

  it("COUNTS WHAT IT WOULD TAKE, so the question can be answered", () => {
    // "Delete this thrust?" is a question somebody can answer wrongly; "this will also remove 1
    // milestone, 1 go/no-go and 2 tasks" is one they can answer.
    const p = built();
    expect(deleteImpact(p, id(p, "T1"))).toMatchObject({ milestones: 1, gates: 1, tasks: 2, total: 4 });
    expect(deleteImpact(p, id(p, "M"))).toMatchObject({ tasks: 2, total: 2 });
    expect(deleteImpact(p, id(p, "A"))).toMatchObject({ total: 0 });
  });
});

describe("reordering thrusts", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M1", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "thrust", title: "T2" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[3].id, title: "M2", month: 9 });
    return p;
  };
  const id = (p, t) => p.plan.find(e => e.title === t).id;

  it("RENUMBERS THE THRUSTS AND EVERYTHING BENEATH THEM", () => {
    // Thrust order IS the numbering. A thrust dragged above another whose milestones kept 2.x would
    // print a table where TASK 1 contains 2.1.
    const p = built();
    const after = reorderThrust(p, id(p, "T2"), id(p, "T1"));
    const by = (t) => after.plan.find(e => e.title === t);
    expect(by("T2").number).toBe("1");
    expect(by("M2").number).toBe("1.1");
    expect(by("T1").number).toBe("2");
    expect(by("M1").number).toBe("2.1");
    expect(by("A").number).toBe("2.1.1");
  });

  it("puts them in the new order for the filed table", () => {
    const p = built();
    const after = reorderThrust(p, id(p, "T2"), id(p, "T1"));
    expect(planRows(after).map(e => e.title)).toEqual(["T2", "M2", "T1", "M1", "A"]);
  });

  it("moving to the end works", () => {
    const p = built();
    const after = reorderThrust(p, id(p, "T1"), null);
    expect(after.plan.find(e => e.title === "T1").number).toBe("2");
    expect(after.plan.find(e => e.title === "T2").number).toBe("1");
  });

  it("IS THE ONE PLACE THAT RENUMBERS ROWS IT DID NOT TOUCH", () => {
    // Documented deliberately: everywhere else a number, once assigned, is held — because it may be in
    // a document somebody filed. Reordering thrusts breaks that on purpose, because the person is
    // restructuring rather than editing a cell.
    const src = require("node:fs").readFileSync("src/engine/plan.js", "utf8");
    expect(src).toMatch(/DELIBERATELY RENUMBERS ROWS IT DID NOT TOUCH/);
  });

  it("ignores anything that is not a thrust", () => {
    const p = built();
    expect(reorderThrust(p, id(p, "M1"), id(p, "T1"))).toBe(p);
  });
});

describe("the Milestone Number column", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M1", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "gate", parentId: p.plan[0].id, title: "G late", month: 20 });
    p = addPlanEntry(p, { kind: "thrust", title: "T2" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[4].id, title: "M2", month: 14 });
    p = addPlanEntry(p, { kind: "gate", parentId: p.plan[4].id, title: "G early", month: 10 });
    return p;
  };
  const col = () => Object.fromEntries(appendixERows(built()).map(r => [r.title, r.milestoneNumber]));

  it("A MILESTONE'S IS ITS OWN NUMBER — they are the same thing", () => {
    expect(col()["M1"]).toBe("1.1");
    expect(col()["M2"]).toBe("2.1");
  });

  it("A TASK'S IS THE MILESTONE IT SITS UNDER, not its own", () => {
    // The column then says WHICH TARGET each row serves, which is the useful reading.
    expect(col()["A"]).toBe("1.1");
  });

  it("A GATE'S IS 1, 2, 3 IN CHRONOLOGICAL ORDER across the whole project", () => {
    // Not per thrust — a funder counts decision points through the award, not within a block of work.
    // "G early" is month 10 in the SECOND thrust and still numbers first.
    expect(col()["G early"]).toBe("1");
    expect(col()["G late"]).toBe("2");
  });

  it("a thrust leaves it blank", () => {
    expect(col()["T1"]).toBe("");
  });

  it("THE WORKBOOK WRITES THE SAME VALUE — one source, not two", () => {
    // The writer used to re-derive this cell and had drifted from the printed table.
    const src = require("node:fs").readFileSync("src/engine/planio.js", "utf8");
    expect(src).toMatch(/r\.milestoneNumber,/);
  });
});
