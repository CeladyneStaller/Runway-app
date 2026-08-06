import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { sheetToText, sheetMeta, exportPlanWorkbook, parsePlanPaste, draftsToPlan } from "../../src/engine/planio.js";
import { addPlanEntry } from "../../src/engine/plan.js";

const REAL = "/mnt/user-data/uploads/SOPO_-_Milestone_Summary_Table.xlsx";

describe("a real DOE SOPO workbook", () => {
  const wb = XLSX.read(readFileSync(REAL), { type: "buffer" });
  const text = sheetToText(XLSX, wb);
  const parsed = parsePlanPaste(text);

  it("FINDS THE HEADER BELOW THE METADATA ROWS", () => {
    // The template opens with "Project Title:" and "Budget Period:", so a reader that assumes row 1 is
    // the header imports two lines of metadata as data and matches no columns at all.
    expect(text).toBeTruthy();
    expect(text.split("\n")[0]).toMatch(/Task Number/i);
  });

  it("reads the project title and budget period", () => {
    const m = sheetMeta(XLSX, wb);
    expect(m.title).toBeTruthy();
    expect(m.period).toBeTruthy();
  });

  it("parses without error and finds rows", () => {
    expect(parsed.error).toBeNull();
    expect(parsed.rows.length).toBeGreaterThan(5);
  });

  it("DROPS 'TASK 1' GROUPING ROWS, which are headings and not entries", () => {
    // These are real — I had removed them as invented. They carry the task title and no type.
    expect(parsed.rows.some(r => /^task\s+\d+$/i.test(r.number))).toBe(false);
  });

  it("reads milestones, tasks and a go/no-go", () => {
    const kinds = new Set(parsed.rows.map(r => r.kind));
    expect(kinds.has("milestone")).toBe(true);
    expect(kinds.has("task")).toBe(true);
    expect(kinds.has("gate")).toBe(true);
  });

  it("A BARE INTEGER IN THE QUARTER COLUMN IS A QUARTER", () => {
    // The real template writes 2, not Q2. Reading only "Q2" meant every row arrived undated.
    const dated = parsed.rows.filter(r => Number.isFinite(r.month));
    expect(dated.length).toBeGreaterThan(3);
  });

  it("gives an untitled go/no-go a name from its task group", () => {
    // A go/no-go row in the real template has no number and no title — just a type, a note and dates.
    const gate = parsed.rows.find(r => r.kind === "gate");
    expect(gate.title).toBeTruthy();
  });

  it("becomes a plan with tasks parented to the target above them", () => {
    const plan = draftsToPlan(parsed.rows);
    const firstTask = plan.find(e => e.kind === "task");
    expect(firstTask.parentId).toBeTruthy();
    expect(plan.find(e => e.id === firstTask.parentId).kind).not.toBe("task");
  });
});

describe("export", () => {
  const p = () => {
    let x = { id: "p", name: "Catalyst", plan: [] };
    x = addPlanEntry(x, { kind: "milestone", title: "M", month: 6, description: "d", verification: "v" });
    x = addPlanEntry(x, { kind: "task", parentId: x.plan[0].id, title: "T", month: 3,
                          description: "d2", verification: "v2" });
    return x;
  };

  it("writes the template's own metadata rows above the table", () => {
    const wb = exportPlanWorkbook(XLSX, p(), { period: "1" });
    const g = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    expect(String(g[0][0])).toMatch(/Project Title/);
    expect(String(g[1][0])).toMatch(/Budget Period/);
  });

  it("A TASK REPEATS ITS NUMBER and a milestone leaves the cell blank", () => {
    // The opposite of what the printed form suggests, and what the real template does.
    const wb = exportPlanWorkbook(XLSX, p());
    const g = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    const body = g.slice(4);
    expect(body[0][3]).toBe("");            // milestone
    expect(body[1][3]).toBe(body[1][0]);    // task repeats its number
  });

  it("writes the quarter as a bare integer", () => {
    const wb = exportPlanWorkbook(XLSX, p());
    const g = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    expect(g[4][7]).toBe(3);                // month 6 → quarter 3
    expect(typeof g[4][7]).toBe("number");
  });

  it("ROUND-TRIPS THROUGH THE SAME PARSER as a paste", () => {
    // One parser, two doors — a pasted table and an uploaded file cannot disagree about what a column
    // means, which is how two importers end up with different bugs.
    const wb = exportPlanWorkbook(XLSX, p());
    const back = parsePlanPaste(sheetToText(XLSX, wb));
    expect(back.error).toBeNull();
    expect(back.rows.map(r => r.kind)).toEqual(["milestone", "task"]);
    expect(back.rows[0].month).toBe(6);
  });
});

describe("thrusts survive the round trip", () => {
  const wb = XLSX.read(readFileSync("/mnt/user-data/uploads/SOPO_-_Milestone_Summary_Table_Template.xlsx"),
                       { type: "buffer" });
  const parsed = parsePlanPaste(sheetToText(XLSX, wb));

  it("READS 'TASK 1' AS AN ENTRY, not a heading to discard", () => {
    // Dropping these lost the level a go/no-go actually decides, and round-tripping a real workbook
    // produced a file with its TASK rows missing.
    const thrusts = parsed.rows.filter(r => r.kind === "thrust");
    expect(thrusts.length).toBeGreaterThanOrEqual(2);
    expect(thrusts[0].number).toBe("1");
  });

  it("parents milestones to the thrust above them", () => {
    const plan = draftsToPlan(parsed.rows);
    const m = plan.find(e => e.kind === "milestone");
    expect(plan.find(e => e.id === m.parentId).kind).toBe("thrust");
  });

  it("A GATE BELONGS TO ITS THRUST, not to a milestone", () => {
    // It has no number, it is the last row of its block, and its date is the end of the budget period.
    const plan = draftsToPlan(parsed.rows);
    const g = plan.find(e => e.kind === "gate");
    expect(plan.find(e => e.id === g.parentId).kind).toBe("thrust");
    expect(g.number).toBe("");
  });

  it("writes the TASK row back out", () => {
    const plan = draftsToPlan(parsed.rows);
    const out = exportPlanWorkbook(XLSX, { name: "P", plan });
    const g = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1, defval: "" });
    const thrustRow = g.slice(4).find(r => String(r[0]).startsWith("TASK"));
    expect(thrustRow).toBeTruthy();
    expect(thrustRow[2]).toBe("");        // no type
    expect(thrustRow[6]).toBe("");        // no month
  });
});
