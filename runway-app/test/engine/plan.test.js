import { describe, it, expect } from "vitest";
import { addPlanEntry, updatePlanEntry, removePlanEntry, planRows, nextNumber,
         quarterOf, appendixERows, planGaps, moveToThrust } from "../../src/engine/plan.js";

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
    expect(rows[0]).toMatchObject({ taskNumber: "1.1", type: "Milestone", milestoneNumber: "M1" });
  });

  it("PRINTS AN EM DASH for a task's milestone number", () => {
    // A reviewer should not have to wonder whether a cell was missed.
    expect(rows[1]).toMatchObject({ taskNumber: "1.1.1", type: "Task", milestoneNumber: "\u2014" });
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
