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

export function zeroInfo(rows, startY, startM, from = 0) {
  // `from` IS THE FIRST MONTH A FORWARD-LOOKING QUESTION CAN BE ASKED ABOUT. Defaulted to 0 so every
  // existing caller is unaffected; the golden canary builds from seed data with no actuals, where the
  // window is 0 anyway.
  //
  // ⚠️ ALREADY OUT IS AN ANSWER. If the window opens on a month that is ALREADY negative, there is no
  // solvent-to-insolvent crossing left to find and the loop below would return null — "never runs out",
  // which is the most dangerous possible wrong answer. Zero months, at the window.
  const w = Math.max(0, Math.min(from, rows.length - 1));
  if (rows[w] && rows[w].start < 0) {
    const at = new Date(startY, startM + w, 1);
    return { t: w, date: at, months: w, fromNow: monthsFromNow(at), alreadyOut: true };
  }
  for (const r of rows.slice(w)) {
    if (r.end < 0 && r.start >= 0) {
      const f = r.start / (r.start - r.end);
      const dim = daysInMonth(startY, startM + r.m);
      const day = Math.max(1, Math.round(f * dim));
      const at = new Date(startY, startM + r.m, day);
      // `months` STAYS AS THE INDEX FROM MODEL START — the golden canary and every internal comparison
      // depend on it. `fromNow` is what a person should be shown.
      return { t: r.m + f, date: at, months: r.m + f, fromNow: monthsFromNow(at) };
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
/** @param {number} from    First month to consider. Elapsed months are history, not forecast.
 *  @param {number} through Last month to consider. Bounds the bridge to what a chart actually draws.
 *
 *  ⚠️ BOTH ENDS MATTER, FOR DIFFERENT REASONS.
 *
 *  `from` — a hole the company already crossed is not a hole it faces. Without this, a model that
 *  dipped negative four months ago and recovered reports that crossing as the upcoming one, and every
 *  milestone gets judged `stranded` against a date already survived. It also let the dashboard show
 *  TWO zero dates from ONE row set: the headline passed a window to `zeroInfo` and this did not.
 *  Recorded cash already reflects the survival, so counting it here counts it twice.
 *
 *  `through` — `deepest` is a bridge figure, the money someone reads as "what I need to raise". On a
 *  committed-only line the deficit grows without bound, so the deepest point drifts to the horizon and
 *  describes a month no chart draws: $3,230,627 at month 36 on the canary, against an 18-month plot.
 *  A number nobody can see on the screen that produced it is not a number to raise against.
 *
 *  Both default to the full range, so every existing caller behaves exactly as before.
 */
export function solvency(rows, startY, startM, from = 0, through = Infinity) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const zero = zeroInfo(rows, startY, startM, from);
  if (!zero) return null;

  // Every stretch below zero, not just the first: a model can cross, recover and cross again, and the
  // bridge to a date in the second hole has nothing to do with the first one.
  const holes = [];
  let open = null;
  rows.forEach((r, i) => {
    if (i < from || i > through) return;
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
export function anchorToActuals(rows, cashActuals, enabled, maxMonth = null) {
  if (!enabled) return rows;
  const rec = Object.keys(cashActuals || {}).map(Number)
    // ⚠️ FUTURE MONTHS DO NOT ANCHOR. A figure typed against next quarter is a forecast somebody is
    // sketching, not a fact — letting it set `starts[m]` would rewrite the projection to agree with a
    // guess, and the offset it produced would shift every month after it.
    .filter(m => Number.isFinite(cashActuals[m]?.cash) && m >= 0 && m < rows.length
                 && m <= (maxMonth ?? Infinity))
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

/** The first month a forward-looking question can be asked about.
 *
 *  TODAY'S MONTH, NOT THE LAST RECORDED ENTRY. A cash figure is the balance at the START of a month, so
 *  an entry for the CURRENT month is a real anchor AND the month is still in progress — it is a month
 *  you can still act on, and the last one you can. Anchoring to the last entry would close it early and
 *  stop asking questions about the month somebody is living in.
 *
 *  ROUNDS DOWN: a month becomes canon on the first day of the NEXT month. A large purchase on the 28th
 *  is already in the model as a forecast line, and closing the month before it lands would count the
 *  forecast and then the actual.
 *
 *  A MODEL THAT STARTS IN THE FUTURE asks from its own month 0 — there is no history to skip.
 */
export function forecastFrom(doc, today = new Date()) {
  if (!doc || !Number.isFinite(doc.startY) || !Number.isFinite(doc.startM)) return 0;
  const m = (today.getFullYear() - doc.startY) * 12 + (today.getMonth() - doc.startM);
  return Math.max(0, m);
}

/** How many months from TODAY a dated figure is.
 *
 *  ⚠️ `zeroInfo().months` AND `coveredMonths` ARE BOTH MEASURED FROM THE MODEL'S START, because that is
 *  the index the projection walks. Shown to somebody as "5.6 mo" they read "five and a half months from
 *  now" — and for a model started in January and opened in June, that is wrong by five months in the
 *  reassuring direction.
 *
 *  Derived from the DATE rather than by subtracting indices, so it is right whether the model starts in
 *  the past or the future, and returns 0 rather than a negative for a date already gone.
 */
export function monthsFromNow(date, today = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const whole = (date.getFullYear() - today.getFullYear()) * 12 + (date.getMonth() - today.getMonth());
  const dim = daysInMonth(date.getFullYear(), date.getMonth());
  const frac = (date.getDate() - today.getDate()) / dim;
  return Math.max(0, whole + frac);
}
