import { describe, it, expect } from "vitest";
import { compileInternalLabor, laborCost, personMonths, workingDaysOf, WORKING_DAYS_DEFAULT }
  from "../../src/engine/projects.js";

const emps = [{ id: "e1", name: "Dana" }, { id: "e2", name: "Marcus" }];
const proj = { id: "p1", name: "Durability", start: 0, end: 8, labor: [
  { id: "a1", employeeId: "e1", days: 110 },
  { id: "a2", employeeId: "e2", days: 34, start: 2, end: 8 },
] };

describe("⚠️ internal projects can allocate labor", () => {
  it("EMITS LINES CARRYING `projectId`", () => {
    // The same field the grant path emits — so the allocation bar, `allocPct`, the `project` dimension
    // and every payroll chart pick this up with NO change. **This was a missing input, not a missing
    // feature**: `InternalCard` simply never received `employees`.
    const lines = compileInternalLabor(proj, emps, null);
    expect(lines).toHaveLength(2);
    expect(lines.every(l => l.projectId === "p1")).toBe(true);
    expect(lines.every(l => l.employeeId)).toBe(true);
  });

  it("defaults an allocation's span to the PROJECT's own", () => {
    // Most internal work runs the length of the project, so the common case is one field not three.
    const [dana] = compileInternalLabor(proj, emps, null);
    expect(dana.start).toBe(0);
    expect(dana.end).toBe(8);
  });

  it("spreads days evenly across the span", () => {
    // Anything cleverer is a guess about a schedule nobody has entered.
    const [dana, marcus] = compileInternalLabor(proj, emps, null);
    expect(dana.daysPerMonth).toBeCloseTo(110 / 9, 4);
    expect(marcus.daysPerMonth).toBeCloseTo(34 / 7, 4);
  });

  it("skips an allocation with no employee or no days", () => {
    const bad = { ...proj, labor: [{ id: "x", employeeId: "gone", days: 40 },
                                   { id: "y", employeeId: "e1", days: 0 }] };
    expect(compileInternalLabor(bad, emps, null)).toHaveLength(0);
  });

  it("⚠️ DEFAULTS TO 220 WORKING DAYS, NOT 260", () => {
    // 260 is the naive answer and nobody works it — holidays and leave put most organisations near 220.
    // **Using 260 understates every internal project by roughly 15%**, which is why this is a company
    // setting with a stated default rather than a constant in the engine.
    expect(WORKING_DAYS_DEFAULT).toBe(220);
    expect(workingDaysOf(null)).toBe(220);
    expect(workingDaysOf({ settings: { workingDaysPerYear: 232 } })).toBe(232);
  });

  it("refuses a nonsense working-day setting rather than trusting it", () => {
    expect(workingDaysOf({ settings: { workingDaysPerYear: 5000 } })).toBe(220);
    expect(workingDaysOf({ settings: { workingDaysPerYear: 3 } })).toBe(220);
  });

  it("costs days from ONE salary resolution", () => {
    // 110 days at £120k on 220 working days is half a year's salary.
    expect(laborCost({ days: 110 }, {}, null, () => 10000)).toBeCloseTo(60000, 0);
  });

  it("reports person-months beside the days", () => {
    // This audience thinks in person-months for everything else; anybody reconciling against an
    // Appendix E should not have to do the arithmetic.
    expect(personMonths(110, null)).toBeCloseTo(6, 1);
  });
});

describe("⚠️ the labor reaches the PROJECTION, not just the card", () => {
  it("emits priced lines through buildModelParts", async () => {
    // The card showed correct costs while the projection did not include them — **a number that is
    // right on one screen and absent from the model is worse than a number that is missing from both**,
    // because the first looks like it worked.
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const doc = {
      settings: { workingDaysPerYear: 220 }, startY: 2026, startM: 6, cash: 500000,
      employees: [{ id: "e1", name: "Dana", basis: "annual", amount: 120000, start: 0 }],
      projects: [{ id: "p1", name: "Durability", type: "internal", start: 0, end: 8, budget: 150000,
                   lines: [], labor: [{ id: "a1", employeeId: "e1", days: 110 }] }],
      lines: [], pos: [], rounds: [], saas: [], history: [],
    };
    const labor = (buildModelParts(doc).projectLines || []).filter(l => l.employeeId);
    expect(labor).toHaveLength(1);
    const total = labor.reduce((a, l) => a + l.amount * (l.end - l.start + 1), 0);
    // 110 days of a £120k salary at 220 working days is exactly half a year.
    expect(total).toBeCloseTo(60000, 0);
  });

  it("⚠️ THE WORKING-DAY SETTING CHANGES THE ANSWER, which is why it is editable", async () => {
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const mk = (wd) => ({
      settings: { workingDaysPerYear: wd }, startY: 2026, startM: 6, cash: 500000,
      employees: [{ id: "e1", name: "Dana", basis: "annual", amount: 120000, start: 0 }],
      projects: [{ id: "p1", name: "D", type: "internal", start: 0, end: 8, budget: 150000,
                   lines: [], labor: [{ id: "a1", employeeId: "e1", days: 110 }] }],
      lines: [], pos: [], rounds: [], saas: [], history: [],
    });
    const cost = (wd) => (buildModelParts(mk(wd)).projectLines || [])
      .filter(l => l.employeeId)
      .reduce((a, l) => a + l.amount * (l.end - l.start + 1), 0);
    // 260 is the naive figure nobody works, and it understates the project by roughly 15%.
    expect(cost(260)).toBeLessThan(cost(220));
  });

  it("does not double-count somebody already drawing a salary", () => {
    // Internal labor is a PROJECT cost that happens to be paid to a person. Putting it with the
    // employees would count their pay twice, because `compileEmployee` already emits it in full.
    const src = (require("node:fs")).readFileSync("src/engine/buildmodel.js", "utf8");
    expect(src).toMatch(/compileInternalLabor\(p, employees, doc\)/);
    expect(src.indexOf("compileInternalLabor")).toBeGreaterThan(src.indexOf("const employeeLines"));
  });
});
