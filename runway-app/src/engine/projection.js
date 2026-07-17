// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { daysInMonth } from "./time";

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
    let rev = 0, cost = 0;
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
      } else {
        // Costs usually have no tier and always count. Where one IS set — fulfillment work riding on
        // a quote — it gates the same way revenue does, so you never book the cost of a win you
        // haven't counted, or the revenue of one whose cost you've hidden.
        if (li.confidence && !toggles[li.confidence]) continue;
        cost += amt;
      }
    }
    const start = bal, end = start + rev - cost;
    rows.push({ m, start, rev, cost, net: rev - cost, end });
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
