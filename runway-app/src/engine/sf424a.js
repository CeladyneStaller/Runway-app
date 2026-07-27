// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import * as XLSX from "xlsx";
import { TIMING_LABEL } from "./grant.js";
import { tripCost } from "./history.js";
import { HORIZON, clampM, floorM, uid } from "./time.js";

// ---- SF-424A multi-tab budget: xlsx export / import matching the DOE justification template (3 budget periods) ----
export function exportBudget(p, g, R) {
  const P = (g.periods || []).slice(0, 3), nb = P.length, C = g.categories || {};
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const bp3 = (fn) => { const o = []; for (let i = 0; i < 3; i++) o.push(i < nb ? fn(i) : null); return o; };
  const T = "Detailed Budget Justification";

  add("a. Personnel", [[T], ["a. Personnel"], [],
    ["SOPO Task #", "Position Title", "Budget Period 1", null, null, "Budget Period 2", null, null, "Budget Period 3", null, null, "Project Total Hours", "Project Total Dollars", "Rate Basis"],
    [null, null, "Time (Hrs)", "Hourly Rate ($/Hr)", "Total Budget Period 1", "Time (Hrs)", "Hourly Rate ($/Hr)", "Total Budget Period 2", "Time (Hrs)", "Hourly Rate ($/Hr)", "Total Budget Period 3", null, null, null],
    ...(C.personnel || []).map(l => { let TH = 0, TD = 0; const row = [null, l.role];
      for (let i = 0; i < 3; i++) { const b = i < nb ? (l.byPeriod?.[i] || {}) : {}; const h = b.hrs || 0, r = b.rate || 0; row.push(i < nb ? h : null, i < nb ? r : null, i < nb ? h * r : null); TH += h; TD += h * r; }
      row.push(TH, TD, l.basis || ""); return row; }),
    ["TOTAL PERSONNEL"]]);

  add("b. Fringe", [[T], ["b. Fringe Benefits"], [],
    ["Labor Type", "Budget Period 1", null, null, "Budget Period 2", null, null, "Budget Period 3", null, null, "Total Project"],
    [null, "Personnel Costs", "Rate", "Total", "Personnel Costs", "Rate", "Total", "Personnel Costs", "Rate", "Total", null],
    ...(C.personnel || []).map(l => { let K = 0; const row = [l.role];
      for (let i = 0; i < 3; i++) { const b = i < nb ? (l.byPeriod?.[i] || {}) : {}; const pc = (b.hrs || 0) * (b.rate || 0); const rt = i < nb ? (C.fringe?.byPeriod?.[i] || 0) : 0; row.push(i < nb ? pc : null, i < nb ? rt : null, i < nb ? pc * rt : null); K += pc * rt; }
      row.push(K); return row; }),
    ["TOTAL FRINGE"]]);

  const travel = [[T], ["c. Travel"], [], ["SOPO Task #", "Purpose of Travel", "Depart From", "Destination", "No. of Days", "No. of Travelers", "Lodging per Traveler", "Flight per Traveler", "Vehicle per Traveler", "Per Diem Per Traveler", "Cost per Trip", "Basis for Estimating Cost"]];
  for (let i = 0; i < nb; i++) { travel.push([`Budget Period ${i + 1}`]);
    (C.travel || []).filter(t => (t.period || 0) === i).forEach(t => travel.push([null, t.purpose, t.departFrom || "", t.destination || "", t.days, t.travelers, t.lodging, t.flight, t.vehicle, t.perDiem, tripCost(t), t.basis || ""]));
    travel.push([`Budget Period ${i + 1} Total`, null, null, null, null, null, null, null, null, null, (C.travel || []).filter(t => (t.period || 0) === i).reduce((s, t) => s + tripCost(t), 0)]); }
  add("c. Travel", travel);

  const qty = (title, list) => { const a = [[T], [title], [], ["SOPO Task #", "Item", "Qty", "Unit Cost", "Total Cost", "Basis of Cost", "Justification of need"]];
    for (let i = 0; i < nb; i++) { a.push([`Budget Period ${i + 1}`]);
      (list || []).filter(x => (x.period || 0) === i).forEach(x => a.push([null, x.item, x.qty, x.unitCost, (x.qty || 0) * (x.unitCost || 0), x.basis || "", x.justification || ""]));
      a.push([`Budget Period ${i + 1} Total`, null, null, null, (list || []).filter(x => (x.period || 0) === i).reduce((s, x) => s + (x.qty || 0) * (x.unitCost || 0), 0)]); }
    return a; };
  add("d. Equipment", qty("d. Equipment", C.equipment));
  add("e. Supplies", qty("e. Supplies", C.supplies));

  add("f. Contractual", [[T], ["f. Contractual"], [], ["SOPO Task #", "Subrecipient / Contractor", "Purpose and Basis of Cost", "Budget Period 1", "Budget Period 2", "Budget Period 3", "Project Total"],
    ...(C.contractual || []).map(l => [null, l.name || "", l.purpose || "", ...bp3(i => l.byPeriod?.[i] || 0), (l.byPeriod || []).slice(0, nb).reduce((a, b) => a + (b || 0), 0)])]);

  const costSec = (title, list) => { const a = [[T], [title], [], ["SOPO Task #", "General Description", "Cost", "Basis of Cost", "Justification of need"]];
    for (let i = 0; i < nb; i++) { a.push([`Budget Period ${i + 1}`]);
      (list || []).forEach(l => { const amt = l.byPeriod?.[i] || 0; if (amt) a.push([null, l.desc || "", amt, l.basis || "", l.justification || ""]); });
      a.push([`Budget Period ${i + 1} Total`, null, (list || []).reduce((s, l) => s + (l.byPeriod?.[i] || 0), 0)]); }
    return a; };
  add("g. Construction", costSec("g. Construction", C.construction));
  add("h. Other", costSec("h. Other Direct Costs", C.other));

  const ind = [[T], ["i. Indirect Costs"], [], ["Rate Type", "Budget Period 1", "Budget Period 2", "Budget Period 3", "Total", "Explanation of BASE"]];
  (C.indirect?.rates || []).forEach(r => ind.push([r.label || "Indirect", ...bp3(i => r.byPeriod?.[i] || 0), null, ""]));
  ind.push([]); ind.push(["Indirect base", C.indirect?.base || "total_direct"]);
  ind.push(["Indirect treatment", C.indirect?.incremental ? "new overhead" : "recovers existing overhead"]);
  ind.push(["Total Indirect Costs Requested", ...bp3(i => R.per[i]?.indirect || 0), R.grand.indirect]);
  add("i. Indirect", ind);

  const sc = [["a.  Personnel", "personnel"], ["b.  Fringe Benefits", "fringe"], ["c.  Travel", "travel"], ["d.  Equipment", "equipment"], ["e.  Supplies", "supplies"], ["f.  Contractual", "contractual"], ["g.  Construction", "construction"], ["h.  Other", "other"]];
  add("SF-424A Cost Categories", [["SF-424A — Section B: Budget Categories"], ["Grant", p.name], ["Funder", g.funder || ""],
    ["Billing", TIMING_LABEL[g.reimburseTiming || "arrears"]], ["Cost-share %", Math.round((g.costSharePct || 0) * 100)], [],
    ["Budget Periods (months)", "Start", "End"], ...P.map((pp, i) => [`BP${i + 1}`, pp.start, pp.end]), [],
    ["Object Class Category", "Budget Period 1", "Budget Period 2", "Budget Period 3", "Total"],
    ...sc.map(([lbl, k]) => [lbl, ...bp3(i => R.per[i][k]), R.grand[k]]),
    ["i.  Total Direct Charges", ...bp3(i => R.per[i].direct), R.grand.direct],
    ["j.  Indirect Charges", ...bp3(i => R.per[i].indirect), R.grand.indirect],
    ["k.  Totals", ...bp3(i => R.per[i].total), R.grand.total],
    ["Federal share", ...bp3(i => R.per[i].federal), R.grand.federal],
    ["Non-federal cost-share", ...bp3(i => R.per[i].costShare), R.grand.costShare]]);

  XLSX.writeFile(wb, `${p.name} - SF-424A.xlsx`);
}

