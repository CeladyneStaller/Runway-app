import { describe, it, expect } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React, { useState } from "react";
import { ProjectPlan } from "../../src/views/chrome/ProjectPlan";
import { addPlanEntry } from "../../src/engine/plan";

const seeded = () => {
  let p = { id: "pr1", name: "Catalyst", plan: [] };
  p = addPlanEntry(p, { kind: "milestone", title: "Baseline membrane", month: 6 });
  p = addPlanEntry(p, { kind: "task", parentId: p.plan[0].id, title: "Screening", month: 3 });
  p = addPlanEntry(p, { kind: "gate", title: "5 kW stack", month: 14 });
  return p;
};
function H({ init, canWrite = true }) {
  const [p, sp] = useState(init);
  return <ProjectPlan project={p} setProject={fn => sp(fn(p))} startY={2026} startM={0} canWrite={canWrite} />;
}
const draw = (init = seeded(), o = {}) => render(<H init={init} {...o} />);

describe("the plan list", () => {
  it("SHOWS THE FILED ORDER — target, then its tasks", () => {
    // The order on screen is the order in the file. A table somebody rearranges for reading is one they
    // file in the wrong order the first time they export without looking.
    const v = draw();
    // GATES ARE UNNUMBERED NOW, per the form. The seeded fixture's third row is a gate, so its number
    // cell is empty rather than "1.2" — the assertion was written when gates shared the sequence.
    const nums = [...v.container.querySelectorAll(".pn")].map(n => n.textContent.replace(/^[+\u2212]/, ""));
// An unnumbered gate renders an em dash rather than an empty cell — a blank in a number column
    // reads as a value somebody failed to enter, and this one is blank by the form's design.
    expect(nums).toEqual(["1.1", "1.1.1", "—"]);
  });

  it("distinguishes a gate from a milestone in the row itself", () => {
    const v = draw();
    expect(v.container.querySelectorAll(".plan-r.gate").length).toBe(1);
    expect(v.container.querySelectorAll(".plan-r.ms").length).toBe(1);
    expect(v.container.querySelectorAll(".plan-r.task").length).toBe(1);
  });

  it("NAMES THE PARENT on the add button", () => {
    // A bare "+ Task" in a list this shape adds to whichever target the cursor last touched, which is
    // how work lands under the wrong milestone.
    expect(draw().container.textContent).toMatch(/\+ Task under 1\.1/);
  });

  it("explains itself when empty rather than showing a bare table", () => {
    const v = draw({ id: "p", plan: [] });
    expect(v.container.textContent).toMatch(/already have this table in the proposal/i);
  });
});

describe("the editor", () => {
  it("opens in place and shows both the month and the date", () => {
    // The month is what the agency asked for and what is stored; the date is the only form a person
    // can sanity-check.
    const v = draw();
    fireEvent.click(v.container.querySelectorAll(".plan-r")[0]);
    expect(v.container.querySelector(".plan-ed")).toBeTruthy();
    expect(v.container.textContent).toMatch(/Jul 2026|Jul 26/);
  });

  it("VERIFICATION IS ONE FIELD, not four", () => {
    // The form prints a single cell, so four inputs would mean joining them back and guessing the
    // punctuation.
    const v = draw();
    fireEvent.click(v.container.querySelectorAll(".plan-r")[0]);
    expect(v.container.textContent).toMatch(/what · how · who · where/);
    expect([...v.container.querySelectorAll("textarea")].length).toBe(2);
  });

  it("offers a Number field on a target and NOT on a task", () => {
    // The form prints an em dash for a task, and an empty box somebody cannot usefully fill is how a
    // stray number ends up in a filed document.
    const v = draw();
    fireEvent.click(v.container.querySelectorAll(".plan-r")[0]);
    expect(v.container.textContent).toMatch(/Milestone Number column/);
    cleanup();
    const w = draw();
    fireEvent.click(w.container.querySelectorAll(".plan-r")[1]);   // the task
    expect(w.container.textContent).not.toMatch(/Milestone Number column/);
  });

  it("A GATE ASKS WHAT FAILURE DOES, with no default selected", () => {
    // A term of the award. Defaulting to "stops entirely" would put a cliff in the projection nobody
    // agreed to.
    const v = draw();
    fireEvent.click(v.container.querySelectorAll(".plan-r")[2]);
    // THE TYPE CONTROL IS NOW THE FIRST SELECT in the editor, so "the select" is ambiguous. Find the
    // outcome one by its options rather than by position — a positional selector in a form that gains
    // fields is a test that breaks every time the form grows.
    const sel = [...v.container.querySelectorAll(".plan-ed select")]
      .find(x => [...x.options].some(o => /stops entirely/.test(o.textContent)));
    expect(sel.value).toBe("");
    expect(v.container.textContent).toMatch(/no safe default/);
  });

  it("edits write through", () => {
    const v = draw();
    fireEvent.click(v.container.querySelectorAll(".plan-r")[0]);
    fireEvent.change(v.container.querySelector(".plan-ed input"), { target: { value: "Renamed" } });
    expect(v.container.textContent).toMatch(/Renamed/);
  });
});

