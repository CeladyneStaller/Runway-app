// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { daysInMonth } from "./time.js";

// The three confidence tiers, in cycle order. Single source — the projection gate, the normaliser and
// both cycle buttons all read this.
export const TIERS = ["committed", "expected", "speculative"];

// Revenue must carry a tier. buildProjection gates on toggles[confidence], and toggles[undefined] is
// falsy — so an untagged revenue line would VANISH silently rather than fail loudly. Every producer
// tags today (three of them bind the tier to `kind` in the same expression, so they cannot drift), and
// this changes no number. It makes the invariant structural rather than conventional, for whoever
// writes the sixth producer.
export const tagRevenue = (lines) => lines.map(l =>
  l.kind === "revenue" && !TIERS.includes(l.confidence) ? { ...l, confidence: "expected" } : l);

export function buildProjection(model, toggles) {
  const rows = [];
  let bal = model.cashOnHand;
  for (let m = 0; m <= model.horizon; m++) {
    let rev = 0, cost = 0, nonGrant = 0;
    for (const li of model.lineItems) {
      const active = li.cadence === "recurring"
        ? (m >= li.start && (li.end == null || m <= li.end))
        : (m === li.start);
      if (!active) continue;
      let amt = Number(li.amount) || 0;
      if (li.cadence === "recurring" && li.growthPct)
        amt = amt * Math.pow(1 + li.growthPct / 100, m - li.start);
      // "What does the business do" and "what does the balance sheet do" are different questions.
      // Financing is orthogonal to confidence so a $6M raise cannot drown a $480k quote in one trace.
      if (li.financing && !toggles.financing) continue;
      if (li.kind === "revenue") {
        // toggles[undefined] is falsy: an untagged revenue line silently contributes nothing.
        // tagRevenue() guarantees a tier before anything reaches here — do not rely on this gate to notice.
        if (!toggles[li.confidence]) continue;
        rev += amt;
        // NON-GRANT REVENUE, SPLIT OUT HERE because it is the only place that knows where a line came
        // from. Cost share must be met from money that is not the award requiring it, and this is the
        // approximation that stands in for cash provenance the engine does not have. `projectId` is
        // set by `compileGrant` on every drawdown; everything else — sales, rounds, subscriptions — is
        // eligible.
        if (!li.projectId) nonGrant += amt;
      } else {
        // Costs usually have no tier and always count. Where one IS set — fulfillment work riding on
        // a quote — it gates the same way revenue does, so you never book the cost of a win you
        // haven't counted, or the revenue of one whose cost you've hidden.
        if (li.confidence && !toggles[li.confidence]) continue;
        cost += amt;
      }
    }
    const start = bal, end = start + rev - cost;
    rows.push({ m, start, rev, cost, net: rev - cost, end, inNonGrant: nonGrant });
    bal = end;
  }
  return rows;
}

export function zeroInfo(rows, startY, startM) {
  for (const r of rows) {
    if (r.end < 0 && r.start >= 0) {
      const f = r.start / (r.start - r.end);
      const dim = daysInMonth(startY, startM + r.m);
      const day = Math.max(1, Math.round(f * dim));
      return { t: r.m + f, date: new Date(startY, startM + r.m, day), months: r.m + f };
    }
  }
  return null;
}

/** When the company is insolvent, how deep, and for how long.
 *
 *  A PROJECTION CAN DIP BELOW ZERO AND COME BACK — a grant draw lands, an invoice clears — and the
 *  arithmetic does not know that a company with no cash in January does not reach March. Anything
 *  reading the balance ON A DATE rather than the first crossing will call that March date healthy.
 *  This is the one place that knows otherwise, so nothing computes "when do we die" twice.
 *
 *  `deepest` IS THE BRIDGE. The worst balance during a hole is exactly the money that has to be found
 *  to cross it, which is what turns a colour into something somebody can act on. Held as a positive
 *  number: it is an amount required, not a balance.
 *
 *  Returns null when the balance never goes negative — the common case, and the one where this must
 *  cost nothing and change nothing.
 */
