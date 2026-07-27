// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { tripCost } from "./history.js";
import { HORIZON, clampM, floorM, nMon } from "./time.js";

// Billing lives on ONE axis: reimburseTiming = arrears | monthly | advance | milestone.
// "milestone" is reimbursement in arrears against delivered milestones rather than against a budget period.
// A milestone's money is only as good as the agency's acceptance. Delivered is a hope, accepted is a
// receivable, paid is history. For forward projection the due / delivery / acceptance dates collapse
// onto the milestone's own month; the lag is the agency's payment cycle AFTER acceptance.
export const MS_STATUS = [["planned", "Planned"], ["delivered", "Delivered"], ["accepted", "Accepted"], ["paid", "Paid"]];

export const msTier = (m) => m.status === "accepted" ? "committed" : "expected";

// Paid money is already sitting in cash on hand. Projecting it again would be the closed-round
// double-count wearing a different hat, so `paid` is bookkeeping and nothing more.
export const msPaid = (m) => m.status === "paid";

export const isMsBilled = (g) => (g?.reimburseTiming || "arrears") === "milestone";

export const TIMING_LABEL = { arrears: "In arrears (period end)", monthly: "Monthly (as incurred)", advance: "Advance (period start)", milestone: "On milestone delivery" };

export function computeGrant(g, H = HORIZON) {
  const P = g.periods || [], C = g.categories || {};
  const per = P.map((p, i) => {
    const hrsRate = (l) => ((l.byPeriod?.[i]?.hrs) || 0) * ((l.byPeriod?.[i]?.rate) || 0);
    const personnel = (C.personnel || []).reduce((a, l) => a + hrsRate(l), 0);
    // Labour charged to someone already on payroll is an ALLOCATION of salary you're paying anyway —
    // it belongs in the budget (so reimbursement is right) but must not draw cash a second time.
    const personnelAlloc = (C.personnel || []).filter(l => l.employeeId).reduce((a, l) => a + hrsRate(l), 0);
    const fringeRate = (C.fringe?.byPeriod?.[i]) || 0;
    const fringe = personnel * fringeRate;
    const travel = (C.travel || []).filter(t => t.period === i).reduce((a, t) => a + tripCost(t), 0);
    const equipment = (C.equipment || []).filter(x => x.period === i).reduce((a, x) => a + ((x.qty || 0) * (x.unitCost || 0)), 0);
    const supplies = (C.supplies || []).filter(x => x.period === i).reduce((a, x) => a + ((x.qty || 0) * (x.unitCost || 0)), 0);
    const contractual = (C.contractual || []).reduce((a, l) => a + ((l.byPeriod?.[i]) || 0), 0);
    const construction = (C.construction || []).reduce((a, l) => a + ((l.byPeriod?.[i]) || 0), 0);
    const other = (C.other || []).reduce((a, l) => a + ((l.byPeriod?.[i]) || 0), 0);
    const direct = personnel + fringe + travel + equipment + supplies + contractual + construction + other;
    const bk = C.indirect?.base || "total_direct";
    const base = bk === "personnel_fringe" ? personnel + fringe : bk === "mtdc" ? direct - equipment : direct;
    const indirect = (C.indirect?.rates || []).reduce((a, r) => a + (((r.byPeriod?.[i]) || 0) * base), 0);
    const total = direct + indirect, cs = g.costSharePct || 0;
    // An indirect rate recovers overhead you ALREADY pay (rent, admin, IT) — it belongs in the budget
    // so the funder reimburses it, but it isn't new cash unless this grant genuinely adds overhead.
    const indirectAlloc = C.indirect?.incremental ? 0 : indirect;
    const allocated = personnelAlloc * (1 + fringeRate) + indirectAlloc; // already leaving as payroll / opex
    return { personnel, personnelAlloc, fringe, travel, equipment, supplies, contractual, construction, other, direct, indirect, indirectAlloc, total, allocated, federal: total * (1 - cs), costShare: total * cs };
  });
  const grand = {}; ["personnel", "personnelAlloc", "fringe", "travel", "equipment", "supplies", "contractual", "construction", "other", "direct", "indirect", "indirectAlloc", "total", "allocated", "federal", "costShare"].forEach(k => grand[k] = per.reduce((a, x) => a + x[k], 0));

  const lines = [];
  // conf defaults to "committed" so every existing caller is unchanged. floorM (not clampM) on start:
  // a payment past the horizon must fall off, not slide back onto month 18 — same trap as F8.
  const push = (kind, amount, start, end, label, conf) => { if (Math.abs(amount) > 0.01) lines.push({ cadence: end == null ? "onetime" : "recurring", kind, amount, start: floorM(start), end: end == null ? undefined : clampM(end), label, confidence: kind === "revenue" ? (conf || "committed") : undefined }); };

  // COSTS — from the SF-424A budget, less any labour already leaving as payroll
  P.forEach((p, i) => {
    const t = per[i], n = nMon(p);
    const gross = isMsBilled(g)
      ? t.total // milestone / fixed-price: you incur the full budget and are paid on the award schedule
      : (g.assumeFunded ? t.costShare : (g.costShareType === "inkind" ? t.federal : t.total));
    const cashOut = Math.max(0, gross - t.allocated); // allocated labour is already counted in payroll
    push("cost", cashOut / n, p.start, p.end, `BP${i + 1} costs`);
  });

  // REVENUE — set by how the grant is reimbursed
  // The agency's payment cycle applies however you bill. It used to be declared inside the period
  // branch, which is why milestone money landed the instant the milestone did.
  const lag = g.reimburseLagMonths || 0;
  if (isMsBilled(g)) {
    const totalPay = (g.milestones || []).reduce((a, m) => a + (m.payment || 0), 0);
    if (g.assumeFunded) { const s = P[0]?.start ?? 0, e = P[P.length - 1]?.end ?? HORIZON; push("revenue", totalPay / Math.max(1, e - s + 1), s, e, "Award (assumed funded)"); }
    else (g.milestones || []).forEach(m => {
      if (msPaid(m)) return; // already in the bank — see cashActuals
      push("revenue", m.payment, (m.month || 0) + lag, null, m.label || "Milestone payment", msTier(m));
    });
  } else if (!g.assumeFunded) {
    const timing = g.reimburseTiming || "arrears";
    P.forEach((p, i) => {
      const t = per[i], n = nMon(p);
      if (timing === "monthly") for (let m = p.start; m <= p.end; m++) push("revenue", t.federal / n, m + lag, null, `BP${i + 1} reimbursement`);
      else if (timing === "advance") push("revenue", t.federal, p.start + lag, null, `BP${i + 1} advance`);
      else push("revenue", t.federal, p.end + lag, null, `BP${i + 1} reimbursement`);
    });
  }
  return { per, grand, lines };
}

// grant payments (reimbursements + milestones) expected to land in a given month
export function grantPaymentsAt(projects, month) {
  const out = [];
  (projects || []).filter(p => p.type === "grant").forEach(p => {
    computeGrant(p.grant).lines.filter(l => l.kind === "revenue").forEach((l, i) => {
      const lands = l.cadence === "onetime" ? l.start === month : (l.start <= month && (l.end == null || month <= l.end));
      if (lands && Math.abs(l.amount) > 0.5) out.push({ id: p.id + "-r" + i, grant: p.name, amount: l.amount });
    });
  });
  return out;
}
