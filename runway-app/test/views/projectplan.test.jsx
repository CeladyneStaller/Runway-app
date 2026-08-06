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
    const nums = [...v.container.querySelectorAll(".pn")].map(n => n.textContent);
    expect(nums).toEqual(["1.1", "1.1.1", ""]);
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
    const sel = v.container.querySelector("select");
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

  it("ONLY MILESTONES AND GATES ARE DRAGGABLE", () => {
    // A task moves with its milestone and a thrust is the destination — making everything draggable
    // would let somebody drop a thrust into itself.
    const rows = [...draw(three()).container.querySelectorAll(".plan-r")];
    // React writes `draggable={false}` as the string "false", not as an absent attribute.
    const drag = rows.map(r => r.getAttribute("draggable") === "true");
    expect(drag).toEqual([false, true, false, true, false]);
  });

  it("DRAGGING A MILESTONE INTO A THRUST RENUMBERS IT AND ITS TASK", () => {
    // The number encodes the thrust. A milestone 1.1 dropped into thrust 2 that stayed 1.1 would be a
    // lie in a filed document.
    const v = draw(three());
    const rows = [...v.container.querySelectorAll(".plan-r")];
    fireEvent.dragStart(rows[1]);
    fireEvent.dragOver(rows[4]);
    fireEvent.drop(rows[4]);
    const nums = [...v.container.querySelectorAll(".pn")].map(n => n.textContent);
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
