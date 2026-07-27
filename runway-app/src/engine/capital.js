// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { clampM, daysInMonth, floorM } from "./time.js";

export const INST_KINDS = [["equity", "Priced round"], ["safe", "SAFE"], ["note", "Convertible note"], ["debt", "Venture debt"]];

export const INST_KIND_LABEL = Object.fromEntries(INST_KINDS);

// One 4-state spine; each kind renders its own vocabulary for the same underlying certainty.
export const INST_STATUS = ["planning", "raising", "committed", "closed"];

export const STATUS_LABEL = {
  equity: { planning: "Planning", raising: "Raising", committed: "Term sheet", closed: "Closed" },
  safe:   { planning: "Planning", raising: "Raising", committed: "Signed", closed: "Funded" },
  note:   { planning: "Planning", raising: "Raising", committed: "Signed", closed: "Funded" },
  debt:   { planning: "Planning", raising: "Raising", committed: "Commitment letter", closed: "Drawn" },
};

// A term sheet is EXPECTED, not committed: it isn't money until it's wired, and term sheets die in
// diligence. `committed` means contractually obligated or already banked.
export const INST_CONF = { planning: "speculative", raising: "speculative", committed: "expected", closed: "committed" };

export const instConf = (x) => x.confAuto === false && x.confidence ? x.confidence : (INST_CONF[x.status] || "speculative");

export const instLabel = (x) => (STATUS_LABEL[x.kind] || STATUS_LABEL.equity)[x.status] || x.status;

export const GOAL_KINDS = [["technical", "Technical"], ["commercial", "Commercial"], ["regulatory", "Regulatory"], ["team", "Team"], ["financial", "Financial"]];

export const GOAL_KIND_LABEL = Object.fromEntries(GOAL_KINDS);

export const GOAL_STATUS = { done: ["Done", "var(--signal-ink)", "rgba(16,135,107,.12)"], "on-track": ["On track", "var(--signal-ink)", "rgba(16,135,107,.12)"],
  "at-risk": ["At risk", "var(--caution)", "rgba(201,130,27,.14)"], "not-started": ["Not started", "var(--muted)", "var(--line-2)"] };

// A close date IS a critical date. Derive it rather than asking anyone to keep two copies in step —
// move the close in Investment and the milestone, the chart marker and the balance all follow.
export const roundMS = (rounds, START_Y, START_M) => (rounds || []).filter(r => r.kind === "equity" && r.status !== "closed" && r.closeMonth != null).map(r => {
  const d = new Date(START_Y, START_M + clampM(r.closeMonth), 1);
  const y = d.getFullYear(), m = d.getMonth();
  return { id: `round-${r.id}`, label: `${r.name} close`, y, m, day: daysInMonth(y, m), fromRound: r.id };
});

export const postMoney = (r) => (r.preMoney || 0) + (r.amount || 0);

export const dilution = (r) => { const pm = postMoney(r); return pm > 0 ? (r.amount || 0) / pm : 0; };

// A SAFE/note converts at the FIRST priced round closing at or after it does. Nothing converts if no
// round is on the timeline — that's the maturity problem, handled separately.
export const convertsAt = (x, all) => (all || []).filter(r => r.kind === "equity" && (r.closeMonth ?? 0) >= (x.closeMonth ?? 0))
  .sort((a, b) => (a.closeMonth ?? 0) - (b.closeMonth ?? 0))[0] || null;

export const accrued = (x, atMonth) => x.kind !== "note" ? 0
  : (x.amount || 0) * ((x.interestPct || 0) / 100) * Math.max(0, (atMonth - (x.closeMonth ?? 0)) / 12);

// What the instrument costs you in ownership when it converts.
//  post-money cap : ownership = principal / cap. Exact, closed-form, and the holder is NOT diluted by
//                   the new money — that is the entire point of the post-money SAFE.
//  pre-money cap  : circular across multiple SAFEs (each one's price depends on the others converting
//                   at the same instant). We take the single-instrument approximation and SAY SO.
export const convOwnership = (x, round) => {
  if (!round) return 0;
  const principal = (x.amount || 0) + accrued(x, round.closeMonth ?? 0);
  if (x.capType === "post") return (x.cap > 0) ? principal / x.cap : 0;
  const capVal = x.cap > 0 ? x.cap : Infinity;
  const discVal = (round.preMoney || 0) * (1 - (x.discount || 0));
  const conv = Math.min(capVal, discVal);
  return conv > 0 ? principal / conv : 0;
};

export const isApprox = (x) => x.capType !== "post" && (x.kind === "safe" || x.kind === "note");