describe("gaps", () => {
  it("ARE REPORTED, NOT ENFORCED", () => {
    // Requiring verification before a row can be saved would stop people recording the DATE, which is
    // the part the model needs.
    const v = draw();
    expect(v.container.textContent).toMatch(/incomplete for the filed table/);
    expect(v.container.textContent).toMatch(/export with the cells blank/);
  });
});

describe("a viewer", () => {
  it("sees the table and cannot change it", () => {
    const v = draw(seeded(), { canWrite: false });
    expect(v.container.textContent).toMatch(/1\.1\.1/);
    expect(v.container.textContent).not.toMatch(/\+ Milestone/);
    fireEvent.click(v.container.querySelectorAll(".plan-r")[0]);
    expect(v.container.querySelector(".plan-ed input").disabled).toBe(true);
  });
});

describe("the import/export trigger", () => {
  // THE INLINE IMPORT MOVED INTO A MODAL, so the seven tests that lived here — paste box, review
  // counts, quarter flagging, parenting — moved with it to `planio.test.jsx` rather than being
  // deleted. What is left here is the panel's own contract: it offers ONE route, and a viewer gets
  // none.
  it("offers ONE route, not an inline box beside it", () => {
    const v = draw();
    expect(v.container.querySelector(".iobtn")).toBeTruthy();
    expect(v.container.querySelector(".plan-import")).toBeNull();
  });

  it("is offered on an empty plan too, because that is where it matters most", () => {
    // Nobody starts a project in this app — they start it in a proposal where the table already exists.
    expect(draw({ id: "p", plan: [] }).container.querySelector(".iobtn")).toBeTruthy();
  });

  it("a viewer is offered neither", () => {
    const v = draw(seeded(), { canWrite: false });
    expect(v.container.querySelector(".iobtn")).toBeNull();
  });
});

describe("where the trigger sits", () => {
  // IT BELONGS IN THE HEADER IN BOTH STATES. It sat below the empty state's copy, which put it in a
  // different place depending on whether the table had rows — and a control that moves is one people
  // look for twice. SF-424A's is always top-right.
  const inHeader = (v) => !!v.container.querySelector(".panel-h .iobtn");

  it("is in the header when the table is EMPTY", () => {
    expect(inHeader(draw({ id: "p", plan: [] }))).toBe(true);
  });

  it("and in the header when it has rows", () => {
    expect(inHeader(draw())).toBe(true);
  });

  it("appears exactly once in each state", () => {
    expect(draw({ id: "p", plan: [] }).container.querySelectorAll(".iobtn").length).toBe(1);
    expect(draw().container.querySelectorAll(".iobtn").length).toBe(1);
  });
});

