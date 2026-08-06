import { describe, it, expect } from "vitest";
import { addPlanEntry, updatePlanEntry, removePlanEntry, planRows, nextNumber,
         quarterOf, appendixERows, planGaps } from "../../src/engine/plan.js";

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
    expect(p.plan.map(e => e.number)).toEqual(["1.1", "1.1.1", "1.1.2", "1.2", "1.2.1", "1.3"]);
  });

  it("a task continues its own parent's sequence", () => {
    const p = withPlan();
    expect(nextNumber(p, "task", p.plan[0].id)).toBe("1.1.3");
    expect(nextNumber(p, "task", p.plan[3].id)).toBe("1.2.2");
  });

  it("milestones and gates share the target sequence", () => {
    // Both occupy a TASK row on the form, so they number together — a gate is not a separate series.
    expect(nextNumber(withPlan(), "gate")).toBe("1.4");
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
    expect(after.plan.map(e => e.number)).toEqual(["1.2", "1.2.1", "1.3"]);
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
    expect(planRows(withPlan()).map(e => e.number))
      .toEqual(["1.1", "1.1.1", "1.1.2", "1.2", "1.2.1", "1.3"]);
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
