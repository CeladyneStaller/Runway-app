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

describe("⚠️ the labor reaches the PROJECTION as an ATTRIBUTION, not a charge", () => {
  const doc = () => ({
    settings: { workingDaysPerYear: 220 }, startY: 2026, startM: 6, cash: 500000,
    employees: [{ id: "e1", name: "Dana", basis: "annual", amount: 120000, start: 0 }],
    projects: [{ id: "p1", name: "Durability", type: "internal", start: 0, end: 8, budget: 150000,
                 lines: [], labor: [{ id: "a1", employeeId: "e1", days: 110 }] }],
    lines: [], pos: [], rounds: [], saas: [], history: [],
  });
  const parts = async () => (await import("../../src/engine/buildmodel.js")).buildModelParts(doc());

  it("⚠️ CHARGES NOTHING, because `compileEmployee` already charges the salary", async () => {
    // My first version priced this line, which charged Dana twice — £23,000 a month for one person on
    // £120k. **Internal labor ATTRIBUTES an existing cost; it does not add one.**
    const p = await parts();
    const labor = (p.projectLines || []).filter(l => l.employeeId);
    expect(labor).toHaveLength(1);
    expect(labor[0].amount).toBe(0);
  });

  it("carries the SHARE in `laborAmount`, which is what the card and allocation read", async () => {
    // 110 days of a £120k salary at 220 working days is exactly half a year.
    const labor = (await parts()).projectLines.filter(l => l.employeeId);
    const share = labor.reduce((a, l) => a + l.laborAmount * (l.end - l.start + 1), 0);
    expect(share).toBeCloseTo(60000, 0);
  });

  it("⚠️ TOTAL PAYROLL IS ONE SALARY, NOT TWO", async () => {
    // The assertion my earlier test SHOULD have made. It compared string positions in the source file
    // — a proxy that broke for an irrelevant reason (an import moved) and would have passed happily
    // while the model double-charged.
    const p = await parts();
    const emp = (p.employeeLines || []).reduce((a, l) => a + (l.amount || 0), 0);
    const lab = (p.projectLines || []).filter(l => l.employeeId)
      .reduce((a, l) => a + (l.amount || 0), 0);
    // Salary plus fringe for one person, and nothing added on top of it.
    expect(lab).toBe(0);
    expect(emp).toBeGreaterThan(0);
  });

  it("⚠️ THE WORKING-DAY SETTING CHANGES THE SHARE, which is why it is editable", async () => {
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const share = (wd) => buildModelParts({ ...doc(), settings: { workingDaysPerYear: wd } })
      .projectLines.filter(l => l.employeeId)
      .reduce((a, l) => a + l.laborAmount * (l.end - l.start + 1), 0);
    // 260 is the naive figure nobody works — it understates the project by ~18%, measured.
    expect(share(260)).toBeLessThan(share(220));
    expect(share(260) / share(220)).toBeCloseTo(220 / 260, 2);
  });
});

describe("⚠️ the allocation CHART and the allocation TAB must agree", () => {
  const mk = (days) => ({
    settings: { workingDaysPerYear: 220 }, startY: 2026, startM: 6, cash: 500000,
    employees: [{ id: "e1", name: "Dana", basis: "annual", amount: 120000, start: 0 }],
    projects: [{ id: "p1", name: "Durability", type: "internal", start: 0, end: 11, budget: 200000,
                 lines: [], labor: [{ id: "a1", employeeId: "e1", days }] }],
    lines: [], pos: [], rounds: [], saas: [], history: [],
  });

  it("⚠️ `pay.allocation` READ `p.team[].fte`, WHICH NOTHING HAS EVER WRITTEN", async () => {
    // Only two files mentioned that field and both only READ it — so this chart answered "No project
    // allocations recorded yet" for every company since it was built, however much allocation existed.
    // **A fourth allocation mechanism**, after teamLoad (hours), the allocPct measures (money) and the
    // projectId lines.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const doc = mk(220);
    const spec = buildChart("pay.allocation", doc, buildModelParts(doc));
    expect(spec.empty).toBeFalsy();
    expect(spec.rows[0].segments[0].value).toBeCloseTo(1, 2);
  });

  it("MATCHES what the Allocation sub-tab computes", async () => {
    // Both now read `teamLoad`, so the tab and its own chart cannot disagree.
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const { teamLoad } = await import("../../src/engine/projects.js");
    const { HRS_YR } = await import("../../src/engine/payroll.js");
    for (const days of [220, 110]) {
      const doc = mk(days);
      const load = teamLoad(doc.projects, { committed: true, expected: true, speculative: true }, doc);
      const peak = Math.max(...Object.values(load.e1.months));
      const spec = buildChart("pay.allocation", doc, buildModelParts(doc));
      expect(spec.rows[0].segments[0].value, `${days} days`)
        .toBeCloseTo(peak / (HRS_YR / 12), 2);
    }
  });

  it("still says so when there is nothing allocated", async () => {
    const { buildChart } = await import("../../src/engine/charts.js");
    const { buildModelParts } = await import("../../src/engine/buildmodel.js");
    const doc = mk(0);
    expect(buildChart("pay.allocation", doc, buildModelParts(doc)).empty).toBeTruthy();
  });
});
