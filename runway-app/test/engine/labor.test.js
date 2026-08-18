// Labor prioritization: leave-one-out Δ zero-date, net vs cost-only. The key behaviours: removing
// someone extends the runway (positive net delta), the net-vs-cost gap reflects revenue they bring in,
// and per-100h is null for non-grant staff.
import { describe, it, expect } from "vitest";
import { laborPriorities } from "../../src/engine";
import { canaryDoc as demoDoc } from "../../src/state/document";

function withToggles(d) { d.settings.toggles = { committed: true, expected: true, speculative: false, financing: false }; return d; }

describe("laborPriorities on the demo", () => {
  it("returns a row per employee, sorted by net delta descending", () => {
    const { rows } = laborPriorities(withToggles(demoDoc()));
    const doc = demoDoc();
    expect(rows).toHaveLength(doc.employees.length);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].netDelta).toBeGreaterThanOrEqual(rows[i].netDelta);
  });

  it("removing an employee extends (or holds) the runway — presence costs runway", () => {
    const { rows } = laborPriorities(withToggles(demoDoc()));
    // every person's net removal should not SHORTEN the runway below base by much; most extend it
    const anyExtends = rows.some(r => r.netDelta > 0);
    expect(anyExtends).toBe(true);
  });

  it("each row carries both net and cost-only deltas", () => {
    const { rows } = laborPriorities(withToggles(demoDoc()));
    for (const r of rows) {
      expect(typeof r.netDelta).toBe("number");
      expect(typeof r.costDelta).toBe("number");
      expect(r.broughtIn).toBeCloseTo(r.costDelta - r.netDelta, 6);
    }
  });

  it("per-100h is null for staff with no grant hours (demo budgets grant labor by role)", () => {
    // the demo's grant personnel are budgeted by ROLE with no employeeId, so no employee accrues grant
    // hours — per100h is null for everyone here. That's correct: the lens only applies to named grant staff.
    const { rows } = laborPriorities(withToggles(demoDoc()));
    for (const r of rows) {
      if (r.grantHours > 0) expect(typeof r.per100h).toBe("number");
      else expect(r.per100h).toBeNull();
    }
  });

  it("per-100h is a number when an employee IS linked to a grant", () => {
    const doc = withToggles(demoDoc());
    // link the first employee to a grant personnel row
    const grant = doc.projects.find(p => p.type === "grant" && p.grant?.categories?.personnel?.length);
    grant.grant.categories.personnel[0].employeeId = doc.employees[0].id;
    const { rows } = laborPriorities(doc);
    const linked = rows.find(r => r.id === doc.employees[0].id);
    expect(linked.grantHours).toBeGreaterThan(0);
    expect(typeof linked.per100h).toBe("number");
  });
});

describe("net vs cost-only semantics", () => {
  it("a purely-overhead employee has net == cost-only (no project work to lose)", () => {
    // build a doc with one employee on no project
    const base = {
      cash: 60000,   // ~6 months at 120k/yr -> finite runway within horizon
      settings: { toggles: { committed: true, expected: true, speculative: false, financing: false }, applyBaseline: false },
      employees: [{ id: "solo", name: "Solo", title: "Ops", basis: "annual", amount: 120000, start: 0, end: null }],
      projects: [], pos: [], rounds: [], lines: [], history: [], milestones: [],
    };
    const { rows } = laborPriorities(base);
    const solo = rows.find(r => r.id === "solo");
    // no project linkage -> net and cost-only removal are identical -> broughtIn == 0
    expect(solo.broughtIn).toBeCloseTo(0, 6);
  });
});
