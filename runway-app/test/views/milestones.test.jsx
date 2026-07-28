// Critical dates. The panel was display-only — you could add a milestone and delete it, and the one
// it added was hard-coded to 15 May 2027 — so the name and date could never be changed at all.
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { Milestones } from "../../src/views/Milestones";
import { msTarget, msPass, msGap } from "../../src/engine/capital";

afterEach(cleanup);

const row = (over = {}) => ({ id: "m1", label: "Series A close", y: 2027, m: 4, day: 15,
                              bal: 250000, t: 9, date: new Date(2027, 4, 15), ...over });

// RE-RENDERS ON EVERY CHANGE, like the app does. Without that, React's value tracker still holds the
// last rendered value and a second edit to the same field is discarded as a no-op — which looked
// exactly like a bug in the component and was a bug in the harness.
const mount = (list, onChange = () => {}) => {
  let state = list;
  let view;
  const setMilestones = (v) => {
    state = typeof v === "function" ? v(state) : v;
    onChange(state);
    view.rerender(<Milestones ms={state} setMilestones={setMilestones} />);
  };
  view = render(<Milestones ms={state} setMilestones={setMilestones} />);
  return { ...view, get state() { return state; } };
};

describe("editing a milestone", () => {
  it("renames it", () => {
    let seen = null;
    const v = mount([row()], (s) => { seen = s; });
    fireEvent.change(v.getByLabelText("Milestone name"), { target: { value: "Board meeting" } });
    expect(seen[0].label).toBe("Board meeting");
  });

  it("moves its date, keeping the zero-based month the rest of the app expects", () => {
    let seen = null;
    const v = mount([row()], (s) => { seen = s; });
    fireEvent.change(v.getByLabelText("Milestone date"), { target: { value: "2028-01-31" } });
    // January is month 0 internally; the input speaks 1-based. Getting this backwards moves every
    // critical date by a month and nothing errors.
    expect(seen[0]).toMatchObject({ y: 2028, m: 0, day: 31 });
  });

  it("shows the stored date in the input without a timezone shifting it", () => {
    // `new Date("2027-05-15")` is UTC midnight and reads as the 14th in Denver. The suite runs under
    // TZ=America/Denver, so this fails if anybody reaches for Date parsing here.
    const v = mount([row()]);
    expect(v.getByLabelText("Milestone date").value).toBe("2027-05-15");
  });

  it("ignores a half-typed date rather than wiping the stored one", () => {
    let seen = "untouched";
    const v = mount([row()], (s) => { seen = s; });
    fireEvent.change(v.getByLabelText("Milestone date"), { target: { value: "2027-05" } });
    expect(seen).toBe("untouched");
  });

  it("still deletes", () => {
    let seen = null;
    const v = mount([row()], (s) => { seen = s; });
    fireEvent.click(v.getByLabelText("Delete milestone"));
    expect(seen).toEqual([]);
  });

  it("adds a date in the FUTURE, not a hard-coded one in the past", () => {
    let seen = null;
    const v = mount([], (s) => { seen = s; });
    fireEvent.click(v.getByText(/Add date/));
    const added = new Date(seen[0].y, seen[0].m, seen[0].day);
    expect(added.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("a round's close date stays owned by the Investment tab", () => {
  const fromRound = row({ id: "round-1", label: "Series A close", fromRound: "1" });

  it("is not editable here", () => {
    const v = mount([fromRound]);
    expect(v.queryByLabelText("Milestone name")).toBeNull();
    expect(v.queryByLabelText("Milestone date")).toBeNull();
    expect(v.queryByLabelText("Delete milestone")).toBeNull();
  });

  it("says where it IS editable", () => {
    const v = mount([fromRound]);
    expect(v.container.textContent).toMatch(/move it on the Investment tab/);
  });
});

describe("target cash on hand", () => {
  it("defaults to zero, so a milestone without one behaves exactly as before", () => {
    expect(msTarget({})).toBe(0);
    expect(msTarget({ target: undefined })).toBe(0);
    expect(msPass(1, {})).toBe(true);
    expect(msPass(-1, {})).toBe(false);
  });

  it("changes what counts as passing", () => {
    const ms = { target: 300000 };
    expect(msPass(250000, ms)).toBe(false);     // solvent, and short of what was promised
    expect(msPass(300000, ms)).toBe(true);      // exactly on it counts
    expect(msGap(250000, ms)).toBe(-50000);
  });

  it("ignores a non-numeric target rather than turning the gap into NaN", () => {
    for (const bad of [null, "", "abc", {}, NaN]) expect(msTarget({ target: bad })).toBe(0);
  });

  it("is editable, and clearing it removes the target rather than setting zero", () => {
    let seen = null;
    const v = mount([row()], (s) => { seen = s; });
    const input = v.getByLabelText("Target cash on hand");
    fireEvent.change(input, { target: { value: "300000" } });
    expect(seen[0].target).toBe(300000);
    fireEvent.change(v.getByLabelText("Target cash on hand"), { target: { value: "" } });
    expect(seen[0].target).toBeUndefined();
  });

  it("reads as a shortfall when the balance clears zero but misses the target", () => {
    const v = mount([row({ bal: 250000, target: 300000, pass: false, gap: -50000 })]);
    expect(v.container.textContent).toMatch(/shortfall/);
    expect(v.container.textContent).toMatch(/short of/);
  });

  it("says how much headroom there is when it passes", () => {
    const v = mount([row({ bal: 400000, target: 300000, pass: true, gap: 100000 })]);
    expect(v.container.textContent).toMatch(/on track/);
    expect(v.container.textContent).toMatch(/above target/);
  });

  it("shows no gap line at all when there is no target", () => {
    const v = mount([row()]);
    expect(v.container.textContent).not.toMatch(/above target|short of/);
  });
});
