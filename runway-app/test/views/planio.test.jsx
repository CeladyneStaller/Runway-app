import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// EXPLICIT CLEANUP: two renders in one file made `data-testid` ambiguous, and the failure reads as a
// broken assertion rather than a leaked DOM.
afterEach(cleanup);
import React, { useState } from "react";
import { PlanIOModal } from "../../src/views/chrome/PlanIOModal";
import { addPlanEntry } from "../../src/engine/plan";

const TSV = [
  "Task Number\tTitle\tType\tNumber\tDescription\tVerification\tMonth",
  "1.1\tAchieve 3 A/cm2\tMilestone\t\t0.5 mg/cm2 loading\tCell report to TPM\t6",
  "1.1.1\tCatalyst ink\tTask\t1.1.1\tScreen 12 ratios\tMatrix retained\t2",
  "2.1\t5 kW stack\tGo/No-Go\tG1\t92% for 500 h\tWitnessed\tQ5",
].join("\n");

const withPlan = () => {
  let p = { id: "pr", name: "Catalyst", plan: [] };
  p = addPlanEntry(p, { kind: "milestone", title: "Existing", month: 4 });
  return p;
};
function H({ init }) {
  const [p, sp] = useState(init);
  return <><PlanIOModal project={p} setProject={fn => sp(fn(p))} onClose={() => {}} />
    <div data-testid="n">{p.plan.length}</div>
    <div data-testid="nums">{p.plan.map(e => e.number).join(",")}</div></>;
}
const open = (init = { id: "p", name: "P", plan: [] }) => render(<H init={init} />);
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));
const review = (c, tsv = TSV) => {
  fireEvent.change(c.querySelector(".io-ta"), { target: { value: tsv } });
  fireEvent.click(btn(c, /^Review/));
};

describe("the modal", () => {
  it("EXPORT COMES FIRST, import second", () => {
    // Export is the safe action and import overwrites, so the destructive one is further down the
    // reading order — the same order as SF-424A.
    const secs = [...open(withPlan()).container.querySelectorAll(".modal-sec")].map(s => s.textContent);
    expect(secs[0]).toMatch(/Export/);
    expect(secs[1]).toMatch(/Import/);
  });

  it("offers no export from an empty table", () => {
    expect(btn(open().container, /SOPO workbook/).disabled).toBe(true);
  });

  it("widens only once there is a review to show", () => {
    const v = open();
    expect(v.container.querySelector(".modal-wide")).toBeNull();
    review(v.container);
    expect(v.container.querySelector(".modal-wide")).toBeTruthy();
  });
});

describe("the editable review", () => {
  it("SHOWS EVERY COLUMN THAT GETS FILED", () => {
    const v = open();
    review(v.container);
    const heads = [...v.container.querySelectorAll(".io-grid th")].map(h => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(
      ["Task №", "Title", "Type", "M №", "Description", "Verification", "Month", "Qtr"]));
  });

  it("is editable, and the quarter follows the month", () => {
    // DERIVED, NOT EDITABLE. Two editable date columns is two places for a date to live and disagree.
    const v = open();
    review(v.container);
    const months = [...v.container.querySelectorAll(".io-grid tr")]
      .map(r => r.querySelectorAll("td")[6]?.querySelector("input")).filter(Boolean);
    fireEvent.change(months[0], { target: { value: "9" } });
    const qtr = [...v.container.querySelectorAll(".io-grid tr")][1].querySelectorAll("td")[7];
    expect(qtr.textContent).toBe("Q4");
    expect(qtr.querySelector("input")).toBeNull();
  });

  it("FLAGS THE CELL, not a banner count", () => {
    // "Quarter 5 read as month 12" under the month field is a claim somebody can check against the file
    // in front of them.
    const v = open();
    review(v.container);
    expect(v.container.querySelector(".ci.flag")).toBeTruthy();
    expect(v.container.querySelector(".flagnote").textContent).toMatch(/quarter/i);
  });

  it("a row can be dropped before it commits", () => {
    const v = open();
    review(v.container);
    expect(v.container.querySelectorAll(".io-grid tbody tr").length).toBe(3);
    fireEvent.click(v.container.querySelector(".io-rx"));
    expect(v.container.querySelectorAll(".io-grid tbody tr").length).toBe(2);
  });
});

describe("add versus replace", () => {
  it("OFFERS BOTH, EACH NAMING ITS OUTCOME", () => {
    // "Import" tells you an import will happen; these tell you what you will have afterwards.
    const v = open(withPlan());
    review(v.container);
    expect(btn(v.container, /Add 3 rows/)).toBeTruthy();
    expect(btn(v.container, /Replace all 1/)).toBeTruthy();
  });

  it("offers no Replace when there is nothing to replace", () => {
    const v = open();
    review(v.container);
    expect(btn(v.container, /Replace all/)).toBeUndefined();
    expect(btn(v.container, /Import 3 rows/)).toBeTruthy();
  });

  it("ADD KEEPS WHAT WAS THERE", () => {
    const v = open(withPlan());
    review(v.container);
    fireEvent.click(btn(v.container, /Add 3 rows/));
    expect(v.getByTestId("n").textContent).toBe("4");
  });

  it("replace does not", () => {
    const v = open(withPlan());
    review(v.container);
    fireEvent.click(btn(v.container, /Replace all/));
    expect(v.getByTestId("n").textContent).toBe("3");
  });

  it("neither button exists before the review has run", () => {
    // The destructive one is never the thing you press to find out what is in the file.
    const c = open(withPlan()).container;
    expect(btn(c, /Replace all/)).toBeUndefined();
    expect(btn(c, /Add \d+ rows/)).toBeUndefined();
  });
});

describe("collisions", () => {
  const clashing = () => {
    let p = { id: "pr", name: "C", plan: [] };
    p = addPlanEntry(p, { kind: "milestone", title: "Mine", month: 4 });   // number 1.1
    return p;
  };

  it("SHOWS THE COLUMN ONLY WHEN THERE IS SOMETHING TO RESOLVE", () => {
    // A conflict step shown for a clean import is one people learn to click through, and then click
    // through on the occasion it mattered.
    const clean = open();
    review(clean.container);
    expect([...clean.container.querySelectorAll(".io-grid th")].map(h => h.textContent))
      .not.toContain("Clash");

    const v = open(clashing());
    review(v.container);
    expect([...v.container.querySelectorAll(".io-grid th")].map(h => h.textContent)).toContain("Clash");
  });

  it("KEEP BOTH RENUMBERS THE INCOMING ROW, not the existing one", () => {
    // The numbers already in the table may be in a filed document; the arriving ones have not been
    // anywhere yet.
    const v = open(clashing());
    review(v.container);
    fireEvent.click(btn(v.container, /Add 3 rows/));
    const nums = v.getByTestId("nums").textContent.split(",");
    expect(nums[0]).toBe("1.1");            // mine, untouched
    expect(nums).toContain("1.2");          // theirs, moved
  });
});
