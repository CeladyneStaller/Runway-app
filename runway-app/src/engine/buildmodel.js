// Assemble the projection MODEL from a document — the same pipeline App uses inline, extracted so a
// scenario's modified document runs through identical logic. This is the seam that makes scenarios
// trustworthy: base-doc-in -> the exact model App would build, so a scenario differs from base only by
// its patches, never by a divergent code path.
//
// Kept in the engine (pure, no React). App can adopt this later to de-duplicate; for now Scenarios
// uses it and a test pins that it reproduces App's base projection.

import { HORIZON } from "./time.js";
import { compileEmployee, empCostAt } from "./payroll.js";
import { resolveFringeRate } from "./fringe.js";
import { compileProject, resolveProjectRates, syncFulfilStage } from "./projects.js";
import { compilePO } from "./sales.js";
import { compileInstrument } from "./capital.js";
import { tagRevenue } from "./projection.js";
import { applyRevenueActuals } from "./revenue.js";
import { codedRevenue } from "./coding.js";
import { burnStats } from "./history.js";

export function buildModelFromDoc(doc, horizon = HORIZON) {
  const employees = doc.employees || [];
  const projects = doc.projects || [];
  const pos = doc.pos || [];
  const rounds = doc.rounds || [];
  const lines = doc.lines || [];
  const hist = doc.history || [];
  const codeMap = doc.codeMap || {};
  const customerMap = doc.customerMap || {};
  const toggles = doc.settings?.toggles || {};
  const flagOverrides = doc.flagOverrides || doc.settings?.flagOverrides || {};
  const method = doc.settings?.method || "trailing";
  const applyBaseline = doc.settings?.applyBaseline !== false;

  // fringe (itemized/manual -> resolved %), matching App
  const avgSalary = employees.length
    ? (employees.reduce((a, e) => a + empCostAt(e, 0, 0), 0) / employees.length) * 12 : 0;
  // empCostAt with fr=0 gives salary-only; average annual salary base for insurance-as-% in fringe calc
  const fringePct = resolveFringeRate(doc.settings?.fringe || {}, avgSalary, doc.settings?.fringePct ?? 0.30);

  const employeeLines = employees.flatMap(e => compileEmployee(e, fringePct));
  const rProjects = syncFulfilStage(resolveProjectRates(projects, employees, fringePct), pos);
  const projectLines = rProjects.flatMap(p => {
    if (p.stage === "prospective" && !p.include) return [];
    return compileProject(p).map(l => ({ ...l, projectId: p.id, projectName: p.name }));
  });

  // baseline burn (anchors opex forward to the historical run-rate)
  const payrollNow = employees.reduce((a, e) => a + empCostAt(e, 0, fringePct), 0);
  const companyOpexNow = lines.filter(l => l.kind === "cost" && l.cadence === "recurring" && (l.start || 0) <= 0 && (l.end == null || l.end >= 0))
    .reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const itemizedOpex = companyOpexNow + payrollNow;
  const derivedBurn = burnStats(hist, itemizedOpex, flagOverrides, method).applied;
  const baselineOpex = applyBaseline ? Math.max(0, derivedBurn - itemizedOpex) : 0;
  const baselineLines = baselineOpex > 0.5
    ? [{ label: "Other operating costs (baseline)", cadence: "recurring", kind: "cost", amount: baselineOpex, start: 0, end: null }]
    : [];

  const salesLines = pos.flatMap(po => compilePO(po).map(l => ({ ...l, poId: po.id })));
  const roundLines = rounds.flatMap(x => compileInstrument(x, rounds));

  // revenue replacement (Piece 3): recorded revenue replaces projected for each project's past
  const revActuals = {};
  for (const p of rProjects) {
    const r = codedRevenue(p.id, hist, { codeMap, customerMap });
    if (Object.keys(r).length) revActuals[p.id] = r;
  }
  const poProject = Object.fromEntries(pos.filter(p => p.projectId).map(p => [p.id, p.projectId]));

  const rawLines = tagRevenue([...lines, ...employeeLines, ...projectLines, ...salesLines, ...roundLines, ...baselineLines]);
  const { lineItems } = applyRevenueActuals(rawLines, revActuals, toggles, { poProject });

  return { cashOnHand: doc.cash || 0, horizon, lineItems };
}
