// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { HORIZON } from "./time.js";

// ---- time-dependent employee compensation ----
// expand one-time + repeated raises into a flat, chronologically-sorted list of salary events
export const expandRaises = (e) => {
  const out = [];
  (e.raises || []).forEach(r => {
    if (r.everyMonths && r.everyMonths > 0) {
      const cap = Math.min(r.until ?? HORIZON, e.end ?? HORIZON, HORIZON);
      for (let m = r.month; m <= cap; m += r.everyMonths) out.push({ month: m, mode: r.mode, value: r.value });
    } else out.push({ month: r.month, mode: r.mode, value: r.value });
  });
  return out.sort((a, b) => a.month - b.month);
};

// salary (in its basis unit) with all raises effective through month m applied
export const empSalaryAt = (e, m) => {
  let amt = e.amount || 0;
  for (const ev of expandRaises(e)) if (ev.month <= m) amt = ev.mode === "set" ? (ev.value || 0) : amt * (1 + (ev.value || 0) / 100);
  return amt;
};

export const empActive = (e, m) => m >= (e.start || 0) && (e.end == null || m <= e.end);

export const empMonthlyOf = (e, salary) => e.basis === "annual" ? salary / 12 : salary;      // basis unit -> monthly cost

export const empSalaryMoAt = (e, m) => empActive(e, m) ? empMonthlyOf(e, empSalaryAt(e, m)) : 0; // salary only

// Actual monthly cash cost = salary + employer burden (FICA, health, 401k...). fr = company fringe rate.
export const empCostAt = (e, m, fr = 0) => empSalaryMoAt(e, m) * (1 + fr);

// Raw labour rate for grant billing — salary only; grants bill fringe as its own category.
export const HRS_YR = 2080;

export const empHourlyAt = (e, m) => empMonthlyOf(e, empSalaryAt(e, m)) * 12 / HRS_YR;

export const empTitleAt = (e, m) => { let t = e.title || ""; (e.promotions || []).slice().sort((a, b) => a.month - b.month).forEach(pr => { if (pr.month <= m) t = pr.title; }); return t; };

// piecewise-constant salary -> one recurring cost segment per constant stretch
export const compileEmployee = (e, fr = 0) => {
  const s = e.start || 0, end = e.end == null ? HORIZON : Math.min(e.end, HORIZON);
  if (end < s) return [];
  const lines = []; let segStart = s, segVal = empCostAt(e, s, fr);
  const flush = (segEnd) => { if (segVal > 0.005) lines.push({ label: e.name, cadence: "recurring", kind: "cost", amount: segVal, start: segStart, end: segEnd, growthPct: 0, isPayroll: true }); };
  for (let m = s + 1; m <= end; m++) { const v = empCostAt(e, m, fr); if (Math.abs(v - segVal) > 0.005) { flush(m - 1); segStart = m; segVal = v; } }
  flush(end);
  return lines;
};
