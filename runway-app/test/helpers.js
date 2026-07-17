// The seed company, assembled exactly as App.jsx assembles it — same order, same baseline, same
// anchoring. The golden numbers only mean something if this chain matches the app's.
import { SEED_LINES, SEED_EMPLOYEES, SEED_PROJECTS, SEED_ROUNDS, SEED_POS_LINKED, SEED_FULFIL, HIST } from "../src/seed";
import {
  HORIZON, tagRevenue, buildProjection, anchorToActuals, zeroInfo, burnStats,
  compileEmployee, empCostAt, compileProject, resolveProjectRates, syncFulfilStage,
  compilePO, compileInstrument,
} from "../src/engine";

export const SEED_CASH = 560000;
export const SEED_ACTUALS = {
  0: { cash: 560000, rev: 15000 }, 1: { cash: 467000 }, 2: { cash: 343000 },
  3: { cash: 216000 }, 4: { cash: 108000 },
};

export function seedLines({ fringePct = 0.30, applyBaseline = true, method = "trailing" } = {}) {
  const projects = syncFulfilStage(
    resolveProjectRates([...SEED_PROJECTS, ...SEED_FULFIL], SEED_EMPLOYEES, fringePct), SEED_POS_LINKED);
  const employeeLines = SEED_EMPLOYEES.flatMap(e => compileEmployee(e, fringePct));
  const projectLines = projects.flatMap(p =>
    (p.stage === "prospective" && !p.include) ? [] : compileProject(p).map(l => ({ ...l, projectId: p.id })));

  // the measured-burn baseline: whatever history says you spend that the line items don't explain
  const payrollNow = SEED_EMPLOYEES.reduce((a, e) => a + empCostAt(e, 0, fringePct), 0);
  const companyOpexNow = SEED_LINES
    .filter(l => l.kind === "cost" && l.cadence === "recurring" && (l.start || 0) <= 0 && (l.end == null || l.end >= 0))
    .reduce((a, l) => a + l.amount, 0);
  const itemized = companyOpexNow + payrollNow;
  const derived = burnStats(HIST, itemized, {}, method).applied;
  const baselineOpex = applyBaseline ? Math.max(0, derived - itemized) : 0;
  const baselineLines = baselineOpex > 0.5
    ? [{ label: "Other operating costs (baseline)", cadence: "recurring", kind: "cost",
         amount: baselineOpex, start: 0, end: null, growthPct: 0, isBaseline: true }]
    : [];

  return tagRevenue([
    ...SEED_LINES, ...employeeLines, ...projectLines,
    ...SEED_POS_LINKED.flatMap(compilePO),
    ...SEED_ROUNDS.flatMap(r => compileInstrument(r, SEED_ROUNDS)),
    ...baselineLines,
  ]);
}

export const seedModel = (opts) => ({ cashOnHand: SEED_CASH, horizon: HORIZON, lineItems: seedLines(opts) });

/** The dashboard number: projected, then re-anchored to recorded actuals. */
export function seedZero(toggles, { anchor = true, ...opts } = {}) {
  const rows = anchorToActuals(buildProjection(seedModel(opts), toggles), SEED_ACTUALS, anchor);
  return { rows, zero: zeroInfo(rows, 2026, 6) };
}