describe("thrusts in the list", () => {
  const three = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "Catalyst development" });
    const t1 = p.plan[0].id;
    p = addPlanEntry(p, { kind: "milestone", parentId: t1, title: "3 A/cm2", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "Ink dev", month: 2 });
    p = addPlanEntry(p, { kind: "gate", parentId: t1, title: "Review", month: 12 });
    p = addPlanEntry(p, { kind: "thrust", title: "Stack integration" });
    return p;
  };

  it("renders all three levels, gate last in its thrust", () => {
    const v = draw(three());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    expect(rows.map(r => r.className.match(/thrust|gate|task|ms/)[0]))
      .toEqual(["thrust", "ms", "task", "gate", "thrust"]);
  });

  it("A THRUST'S DATES ARE DERIVED, shown as a span", () => {
    // Letting somebody type one creates a fourth place for a date to live, and the form has no cell.
    const v = draw(three());
    expect(v.container.querySelectorAll(".plan-r")[0].textContent).toMatch(/mo 6–12|mo 6-12/);
  });

  it("names the parent on every add button, at both levels", () => {
    // With three levels a bare "+" is ambiguous in two directions rather than one.
    const t = draw(three()).container.textContent;
    expect(t).toMatch(/\+ Milestone in TASK 1/);
    expect(t).toMatch(/\+ Go\/no-go for TASK 1/);
    expect(t).toMatch(/\+ Task under 1\.1/);
  });

  it("EVERY ROW IS DRAGGABLE", () => {
    // A thrust has no parent to move INTO, but it has a POSITION — and its position is its number, so
    // reordering thrusts is a real operation rather than a destination-less move.
    const rows = [...draw(three()).container.querySelectorAll(".plan-r")];
    // React writes `draggable={false}` as the string "false", not as an absent attribute.
    const drag = rows.map(r => r.getAttribute("draggable") === "true");
    // ALL FIVE. A thrust is draggable because its position is its number; everything else because it
    // has a parent it can be moved between.
    expect(drag).toEqual([true, true, true, true, true]);
  });

  it("DRAGGING A MILESTONE INTO A THRUST RENUMBERS IT AND ITS TASK", () => {
    // The number encodes the thrust. A milestone 1.1 dropped into thrust 2 that stayed 1.1 would be a
    // lie in a filed document.
    const v = draw(three());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[1]);
    fireEvent.dragOver(rows[4]);
    fireEvent.drop(rows[4]);
    const nums = [...v.container.querySelectorAll(".pn")].map(n => n.textContent.replace(/^[+\u2212]/, ""));
    expect(nums).toContain("2.1");
    expect(nums).toContain("2.1.1");
  });

  it("marks the thrust being dragged over", () => {
    const v = draw(three());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[1]);
    fireEvent.dragOver(rows[4]);
    expect(v.container.querySelector(".plan-r.dropping")).toBeTruthy();
  });

  it("a viewer cannot drag", () => {
    const rows = [...draw(three(), { canWrite: false }).container.querySelectorAll(".plan-r")];
    expect(rows.every(r => r.getAttribute("draggable") !== "true")).toBe(true);
  });
});

describe("collapsing", () => {
  const three = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "Catalyst" });
    const t1 = p.plan[0].id;
    p = addPlanEntry(p, { kind: "milestone", parentId: t1, title: "3 A/cm2", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "Ink", month: 2 });
    p = addPlanEntry(p, { kind: "thrust", title: "Stack" });
    return p;
  };
  const carets = (v) => [...v.container.querySelectorAll(".plan-rows .fold-c")];

  it("ARRIVES EXPANDED — collapse state is what is SHUT, not what is open", () => {
    // A new thrust arrives expanded, which is what somebody who just created it expects; the opposite
    // default would hide the thing they made.
    expect(draw(three()).container.querySelectorAll(".plan-r").length).toBe(4);
  });

  it("a thrust hides everything under it", () => {
    const v = draw(three());
    fireEvent.click(carets(v)[0]);
    expect(v.container.querySelectorAll(".plan-r").length).toBe(2);   // both thrusts, nothing inside
  });

  it("a milestone hides its tasks and leaves the thrust alone", () => {
    const v = draw(three());
    fireEvent.click(carets(v)[1]);
    expect(v.container.querySelectorAll(".plan-r").length).toBe(3);
  });

  it("A SHUT ROW SAYS WHAT IT IS HIDING", () => {
    // A caret with nothing beside it is a control people learn not to open.
    const v = draw(three());
    fireEvent.click(carets(v)[0]);
    expect(v.container.textContent).toMatch(/1 hidden/);
  });

  it("offers NO CARET on a row with nothing inside", () => {
    const v = draw(three());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    expect(rows[3].querySelector(".fold-c")).toBeNull();   // the empty second thrust
  });

  it("A TASK STAYS HIDDEN when its thrust is shut, even if its milestone is open", () => {
    const v = draw(three());
    fireEvent.click(carets(v)[0]);
    expect(v.container.textContent).not.toMatch(/Ink/);
  });

  it("the whole panel collapses, and its add buttons go with it", () => {
    const v = draw(three());
    fireEvent.click(v.container.querySelector(".panel-fold"));
    expect(v.container.querySelectorAll(".plan-r").length).toBe(0);
    expect(v.container.textContent).not.toMatch(/\+ Thrust/);
  });

  it("but the import/export trigger stays reachable", () => {
    // Collapsing to get it out of the way should not take the control with it.
    const v = draw(three());
    fireEvent.click(v.container.querySelector(".panel-fold"));
    expect(v.container.querySelector(".iobtn")).toBeTruthy();
  });
});

