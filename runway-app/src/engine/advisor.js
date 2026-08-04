// One tile per tab, for an advisor looking at a client.
//
// THE TILES ARE THE NAVIGATION. Each is a summary and a door: an advisor between meetings knows which
// part of the business they are worried about, and making them open the company and then find Payroll
// is a step that exists only because the software was built company-first.
//
// NOTHING HERE IS NEW ARITHMETIC, and that is the constraint this file is built under. Every figure
// already exists somewhere the tab itself uses — `buildModelParts` for payroll, `budgetTag` for pace,
// `saasSeries` for MRR, `capital.js` for the round, `msWithBal` for the next date. **If a tile ever
// disagrees with its tab, the tile is wrong by definition.**
//
// It also settles a question about loading: the tiles need the whole model, so there is no lazy path
// for the advisor view. It loads each client's document in full, exactly as the portfolio already
// does, and the tiles are free once it has.

import { buildProjection, zeroInfo } from "./projection.js";
import { buildModelFromDoc } from "./buildmodel.js";
import { spentToDate } from "./summary.js";
import { saasSeries } from "./saas.js";
import { monthTotal, isCost, lineAmount } from "./coding.js";
import { instConf } from "./capital.js";
import { commitmentPressure } from "./commitments.js";

const clean = (n) => (Number.isFinite(n) ? n : 0);
const sum = (xs) => xs.reduce((a, b) => a + clean(b), 0);
const pct = (n) => `${Math.round(n * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function rowsOf(doc, parts) {
  if (Array.isArray(parts?.rows) && parts.rows.length) return parts.rows;
  try {
    return buildProjection(parts?.model || buildModelFromDoc(doc), doc.settings?.toggles || {}) || [];
  } catch { return []; }
}

// ---- one builder per tab ------------------------------------------------------
// Each returns { value, sub, tone } or null. `null` means the tile does not apply to this company —
// which is different from a zero, and must not render as one.

const flowTile = (doc, parts) => {
  const rows = rowsOf(doc, parts);
  if (!rows.length) return null;
  const net = sum(rows.slice(0, 3).map(r => r.net)) / 3;
  const avg = sum(rows.slice(0, 6).map(r => r.net)) / Math.max(1, Math.min(6, rows.length));
  return {
    value: net, format: "money",
    sub: `net per month · 6-mo avg ${avg < 0 ? "−" : ""}${Math.abs(Math.round(avg / 1000))}k`,
    tone: net < 0 ? "danger" : "signal",
  };
};

const payTile = (doc, parts) => {
  const emp = doc.employees || [];
  if (!emp.length) return null;
  // `payrollNow` AND `derivedBurn` ARE ALREADY COMPUTED by `buildModelParts` — the first attempt summed
  // `l.amounts[0]` across `employeeLines`, and those lines carry a flat `amount` with no per-month
  // array, so every payroll tile read "0k/mo · 0% of burn". A plausible zero is worse than an error:
  // nothing failed, and the tile simply lied.
  const nowPay = clean(parts?.payrollNow);
  const burn = clean(parts?.derivedBurn) || nowPay;
  const starting = emp.filter(e => clean(e.startM) > 0 && clean(e.startM) <= 3).length;
  return {
    value: emp.length, format: "count", unit: "FTE",
    sub: `${Math.round(nowPay / 1000)}k/mo · ${burn ? pct(nowPay / burn) : "—"} of burn`,
    // A flag rather than a colour: hires ahead are worth noticing, not worth alarm.
    flag: starting ? `${plural(starting, "hire starts", "hires start")} within three months` : null,
    tone: "signal",
  };
};

const projTile = (doc, parts) => {
  const rp = (parts?.rProjects || []).filter(p => p.stage !== "prospective");
  if (!rp.length) return null;
  const unspent = sum(rp.map(p => Math.max(0, clean(p.budget) - clean(spentToDate(p.actuals)))));
  const ahead = rp.filter(p => {
    const b = clean(p.budget);
    return b > 0 && (clean(spentToDate(p.actuals)) / b) > clean(p.elapsedPct) + 0.15;
  }).length;
  return {
    value: rp.length, format: "count", unit: rp.length === 1 ? "project" : "projects",
    sub: `${Math.round(unspent / 1000)}k unspent${ahead ? ` · ${ahead} ahead of pace` : ""}`,
    tone: ahead ? "danger" : "signal",
  };
};

const salesTile = (doc, parts) => {
  const saas = doc.saas || [];
  if (!saas.length) return null;
  const mrr = sum(saas.map(x => clean(saasSeries(x, 12).find(p => p.month === 0)?.mrr)));
  const rows = rowsOf(doc, parts);
  const out = Math.abs(clean(rows[0]?.out));
  return {
    value: mrr, format: "money",
    sub: out ? `MRR · ${(mrr / out).toFixed(1)} mo of cover` : "MRR",
    tone: "signal",
  };
};

const invTile = (doc, parts) => {
  const open = (doc.rounds || []).filter(r => clean(r.amount) > 0 && r.status !== "closed");
  if (!open.length) return null;
  const biggest = open.reduce((a, b) => (clean(b.amount) > clean(a.amount) ? b : a));
  // The runway AT the close is the number that matters — a round that lands after the money runs out
  // is not a plan, and this is the same question the Investment goals chart asks.
  const rows = rowsOf(doc, parts);
  const z = zeroInfo(rows, doc.startY, doc.startM);
  const closeM = clean(biggest.closeMonth);
  const left = z && Number.isFinite(z.months) ? z.months - closeM : null;
  return {
    value: clean(biggest.amount), format: "money",
    sub: `${biggest.name || "round"}${left != null
      ? ` · ${left < 0 ? "closes after the cash" : `${left.toFixed(1)} mo left at close`}` : ""}`,
    tone: left != null && left < 1 ? "danger" : instConf(biggest) === "speculative" ? "muted" : "signal",
  };
};

const histTile = (doc, parts) => {
  const hist = (doc.history || []).slice(-6);
  if (!hist.length) return null;
  const rows = rowsOf(doc, parts);
  const planned = sum(hist.map((_, i) => Math.abs(clean(rows[i]?.out))));
  const actual = sum(hist.map(h => clean(monthTotal(h))));
  const drift = planned ? (actual - planned) / planned : 0;
  const over = Math.abs(drift) > 0.05;
  return {
    value: drift, format: "signedPercent",
    sub: over ? `over plan across ${plural(hist.length, "month", "months")}` : "close to plan",
    tone: drift > 0.05 ? "caution" : "signal",
  };
};

const msTile = (doc, parts) => {
  const ms = (parts?.msWithBal || []).filter(m => clean(m.t) >= 0);
  if (!ms.length) return null;
  const next = ms[0];
  const state = next.stranded ? "unreachable"
    : next.target > 0 && clean(next.gap) < 0 ? `${Math.round(Math.abs(next.gap) / 1000)}k short`
    : next.target > 0 ? "target met" : `${Math.round(clean(next.bal) / 1000)}k`;
  return {
    value: next.dueLabel || next.label, format: "text",
    sub: `${next.label} · ${state}`,
    tone: next.stranded ? "danger" : next.target > 0 && clean(next.gap) < 0 ? "caution" : "signal",
  };
};

const scnTile = (doc, parts) => {
  const mine = parts?.myScenarios;
  if (!Array.isArray(mine)) return null;         // not loaded, which is not "none"
  const offered = mine.filter(s => s._shared && !s._decision).length;
  const declined = mine.filter(s => s._decision === "declined").length;
  const bits = [offered && `${offered} offered`, declined && `${declined} declined`].filter(Boolean);
  return {
    value: mine.length, format: "count", unit: mine.length === 1 ? "scenario" : "scenarios",
    sub: bits.length ? `yours · ${bits.join(", ")}` : "yours",
    tone: declined ? "caution" : "signal",
  };
};

const cmtTile = (doc, parts) => {
  let p = null;
  try { p = commitmentPressure(doc, rowsOf(doc, parts)); } catch { p = null; }
  if (!p) return null;
  return {
    value: p.unpaid, format: "money",
    sub: p.uncovered > 0
      ? `signed · ${Math.round(p.uncovered / 1000)}k uncovered`
      : p.coveredMonths != null ? `signed · covered ${p.coveredMonths.toFixed(1)} mo` : "signed",
    tone: p.uncovered > 0 ? "danger" : "signal",
  };
};

/** Which tab each tile belongs to, in the order the rail shows them. */
export const TILES = Object.freeze([
  { view: "flow", label: "Cash flow", build: flowTile },
  { view: "pay", label: "Payroll", build: payTile },
  { view: "proj", label: "Projects", build: projTile },
  { view: "sales", label: "Sales", build: salesTile },
  { view: "inv", label: "Investment", build: invTile },
  { view: "hist", label: "Spend history", build: histTile },
  { view: "ms", label: "Milestones", build: msTile },
  { view: "cmt", label: "Commitments", build: cmtTile },
  { view: "scn", label: "Scenarios", build: scnTile },
]);

/** Build every tile that applies, honouring what the company has turned off.
 *
 *  TAB VISIBILITY IS READ, NOT REINVENTED. A company that turned off Sales gets no Sales tile — an
 *  advisor should not see a door into a room the company closed, and `company_tabs` plus the role gate
 *  already decide this for every other surface.
 *
 *  Never throws: these read optional fields off somebody else's document, and one bad client model
 *  must not take down a portfolio of twenty.
 */
export function advisorTiles(doc, parts, { hidden = [], canSee = () => true } = {}) {
  // NO DOCUMENT IS NOT AN EMPTY COMPANY. Without this, `rowsOf` happily builds a projection from `{}`
  // and the cash-flow tile reports a burn of zero for a client whose model failed to load — the
  // portfolio's "could not read this model" state, contradicted by a tile beside it.
  if (!doc || typeof doc !== "object") return [];

  const out = [];
  for (const t of TILES) {
    if (hidden.includes(t.view)) continue;
    if (!canSee(t.view)) continue;
    let tile = null;
    try { tile = t.build(doc || {}, parts || {}); } catch { tile = null; }
    if (tile) out.push({ view: t.view, label: t.label, ...tile });
  }
  return out;
}