// Level-payment amortisation. Venture debt is interest-only, then P&I, then usually a final payment —
// and the final payment is the one nobody has on their calendar.
export const debtLines = (x, conf) => {
  const out = [], amt = x.amount || 0, close = x.closeMonth ?? 0;
  const r = (x.rateAPR || 0) / 100 / 12, io = x.ioMonths || 0, term = Math.max(1, x.termMonths || 36);
  // Fixed ROI: "pay back 1.5x over 48 months" is a total obligation, not an interest rate. No
  // amortisation to solve — the number is agreed up front and divided by the term.
  if (x.repayMode === "multiple") {
    const total = amt * (x.repayMultiple || 1.5);
    out.push({ confidence: conf, financing: true, instId: x.id, kind: "cost", cadence: "recurring",
      label: `${x.name} · repayment (${x.repayMultiple || 1.5}x)`, amount: total / term,
      start: floorM(close + io + 1), end: floorM(close + io + term) });
    return out;
  }
  const nAmort = Math.max(1, term - io);
  const tag = { confidence: conf, financing: true, instId: x.id, kind: "cost" };
  if (io > 0) out.push({ ...tag, label: `${x.name} · interest only`, cadence: "recurring",
    amount: amt * r, start: floorM(close + 1), end: floorM(close + io) });
  const pmt = r > 0 ? amt * (r * Math.pow(1 + r, nAmort)) / (Math.pow(1 + r, nAmort) - 1) : amt / nAmort;
  out.push({ ...tag, label: `${x.name} · principal & interest`, cadence: "recurring",
    amount: pmt, start: floorM(close + io + 1), end: floorM(close + term) });
  if (x.finalPct > 0) out.push({ ...tag, label: `${x.name} · final payment`, cadence: "onetime",
    amount: amt * x.finalPct, start: floorM(close + term) });
  return out;
};

// Cash in, cash out. The DRAW is skipped once closed — that money is already in cash on hand — but the
// OBLIGATIONS are not: a drawn loan still has to be repaid, and a funded note still matures.
export const compileInstrument = (x, all) => {
  const lines = [], conf = instConf(x), amt = x.amount || 0, close = floorM(x.closeMonth ?? 6);
  const tag = { financing: true, instId: x.id };
  if (x.status !== "closed" && amt > 0) {
    if (x.kind === "equity" && (x.committedAmount || 0) > 0) {
      // A round is not one tier. $2M circled of $6M is two certainties in one row.
      const c = Math.min(x.committedAmount, amt);
      lines.push({ ...tag, label: `${x.name} · committed`, cadence: "onetime", kind: "revenue", amount: c, start: close, confidence: conf });
      if (amt - c > 0.01) lines.push({ ...tag, label: `${x.name} · balance of round`, cadence: "onetime", kind: "revenue", amount: amt - c, start: close, confidence: "speculative" });
    } else {
      const net = x.kind === "debt" ? amt * (1 - (x.feesPct || 0)) : amt;
      lines.push({ ...tag, label: `${x.name} · ${x.kind === "debt" ? "draw" : "close"}`, cadence: "onetime", kind: "revenue", amount: net, start: close, confidence: conf });
    }
  }
  if (x.kind === "debt") lines.push(...debtLines(x, conf));
  // A note that matures with no round to convert into is a cash event, not a footnote.
  // A royalty note has no maturity date: it repays a share of the business until a cap is satisfied,
  // however long that takes. There is no cliff to model — and the payments themselves are ENDOGENOUS,
  // the first cost in this engine that would depend on the projection's own output. See royaltyVerdict.
  if (x.kind === "note" && x.atMaturity !== "convert" && x.atMaturity !== "royalty" && !x.assumeExtended) {
    const conv = convertsAt(x, all), mat = floorM((x.closeMonth ?? 0) + (x.maturityMonths || 24));
    if (!conv || (conv.closeMonth ?? 0) > mat) lines.push({ ...tag, label: `${x.name} · repaid at maturity`,
      cadence: "onetime", kind: "cost", amount: (x.amount || 0) + accrued(x, mat), start: mat, confidence: conf });
  }
  return lines;
};

// What a royalty note can honestly say inside an 18-month cash model.
//   - the trigger is cumulative revenue, which this engine knows exactly
//   - the cap counts cumulative ROYALTY PAYMENTS, not the total return: pay until paid × multiple
//   - the royalty base is often "profit", which this app DOES NOT HAVE. `net` is cash flow: it
//     expenses equipment on purchase, never depreciates, counts debt principal as a cost, and has no
//     accruals. A royalty on that number would be a different quantity sharing a name.
// So: report whether the trigger fires, and refuse to invent the schedule.
export const royaltyVerdict = (x, rows) => {
  if (x.kind !== "note" || x.atMaturity !== "royalty" || !rows?.length) return null;
  const trig = x.triggerAmount || 0;
  let cum = 0, fires = null;
  for (let m = 0; m < rows.length; m++) { cum += rows[m].rev || 0; if (fires === null && cum >= trig && trig > 0) fires = m; }
  return { cum, fires, trig, cap: (x.amount || 0) * (x.capMultiple || 5), knowable: (x.royaltyBase || "profit") === "revenue" };
};

// The covenant is what actually kills you. Interest is a rounding error next to a minimum-cash floor
// that lets the lender call the whole loan at the exact moment you cannot pay it.
export const covenantBreach = (x, rows) => {
  if (x.kind !== "debt" || !(x.covenantCash > 0) || !rows?.length) return null;
  const from = floorM(x.closeMonth ?? 0), to = Math.min(rows.length - 1, floorM((x.closeMonth ?? 0) + (x.termMonths || 36)));
  for (let m = from; m <= to; m++) if (rows[m].start < x.covenantCash) return { month: m, cash: rows[m].start, floor: x.covenantCash };
  return null;
};