export function exportSchedule(p, g) {
  const aoa = [["Milestone / Award Schedule"], ["Grant", p.name], [],
    ["Milestone", "Month #", "Payment"],
    ...(g.milestones || []).map(m => [m.label, m.month, m.payment])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Milestone Schedule");
  XLSX.writeFile(wb, `${p.name} - Milestone Schedule.xlsx`);
}

export const _norm = (v) => String(v ?? "").trim().toLowerCase();

export const _colOf = (row, label) => (row || []).findIndex(c => _norm(c).includes(_norm(label)));

// import: detect the category tabs and read the line-item detail + justifications
export function importWorkbook(wb) {
  const sheet = (...keys) => { const nm = wb.SheetNames.find(n => keys.some(k => _norm(n).includes(_norm(k)))); return nm ? XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: null }) : null; };
  const summary = sheet("cost categor", "section b", "424a");
  let periods = [];
  if (summary) { const h = summary.findIndex(r => _norm(r?.[0]).includes("budget periods")); if (h >= 0) for (let i = h + 1; i < summary.length; i++) { if (!_norm(summary[i]?.[0]).startsWith("bp")) break; periods.push({ id: uid(), start: clampM(+summary[i][1] || 0), end: clampM(+summary[i][2] || 0) }); } }
  if (!periods.length) { const nb0 = 3, span = Math.max(1, Math.floor((HORIZON + 1) / nb0)); periods = Array.from({ length: nb0 }, (_, i) => ({ id: uid(), start: clampM(i * span), end: clampM(i === nb0 - 1 ? HORIZON : (i + 1) * span - 1) })); }
  const nb = periods.length;
  const skip = (v) => { const s = _norm(v); return s === "" || s.includes("example") || s.includes("total") || s.includes("domestic travel") || s.includes("international travel"); };

  const readPersonnel = (aoa) => { if (!aoa) return []; const h = aoa.findIndex(r => _norm(r?.[1]) === "position title"); if (h < 0) return []; const bp1 = _colOf(aoa[h], "budget period 1"), basisC = _colOf(aoa[h], "rate basis"); const out = [];
    for (let i = h + 2; i < aoa.length; i++) { const r = aoa[i], role = r?.[1]; if (skip(role)) { if (_norm(role).includes("total")) break; continue; }
      const byPeriod = []; for (let bp = 0; bp < nb; bp++) { const c = bp1 + bp * 3; byPeriod.push({ hrs: +r[c] || 0, rate: +r[c + 1] || 0 }); }
      out.push({ id: uid(), role: String(role), byPeriod, basis: basisC >= 0 && r[basisC] ? String(r[basisC]) : "" }); } return out; };
  const readFringe = (aoa) => { const byPeriod = Array(nb).fill(0); if (!aoa) return { byPeriod }; const h = aoa.findIndex(r => _colOf(r, "personnel costs") >= 0); if (h < 0) return { byPeriod }; const pc = _colOf(aoa[h], "personnel costs");
    for (let i = h + 1; i < aoa.length; i++) { const r = aoa[i]; if (skip(r?.[0])) continue; for (let bp = 0; bp < nb; bp++) byPeriod[bp] = +r[pc + 1 + bp * 3] || 0; break; } return { byPeriod }; };
  const secMarker = (r) => _norm(r?.[0]).match(/budget period\s*(\d+)/) || _norm(r?.[1]).match(/budget period\s*(\d+)/);
  const secIsTotal = (r) => _norm(r?.[0]).includes("total") || _norm(r?.[1]).includes("total");
  const hdrRow = (aoa) => aoa.findIndex(r => _norm(r?.[0]) === "sopo task #" || _norm(r?.[0]).startsWith("sopo task"));
  const readSectioned = (aoa, rowFn) => { if (!aoa) return []; const hd = hdrRow(aoa); if (hd < 0) return []; const out = []; let period = 0;
    for (let i = hd + 1; i < aoa.length; i++) { const r = aoa[i], m = secMarker(r); if (m) { period = secIsTotal(r) ? +m[1] : (+m[1] - 1); continue; } if (period < 0 || period >= nb) continue; const it = rowFn(r, period); if (it) out.push(it); } return out; };
  const readColumnar = (aoa) => { if (!aoa) return []; const h = aoa.findIndex(r => _colOf(r, "budget period 1") >= 0); if (h < 0) return []; const bp1 = _colOf(aoa[h], "budget period 1"); const out = [];
    for (let i = h + 1; i < aoa.length; i++) { const r = aoa[i], name = r?.[1]; if (skip(name) || _norm(name).includes("sub-total")) continue; out.push({ id: uid(), name: String(name), purpose: r[bp1 - 1] ? String(r[bp1 - 1]) : "", byPeriod: Array.from({ length: nb }, (_, bp) => +r[bp1 + bp] || 0) }); } return out; };
  const readCostSec = (aoa) => { if (!aoa) return []; const hd = hdrRow(aoa); if (hd < 0) return []; const map = {}; let period = 0;
    for (let i = hd + 1; i < aoa.length; i++) { const r = aoa[i], m = secMarker(r); if (m) { period = secIsTotal(r) ? +m[1] : (+m[1] - 1); continue; } if (period < 0 || period >= nb) continue; const desc = r?.[1]; if (skip(desc)) continue; const k = String(desc); if (!map[k]) map[k] = { id: uid(), desc: k, basis: r[3] ? String(r[3]) : "", justification: r[4] ? String(r[4]) : "", byPeriod: Array(nb).fill(0) }; map[k].byPeriod[period] = +r[2] || 0; } return Object.values(map); };
  const readIndirect = (aoa) => { const base = "total_direct"; if (!aoa) return { base, rates: [] }; const h = aoa.findIndex(r => _colOf(r, "budget period 1") >= 0); if (h < 0) return { base, rates: [] }; const bp1 = _colOf(aoa[h], "budget period 1"); const rates = []; let bs = base;
    let inc = false;
    for (let i = h + 1; i < aoa.length; i++) { const r = aoa[i], lbl = r?.[0]; if (_norm(lbl).includes("indirect base")) { bs = String(r[1] || base); continue; } if (_norm(lbl).includes("indirect treatment")) { inc = _norm(r[1]).includes("new overhead"); continue; } if (skip(lbl) || _norm(lbl).includes("cost")) continue; const byPeriod = Array.from({ length: nb }, (_, bp) => +r[bp1 + bp] || 0); if (byPeriod.some(x => x) && byPeriod.every(x => Math.abs(x) <= 1.5)) rates.push({ id: uid(), label: String(lbl), byPeriod }); } return { base: bs, rates, incremental: inc }; };

  const categories = {
    personnel: readPersonnel(sheet("personnel")),
    fringe: readFringe(sheet("fringe")),
    travel: readSectioned(sheet("travel"), (r, period) => skip(r?.[1]) ? null : ({ id: uid(), purpose: String(r[1]), departFrom: r[2] ? String(r[2]) : "", destination: r[3] ? String(r[3]) : "", days: +r[4] || 0, travelers: +r[5] || 0, lodging: +r[6] || 0, flight: +r[7] || 0, vehicle: +r[8] || 0, perDiem: +r[9] || 0, basis: r[11] ? String(r[11]) : "", period })),
    equipment: readSectioned(sheet("equipment"), (r, period) => skip(r?.[1]) ? null : ({ id: uid(), item: String(r[1]), qty: +r[2] || 0, unitCost: +r[3] || 0, basis: r[5] ? String(r[5]) : "", justification: r[6] ? String(r[6]) : "", period })),
    supplies: readSectioned(sheet("supplies"), (r, period) => skip(r?.[1]) ? null : ({ id: uid(), item: String(r[1]), qty: +r[2] || 0, unitCost: +r[3] || 0, basis: r[5] ? String(r[5]) : "", justification: r[6] ? String(r[6]) : "", period })),
    contractual: readColumnar(sheet("contractual")),
    construction: readCostSec(sheet("construction")),
    other: readCostSec(sheet("h. other", "other direct")),
    indirect: readIndirect(sheet("indirect")),
  };
  let costSharePct = 0; if (summary) { const ci = summary.findIndex(r => _norm(r?.[0]).includes("cost-share %")); if (ci >= 0) costSharePct = (+summary[ci][1] || 0) / 100; }
  if (!costSharePct) { const cs = sheet("cost share"); if (cs) for (const r of cs) { if (_norm((r || []).join(" ")).includes("cost share percentage")) { const v = (r || []).find(x => typeof x === "number" && x > 0 && x <= 1); if (v) { costSharePct = v; break; } } } }
  // Recover the funder and billing terms the export writes into the Cost Categories sheet (the "Funder"
  // and "Billing" rows). These aren't part of the DOE template proper — so a template-only import won't
  // have them and they stay undefined — but when the workbook DID come from our own export, reading them
  // back narrows the gap between export and import instead of silently dropping to defaults.
  let funder, reimburseTiming;
  if (summary) {
    const fi = summary.findIndex(r => _norm(r?.[0]) === "funder");
    if (fi >= 0 && summary[fi][1]) funder = String(summary[fi][1]);
    const bi = summary.findIndex(r => _norm(r?.[0]) === "billing");
    if (bi >= 0 && summary[bi][1]) {
      const label = String(summary[bi][1]);
      const match = Object.entries(TIMING_LABEL).find(([, v]) => v === label);
      if (match) reimburseTiming = match[0];
    }
  }
  // only include recovered fields when present, so a template import returns the same shape as before
  const extra = {};
  if (funder) extra.funder = funder;
  if (reimburseTiming) extra.reimburseTiming = reimburseTiming;
  return { periods, categories, costSharePct, ...extra };
}

export function parseScheduleAoa(aoa) {
  const h = aoa.findIndex(r => _norm(r?.[0]).startsWith("milestone") && (_norm(r?.[2]).includes("payment") || _norm(r?.[1]).includes("month")));
  const out = [];
  for (let i = h + 1; h >= 0 && i < aoa.length; i++) {
    const r = aoa[i]; if (!r || _norm(r[0]) === "") continue;
    out.push({ id: uid(), label: String(r[0]), month: floorM(+r[1] || 0), payment: +r[2] || 0 });
  }
  return out;
}
