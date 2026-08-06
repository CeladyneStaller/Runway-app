import { describe, it, expect } from "vitest";
import { parsePlanPaste, matchColumns, draftsToPlan, planToTSV, APPENDIX_E_HEADERS,
         planCollisions, renumberIncoming } from "../../src/engine/planio.js";
import { addPlanEntry } from "../../src/engine/plan.js";

const TSV = [
  "Task Number or Subtask Number\tTask Title\tMilestone Type\tMilestone Number\tMilestone Description\tVerification Process\tAnticipated Date (Months)\tAnticipated Quarter",
  "1.1\tBaseline membrane\tMilestone\tM1.1\tCoupon at 78% efficiency\tTest report to the TPM\t6\tQ3",
  "1.1.1\tFormulation screening\tTask\t\tScreen 12 ratios\tMatrix retained by the PI\t3\tQ2",
  "2.1\t5 kW stack\tGo/No-Go Decision Point\tG1\t92% for 500 h\tWitnessed by the TPO\t14\tQ5",
].join("\n");

describe("column matching", () => {
  it("MATCHES ON CONTENT, not position", () => {
    // Recipients reorder columns, drop the quarter and rename headings. A table that has been through
    // three proposals still has to land.
    const m = matchColumns(["Anticipated Quarter", "Task Title", "Task Number", "Milestone Type"]);
    expect(m.quarter).toBe(0);
    expect(m.title).toBe(1);
    expect(m.number).toBe(2);
  });

  it("puts 'Milestone Description' in description, not title", () => {
    // It matches both patterns; pattern order decides, and the form's own meaning wins.
    const m = matchColumns(["Milestone Description (Go/No-Go Decision Criteria)"]);
    expect(m.description).toBe(0);
    expect(m.title).toBeUndefined();
  });

  it("survives headings it has never seen", () => {
    const m = matchColumns(["WBS", "Deliverable", "Evidence"]);
    expect(m.number).toBe(0); expect(m.title).toBe(1); expect(m.verification).toBe(2);
  });
});

describe("parsing a pasted table", () => {
  const { rows, error } = parsePlanPaste(TSV);

  it("reads every row", () => { expect(error).toBeNull(); expect(rows).toHaveLength(3); });

  it("reads the three kinds", () => {
    expect(rows.map(r => r.kind)).toEqual(["milestone", "task", "gate"]);
  });

  it("A QUARTER IS NOT A MONTH, and says so when it uses one", () => {
    // Appendix E has both columns and recipients fill in whichever their proposal used. Guessing
    // silently would put a gate up to two months from where it belongs.
    const q = parsePlanPaste([
      "Task\tTitle\tType\tAnticipated Date",
      "1.1\tThing\tMilestone\tQ6"].join("\n"));
    expect(q.rows[0].month).toBe(15);
    expect(q.rows[0].notes.join(" ")).toMatch(/quarter, not month/);
  });

  it("KEEPS AN UNDATED ROW rather than dropping it", () => {
    // Losing a row because a cell was blank produces a table that does not match the one they filed,
    // and they will not notice until an agency does.
    const u = parsePlanPaste(["Task\tTitle\tType\tDate", "9.9\tFinal report\tMilestone\t"].join("\n"));
    expect(u.rows).toHaveLength(1);
    expect(u.rows[0].month).toBeNull();
    expect(u.rows[0].notes.join(" ")).toMatch(/no date/);
  });

  it("infers a missing type from the number's depth, and says so", () => {
    const n = parsePlanPaste(["Task\tTitle", "1.2.3\tSub thing", "1.2\tTarget thing"].join("\n"));
    expect(n.rows[0].kind).toBe("task");
    expect(n.rows[1].kind).toBe("milestone");
    expect(n.rows[0].notes.join(" ")).toMatch(/type not given/);
  });

  it("reports rather than throws on unusable input", () => {
    expect(parsePlanPaste("").error).toBeTruthy();
    expect(parsePlanPaste("just one line").error).toBeTruthy();
    expect(parsePlanPaste("a\tb\nc\td").error).toMatch(/No title or description/);
  });
});

describe("drafts become a plan", () => {
  const plan = draftsToPlan(parsePlanPaste(TSV).rows);

  it("PARENTS A TASK TO THE TARGET ABOVE IT IN THE PASTE", () => {
    // The order the form prints. Matching on the number prefix would break the moment somebody's
    // numbering is inconsistent — and it usually is, because these tables are hand-edited across years.
    expect(plan[1].parentId).toBe(plan[0].id);
    expect(plan[0].parentId).toBeNull();
    expect(plan[2].parentId).toBeNull();
  });

  it("keeps the numbers it was given", () => {
    expect(plan.map(e => e.number)).toEqual(["1.1", "1.1.1", "2.1"]);
  });

  it("leaves a gate's outcome unset, because the paste cannot know it", () => {
    expect(plan[2].outcome).toBeNull();
  });
});

describe("export", () => {
  const p = () => {
    let x = { id: "p", plan: [] };
    x = addPlanEntry(x, { kind: "milestone", title: "M", month: 6,
                          description: "line one\nline two", verification: "v" });
    return x;
  };

  it("leads with the form's own headings", () => {
    expect(planToTSV(p()).split("\n")[0]).toBe(APPENDIX_E_HEADERS.join("\t"));
  });

  it("FLATTENS TABS AND NEWLINES INSIDE A CELL", () => {
    // Verification and description are free prose and people paste line breaks into them constantly.
    // One stray newline would split the row and shift every column after it.
    const body = planToTSV(p()).split("\n")[1];
    expect(body.split("\t")).toHaveLength(8);
    expect(body).toMatch(/line one line two/);
  });

  it("round-trips: what goes out comes back the same shape", () => {
    const back = parsePlanPaste(planToTSV(p()));
    expect(back.error).toBeNull();
    expect(back.rows[0].kind).toBe("milestone");
    expect(back.rows[0].month).toBe(6);
  });
});

describe("collisions", () => {
  const project = { plan: [{ id: "a", number: "1.1", title: "Mine" },
                           { id: "b", number: "1.1.1", title: "Mine too" }] };
  const drafts = [{ i: 0, number: "1.1" }, { i: 1, number: "1.3" }, { i: 2, number: "1.1.1" }];

  it("reports only the rows that actually clash", () => {
    const c = planCollisions(project, drafts);
    expect(Object.keys(c)).toEqual(["0", "2"]);
    expect(c[0].existing.title).toBe("Mine");
  });

  it("THE INCOMING ROW MOVES, never the existing one", () => {
    // The numbers already in the table may be in a filed document; the arriving ones have not been
    // anywhere yet.
    const taken = new Set(["1.1", "1.2"]);
    expect(renumberIncoming(taken, "1.1")).toBe("1.3");
    expect(renumberIncoming(new Set(["1.1.1"]), "1.1.1")).toBe("1.1.2");
  });

  it("leaves a free number alone", () => {
    expect(renumberIncoming(new Set(["1.1"]), "2.4")).toBe("2.4");
  });
});
