// Labor prioritization by leave-one-out. For each employee, ask: if they weren't here, where would the
// runway zero-date move? Two removal modes, because they answer different questions:
//
//   NET       remove the person AND the project/grant work they're linked to. Their salary drops, but
//             so does the grant reimbursement / fulfillment revenue they enable. This is their HONEST
//             runway impact — a well-reimbursed grant engineer may cost almost nothing net, because
//             what they bring in offsets their pay.
//   COST-ONLY remove just their salary; leave their project work in place (it falls back to a nominal
//             rate). The GAP between cost-only and net is, in effect, the value they bring in.
//
// Ranked by Δ zero-date (months of runway their presence costs). The per-100-grant-hours column is
// shown only where the person actually has grant-allocated hours; elsewhere it's null (honest about
// where the data supports the normalization).
//
// Cost: N projection rebuilds (one per employee). buildModelFromDoc is a real computation, so callers
// should memoize this — it's cheap per employee but shouldn't run every render.

import { HORIZON } from "./time.js";
import { buildModelFromDoc } from "./buildmodel.js";
import { buildProjection, zeroInfo } from "./projection.js";

// Total grant-allocated hours for an employee across all grant projects — the denominator for the
// per-100h lens. Zero if they're not staffed on any grant.
function grantHoursOf(employeeId, projects) {
  let hrs = 0;
  for (const p of projects || []) {
    const pers = p.grant?.categories?.personnel;
    if (!pers) continue;
    for (const l of pers) {
      if (l.employeeId === employeeId) {
        for (const b of (l.byPeriod || [])) hrs += Number(b.hrs) || 0;
      }
    }
  }
  return hrs;
}

// A document with one employee removed. mode "net" also strips their linkage from project labor lines
// and grant personnel (so the work/revenue they enable goes too); mode "cost" leaves the work in place.
function docWithout(doc, employeeId, mode) {
  const d = { ...doc, employees: (doc.employees || []).filter(e => e.id !== employeeId) };
  if (mode === "net") {
    d.projects = (doc.projects || []).map(p => {
      let pp = p;
      // drop labor lines assigned to this person (the work disappears with them)
      if (p.lines?.some(l => l.isLabor && l.employeeId === employeeId)) {
        pp = { ...pp, lines: pp.lines.filter(l => !(l.isLabor && l.employeeId === employeeId)) };
      }
      // drop grant personnel rows for this person (the reimbursement they enable shrinks)
      const pers = p.grant?.categories?.personnel;
      if (pers?.some(l => l.employeeId === employeeId)) {
        pp = { ...pp, grant: { ...pp.grant, categories: { ...pp.grant.categories,
          personnel: pers.filter(l => l.employeeId !== employeeId) } } };
      }
      return pp;
    });
  }
  return d;
}

const zeroMonths = (doc, horizon) => {
  const rows = buildProjection(buildModelFromDoc(doc, horizon), doc.settings?.toggles || {});
  const z = zeroInfo(rows);        // zeroInfo returns null (not {months:null}) when it never goes negative
  return z ? z.months : null;      // null = never runs out within horizon / cash-positive
};

// The full ranking. Returns rows sorted by net Δ zero-date descending (biggest runway drain first).
export function laborPriorities(doc, horizon = HORIZON) {
  const employees = doc.employees || [];
  const baseZero = zeroMonths(doc, horizon);

  const rows = employees.map(e => {
    const netZero = zeroMonths(docWithout(doc, e.id, "net"), horizon);
    const costZero = zeroMonths(docWithout(doc, e.id, "cost"), horizon);
    const grantHrs = grantHoursOf(e.id, doc.projects);

    // Δ = how much LONGER the runway is without them (positive = their presence shortens runway).
    // When a zero is null (runway exceeds horizon), treat it as the horizon for a finite, comparable
    // delta, and flag it so the UI can mark ">= horizon".
    const dOf = (z) => (z == null ? horizon : z) - (baseZero == null ? horizon : baseZero);
    const netDelta = dOf(netZero);
    const costDelta = dOf(costZero);

    return {
      id: e.id,
      name: e.name,
      title: e.title,
      netDelta,                                   // months of runway their presence costs (net)
      costDelta,                                  // months if only their salary vanished
      broughtIn: costDelta - netDelta,            // the gap = value they bring in (revenue offset)
      netZeroNull: netZero == null,
      grantHours: grantHrs,
      // per-100-grant-hours: net runway impact normalized by their grant time. Null when no grant hours.
      per100h: grantHrs > 0 ? (netDelta / grantHrs) * 100 : null,
    };
  });

  rows.sort((a, b) => b.netDelta - a.netDelta);
  return { baseZero, baseZeroNull: baseZero == null, rows };
}