describe("changing an entry's type", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M2", month: 9 });
    return p;
  };
  const openRow = (v, i) => fireEvent.click(v.container.querySelectorAll(".plan-r")[i]);
  const typeSel = (v) => v.container.querySelector(".plan-ed select");

  it("offers all four kinds", () => {
    const v = draw(built());
    openRow(v, 1);
    expect([...typeSel(v).options].map(o => o.value))
      .toEqual(["thrust", "milestone", "gate", "task"]);
  });

  it("A TASK BECOMING A MILESTONE MOVES IN THE TREE and renumbers", () => {
    // The kind decides what an entry's parent may be and what its number means — it is not a field edit.
    const v = draw(built());
    openRow(v, 2);                                  // the task
    fireEvent.change(typeSel(v), { target: { value: "milestone" } });
    const nums = [...v.container.querySelectorAll(".pn")].map(n => n.textContent.replace(/^[+\u2212]/, ""));
    expect(nums).toContain("1.3");
  });

  it("SAYS WHEN IT CUT TASKS LOOSE, and marks them", () => {
    // Nothing is refused and nothing is re-homed — but a dropdown that quietly detaches rows is how
    // somebody loses work they then cannot find.
    const v = draw(built());
    openRow(v, 1);                                  // the milestone with a task
    fireEvent.change(typeSel(v), { target: { value: "task" } });
    expect(v.container.textContent).toMatch(/1 task left without a milestone/);
    expect(v.container.querySelectorAll(".plan-r.orphan").length).toBeGreaterThan(0);
    expect(v.container.textContent).toMatch(/no milestone/);
  });

  it("REFUSES NOTHING — the only milestone can become a task", () => {
    // The refusal was the same mistake as guessing a parent: the app deciding structure for somebody.
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "Only", month: 1 });
    const v = draw(p);
    openRow(v, 1);
    fireEvent.change(v.container.querySelector(".plan-ed select"), { target: { value: "task" } });
    expect(v.container.querySelectorAll(".plan-r.ms").length).toBe(0);
    expect(v.container.querySelectorAll(".plan-r.orphan").length).toBe(1);
  });

  it("becoming a gate drops the number", () => {
    const v = draw(built());
    openRow(v, 3);                                  // M2
    fireEvent.change(typeSel(v), { target: { value: "gate" } });
    expect(v.container.querySelectorAll(".plan-r.gate").length).toBe(1);
  });

  it("a viewer cannot change it", () => {
    const v = draw(built(), { canWrite: false });
    openRow(v, 1);
    expect(typeSel(v).disabled).toBe(true);
  });
});

describe("dragging a task", () => {
  const two = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M1", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M2", month: 9 });
    return p;
  };
  const nums = (v) => [...v.container.querySelectorAll(".pn")]
    .map(n => n.textContent.replace(/^[+\u2212]/, ""));

  it("MOVES IT INTO ANOTHER MILESTONE AND RENUMBERS", () => {
    // 1.1.1 under milestone 1.2 has to become 1.2.n or the filed table contradicts itself.
    const v = draw(two());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[2]);            // the task
    fireEvent.dragOver(rows[3]);             // M2
    fireEvent.drop(rows[3]);
    expect(nums(v)).toContain("1.2.1");
  });

  it("A MILESTONE DOES NOT ACCEPT A MILESTONE", () => {
    // Letting anything land anywhere would create shapes the form cannot print.
    const v = draw(two());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[1]);            // M1
    fireEvent.dragOver(rows[3]);             // M2
    expect(v.container.querySelector(".plan-r.dropping")).toBeNull();
  });

  it("A THRUST DOES NOT ACCEPT A TASK", () => {
    // A task under a thrust has no number the form can print.
    const v = draw(two());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[2]);            // the task
    fireEvent.dragOver(rows[0]);             // the thrust
    expect(v.container.querySelector(".plan-r.dropping")).toBeNull();
  });

  it("highlights only what will actually take the drop", () => {
    const v = draw(two());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[3]);
    expect(v.container.querySelectorAll(".plan-r.dropping").length).toBe(1);
  });
});