export function solvency(rows, startY, startM) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const zero = zeroInfo(rows, startY, startM);
  if (!zero) return null;

  // Every stretch below zero, not just the first: a model can cross, recover and cross again, and the
  // bridge to a date in the second hole has nothing to do with the first one.
  const holes = [];
  let open = null;
  rows.forEach((r, i) => {
    const low = Math.min(r.start, r.end);
    if (low < 0) {
      if (!open) open = { fromT: i, deepest: 0, deepestT: i };
      if (-low > open.deepest) { open.deepest = -low; open.deepestT = i; }
    } else if (open) {
      open.toT = i;
      holes.push(open);
      open = null;
    }
  });
  if (open) { open.toT = null; holes.push(open); }        // still underwater at the horizon
  if (!holes.length) return null;

  const atT = (t) => (t == null ? null
    : new Date(startY, startM + Math.floor(t), Math.max(1, Math.round((t % 1) * 28) + 1)));

  const first = holes[0];
  const deepest = Math.max(...holes.map(h => h.deepest));
  const worst = holes.find(h => h.deepest === deepest);
  const recoversT = first.toT;

  return {
    zeroT: zero.t,
    zeroAt: zero.date,
    deepest,
    deepestAt: atT(worst.deepestT),
    recoversT,
    recoversAt: atT(recoversT),
    // Null means it never comes back inside the horizon, which is a different statement from a long
    // hole and must not be rendered as one.
    daysUnderwater: recoversT == null ? null : Math.round((recoversT - zero.t) * 30.44),
    holes: holes.map(h => ({ fromT: h.fromT, toT: h.toT, deepest: h.deepest })),

    /** The bridge needed to REACH a given month offset: the worst deficit before it, not the worst
     *  overall. Using one global number would make every date after the first crossing look equally
     *  doomed, and the chart would stop discriminating between a $200 dip and a $188k hole. */
    bridgeTo(t) {
      if (!Number.isFinite(t)) return 0;
      let need = 0;
      for (const r of rows) {
        if (r.m > t) break;
        const low = Math.min(r.start, r.end);
        if (low < 0) need = Math.max(need, -low);
      }
      return need;
    },

    /** Is this month offset on the far side of the first crossing? */
    strandedAt(t) { return Number.isFinite(t) && t > zero.t; },
  };
}

export function balanceAtDate(rows, startY, startM, y, m, day) {
  const idx = (y - startY) * 12 + (m - startM);
  if (idx < 0 || idx >= rows.length) return null;
  const r = rows[idx];
  const fday = Math.min(1, Math.max(0, (day - 1) / daysInMonth(y, m)));
  return { bal: r.start + fday * (r.end - r.start), t: idx + fday };
}

// Replace the model with recorded actuals for elapsed months, then re-anchor the forecast to the latest actual.
export function anchorToActuals(rows, cashActuals, enabled) {
  if (!enabled) return rows;
  const rec = Object.keys(cashActuals || {}).map(Number)
    .filter(m => Number.isFinite(cashActuals[m]?.cash) && m >= 0 && m < rows.length)
    .sort((a, b) => a - b);
  if (!rec.length) return rows;
  const lastM = rec[rec.length - 1];
  const offset = cashActuals[lastM].cash - rows[lastM].start; // shift the forward forecast to continue from the latest actual
  const starts = rows.map((r, m) => {
    const a = cashActuals[m];
    return (m <= lastM && Number.isFinite(a?.cash)) ? a.cash : r.start + offset;
  });
  return rows.map((r, m) => {
    const start = starts[m];
    const end = (m + 1 < rows.length) ? starts[m + 1] : start + r.net;
    return { ...r, start, end, net: end - start };
  });
}

export const lineSpan = (l) => l.end == null ? l.amount : l.amount * (l.end - l.start + 1);
