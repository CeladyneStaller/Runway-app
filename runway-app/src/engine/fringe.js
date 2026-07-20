// Fringe rate resolution. The company fringe % that empCostAt applies to every salary can be set two
// ways, and this decides which:
//
//   1. ITEMIZED — build the rate from its parts: paid time off (vacation + holidays + sick, as a
//      fraction of working days), payroll taxes, 401(k) plan + match, and group insurance ($/person).
//   2. MANUAL — a single % typed directly.
//
// Rule (as specified): if a manual override is set, it wins. If the itemized inputs are all blank,
// fall back to the automatic (itemized) calculation; if THAT is also empty, fall back to the legacy
// default so an untouched document is unchanged. The resolved number is still just `fringePct` — every
// downstream consumer (empCostAt, the fulfillment margin) is untouched; only how it's computed changes.

const WORK_DAYS_YR = 260;   // 52 weeks × 5 days, the denominator PTO is measured against

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const blank = (v) => v === "" || v == null || Number.isNaN(Number(v));

// Is the itemized side effectively empty? (every field blank/zero -> nothing to compute)
export function itemizedIsEmpty(f = {}) {
  const fields = [f.vacationDays, f.holidayDays, f.sickDays, f.payrollTaxPct, f.k401Pct, f.k401MatchPct, f.insurancePerPerson];
  return fields.every(v => blank(v) || Number(v) === 0);
}

// The itemized rate, as a fraction (0.30 = 30%). `avgSalary` is the company average annual salary,
// needed only to express per-person insurance $ as a % of pay. Returns null if there's nothing set.
export function itemizedFringeRate(f = {}, avgSalary = 0) {
  if (itemizedIsEmpty(f)) return null;
  const vac = num(f.vacationDays) || 0;
  const hol = num(f.holidayDays) || 0;
  const sick = num(f.sickDays) || 0;
  const taxPct = (num(f.payrollTaxPct) || 0) / 100;
  const k401 = (num(f.k401Pct) || 0) / 100;
  const match = (num(f.k401MatchPct) || 0) / 100;
  const insurance = num(f.insurancePerPerson) || 0;

  // Paid time off: days not worked but still paid, as a fraction of working days. This is a real cost
  // because salary is paid for those days without output — it inflates the effective hourly cost.
  const ptoRate = (vac + hol + sick) / WORK_DAYS_YR;

  // 401(k): the employer cost is the MATCH (what the company pays in), capped by the plan contribution
  // the employee elects — you only match up to what they defer. `k401` is the employee deferral rate,
  // `match` the employer match rate; the employer pays min(match, deferral) of salary.
  const k401Cost = Math.min(match, k401);

  // Insurance: a flat $/person, expressed as a fraction of average salary so it joins the % rate.
  const insuranceRate = avgSalary > 0 ? insurance / avgSalary : 0;

  return ptoRate + taxPct + k401Cost + insuranceRate;
}

// The resolved fringe %, applying the precedence. `legacy` is the prior single value, used only when
// both the manual override and the itemized inputs are empty (so an untouched doc keeps its number).
export function resolveFringeRate(fringe, avgSalary = 0, legacy = 0.30) {
  const f = fringe || {};
  // manual override wins when set (a real number, not blank)
  if (f.mode === "manual" && !blank(f.manualPct)) return Math.max(0, Number(f.manualPct) / 100);
  const itemized = itemizedFringeRate(f, avgSalary);
  if (itemized != null) return Math.max(0, itemized);
  // both empty -> legacy default (or a stored manualPct even if mode isn't 'manual', as a last resort)
  if (!blank(f.manualPct)) return Math.max(0, Number(f.manualPct) / 100);
  return legacy;
}

// A blank itemized-fringe config (all fields empty), for the settings default.
export const blankFringe = () => ({
  mode: "itemized",           // "itemized" | "manual"
  vacationDays: "", holidayDays: "", sickDays: "",
  payrollTaxPct: "", k401Pct: "", k401MatchPct: "", insurancePerPerson: "",
  manualPct: "",
});