describe("deleting", () => {
  const built = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M", month: 6 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "A", month: 2 });
    p = addPlanEntry(p, { kind: "task", parentId: p.plan[1].id, title: "B", month: 3 });
    return p;
  };
  const openRow = (v, i) => fireEvent.click(v.container.querySelectorAll(".plan-r")[i]);
  // TRIM: the JSX puts the label on its own line, so textContent carries the surrounding whitespace and
  // an exact === match finds nothing.
  const del = (v) => [...v.container.querySelectorAll(".plan-ed button")]
    .find(b => b.textContent.trim() === "Delete");

  it("ASKS BEFORE TAKING A SUBTREE, and counts what goes", () => {
    // "Are you sure?" is a question somebody can answer wrongly; "it will also remove 1 milestone,
    // 2 tasks" is one they can answer.
    const v = draw(built());
    openRow(v, 0);                                   // the thrust
    fireEvent.click(del(v));
    expect(v.container.textContent).toMatch(/Delete this thrust\?/);
    expect(v.container.textContent).toMatch(/1 milestone, 2 tasks/);
    expect(v.container.querySelectorAll(".plan-r").length).toBe(4);   // nothing deleted yet
  });

  it("DOES NOT ASK for a row that takes only itself", () => {
    // Asking on every delete teaches people to click through the question, and then they click through
    // it on the thrust.
    const v = draw(built());
    openRow(v, 2);                                   // a task
    fireEvent.click(del(v));
    expect(v.container.textContent).not.toMatch(/Delete this/);
    expect(v.container.querySelectorAll(".plan-r").length).toBe(3);   // gone immediately
  });

  it("Keep leaves everything alone", () => {
    const v = draw(built());
    openRow(v, 1);
    fireEvent.click(del(v));
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => b.textContent.trim() === "Keep"));
    expect(v.container.querySelectorAll(".plan-r").length).toBe(4);
    expect(v.container.textContent).not.toMatch(/Delete this/);
  });

  it("Delete anyway TAKES THE WHOLE SUBTREE", () => {
    // Removing a thrust took its milestones and left their tasks as orphans nobody created.
    const v = draw(built());
    openRow(v, 0);
    fireEvent.click(del(v));
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /Delete anyway/.test(b.textContent)));
    expect(v.container.querySelectorAll(".plan-r").length).toBe(0);
  });

  it("names the kind it is about to remove", () => {
    const v = draw(built());
    openRow(v, 1);
    fireEvent.click(del(v));
    expect(v.container.textContent).toMatch(/Delete this milestone\?/);
    expect(v.container.textContent).toMatch(/2 tasks/);
  });
});

describe("reordering thrusts by drag", () => {
  const two = () => {
    let p = { id: "pr", plan: [] };
    p = addPlanEntry(p, { kind: "thrust", title: "T1" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[0].id, title: "M1", month: 6 });
    p = addPlanEntry(p, { kind: "thrust", title: "T2" });
    p = addPlanEntry(p, { kind: "milestone", parentId: p.plan[2].id, title: "M2", month: 9 });
    return p;
  };
  const titles = (v) => [...v.container.querySelectorAll(".pt")].map(t => t.textContent);
  const nums = (v) => [...v.container.querySelectorAll(".pn")]
    .map(n => n.textContent.replace(/^[+\u2212]/, ""));

  it("A THRUST IS DRAGGABLE — its position is its number", () => {
    const rows = [...draw(two()).container.querySelectorAll(".plan-r")];
    expect(rows[0].getAttribute("draggable")).toBe("true");
  });

  it("MOVING ONE RENUMBERS IT AND EVERYTHING BENEATH", () => {
    // Thrust order IS the numbering, so a thrust dragged above another whose milestones kept 2.x would
    // print a table where TASK 1 contains 2.1.
    const v = draw(two());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[2]);          // T2
    fireEvent.dragOver(rows[0]);           // before T1
    fireEvent.drop(rows[0]);
    expect(titles(v)).toEqual(["T2", "M2", "T1", "M1"]);
    expect(nums(v)).toEqual(["TASK 1", "1.1", "TASK 2", "2.1"]);
  });

  it("a milestone still does not accept a thrust", () => {
    const v = draw(two());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[0]);          // T1
    fireEvent.dragOver(rows[1]);           // M1
    expect(v.container.querySelector(".plan-r.dropping")).toBeNull();
  });
});
