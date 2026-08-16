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
