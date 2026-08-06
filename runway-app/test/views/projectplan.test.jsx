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
    const nums = [...v.container.querySelectorAll(".pn")].map(n => n.textContent);
    expect(nums).toEqual(["1.1", "1.1.1", "1.2"]);
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
