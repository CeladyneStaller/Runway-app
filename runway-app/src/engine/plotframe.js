// ── The plot frame: one answer to "where is zero on this canvas" ─────────────────────────────────
//
// ⚠️ THREE RENDERERS EACH DEFINED THEIR OWN `x` AND `y`. Chart.jsx, RunwayChart.jsx and
// ProjectChart.jsx all computed their own scales, and two carried their own padding — three
// independent answers to the same question. A gridline two pixels off its own baseline is the kind of
// bug nobody reports and everybody notices.
//
// THIS MODULE OWNS THE GEOMETRY, NOT JUST THE DECORATION. Drawing chrome while each renderer kept its
// own scales would have left them free to disagree, which is the failure this extraction exists to
// remove.
//
// Pure functions only — no JSX — so the whole thing is testable without a DOM.

/** Four rules, always. Not adaptive.
 *
 *  ADAPTIVE COUNTS MEAN TWO CHARTS ON ONE SCREEN DISAGREE about where the rules sit, which reads as a
 *  difference in the data rather than a difference in height.
 */
export const RULE_COUNT = 4;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Money, as this product writes it: `412k`, one unit all the way up the axis.
 *
 *  ⚠️ MIXED MAGNITUDES STAY IN ONE UNIT. Switching to `1.24M` halfway up an axis nobody expects to
 *  change scale is how a reader misjudges a magnitude by three orders.
 */
export function moneyTick(v) {
  const n = Number(v) || 0;
  if (n === 0) return "0";
  const sign = n < 0 ? "-" : "";
  const k = Math.abs(n) / 1000;
  if (k < 1) return `${sign}${Math.round(Math.abs(n))}`;
  const s = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
  return `${sign}${s.toLocaleString("en-US")}k`;
}

/** A month label, with the year where it is needed and nowhere else.
 *
 *  ⚠️ THE FIRST LABEL AND EVERY JANUARY CARRY THE YEAR. Corey's rule, and it replaced mine — I had
 *  "January only" plus a fallback for windows containing no January, plus another for phone widths that
 *  drop it. TWO EXCEPTIONS TO A RULE THAT FIRES "USUALLY" IS A RULE THAT FAILS IN THE CASES NOBODY
 *  TESTS. One extra label removes both.
 */
export function monthTick(startY, startM, i, { first = false } = {}) {
  const d = new Date(startY, startM + i, 1);
  const name = MONTHS[d.getMonth()];
  const showYear = first || d.getMonth() === 0;
  return showYear ? `${name} ${String(d.getFullYear()).slice(2)}` : name;
}

/** Which month indices get a label, thinning on a FIXED SEQUENCE as width shrinks.
 *
 *  Every month, then every third, then every sixth, then first and last. Choosing an arbitrary spacing
 *  per width would make the same chart label differently on two devices.
 */
export function monthTicks(n, width) {
  if (n <= 1) return [{ i: 0, year: true }];
  const per = width < 380 ? 96 : width < 620 ? 74 : 58;   // px a bare month label needs
  const room = Math.max(2, Math.floor(width / per));
  let step = 12;
  for (const s of [1, 3, 6, 12]) if (Math.ceil(n / s) <= room) { step = s; break; }

  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);

  // ⚠️ EVERY LABEL TAKES THE YEAR IF THEY ALL FIT WITH ONE — measured, not a per-chart exception.
  //
  // Corey noticed the runway chart carrying a year on every tick and preferred it. That chart labels
  // every 2–6 months, which is exactly the case where the years cost nothing: the ONLY reason to omit
  // them is a smear, and at six labels there is no smear to avoid. Deriving it from the same width
  // measurement that already picked the step keeps this ONE rule rather than "except on the runway
  // chart" — which is the conditional-rule trap that made the first version of this worse.
  const perYear = per * 1.35;                             // "Jul 26" against "Jul"

  // ⚠️ A REPEATED MONTH NAME FORCES YEARS, whatever the width.
  //
  // At a twelve-month step every label is the same month: "Jul 26 · Jul · Jul · Jun" — three Julys in
  // three different years, indistinguishable. The fit test alone produced exactly that on a 36-month
  // phone chart. This checks the AMBIGUITY DIRECTLY rather than a proxy for it, so it also catches the
  // six-month step where the anchoring January happens to fall outside the window.
  const repeats = new Set(idx.map(i => i % 12)).size < idx.length;

  const allYears = repeats || idx.length * perYear <= width;
  return idx.map(i => ({ i, year: allYears || i === 0 }));
}

/** Evenly spaced rule values across a domain, including both ends. */
export function ruleValues(yMin, yMax, count = RULE_COUNT) {
  const span = yMax - yMin;
  if (!Number.isFinite(span) || span === 0) return [yMax];
  return Array.from({ length: count + 1 }, (_, i) => yMax - (span * i) / count);
}

/** ⚠️ A MONEY AXIS INCLUDES ZERO. ALWAYS.
 *
 *  Starting at 300k because the data sits between 300k and 600k doubles the apparent slope of a
 *  decline. In a product whose whole job is telling somebody how fast their money is going, that is not
 *  a styling choice.
 */
export function domainFor(values, { includeZero = true } = {}) {
  const nums = (values || []).filter(Number.isFinite);
  if (!nums.length) return { yMin: 0, yMax: 1 };
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { hi = lo + 1; }
  // A little headroom so a peak does not touch the frame.
  const pad = (hi - lo) * 0.06;
  return { yMin: lo - (lo < 0 ? pad : 0), yMax: hi + pad };
}

/** ⚠️ VERTICAL RULES ONLY WHERE NOTHING ELSE DIVIDES THE MONTHS.
 *
 *  Bars and stacks already separate them; drawing rules between them puts a line through every gap and
 *  makes the chart read as a table.
 */
export const wantsVerticals = (shape) => shape === "line" || shape === "band" || shape === "area";

/** ⚠️ THE LEGEND SWITCHES ON SERIES COUNT, not on a setting.
 *
 *  One or two series get their name at the end of the line, where the eye already is. Three or more get
 *  a swatch row, because end labels collide. Offering this as an option would be a setting nobody finds
 *  and a second way for two charts to disagree.
 */
export const legendMode = (count) => (count <= 2 ? "endpoint" : count === 0 ? "none" : "swatch");

/** The frame. Scales, geometry, and everything a renderer needs to place its own series. */
export function plotFrame({
  w = 720, h = 252, yMin = 0, yMax = 1, n = 1, startY, startM,
  shape = "line", pad,
} = {}) {
  const P = pad || { l: 52, r: 16, t: 14, b: 38 };
  const pw = w - P.l - P.r;
  const ph = h - P.t - P.b;
  const span = (yMax - yMin) || 1;

  const x = (i) => P.l + (n <= 1 ? pw / 2 : (Math.max(0, Math.min(i, n - 1)) / (n - 1)) * pw);

  // ⚠️ A SECOND X MODE, BECAUSE TWO RENDERERS ARE NOT INDEX-BASED. `ProjectChart` and `RunwayChart`
  // place marks at a CONTINUOUS position in a time domain (`t / tMax`), not at the i-th of n months —
  // a milestone at month 6.5 is a real thing. Forcing them into the index model to share a frame would
  // have moved every marker, which is the opposite of what this extraction is for.
  const xt = (t, tMax) => P.l + (!tMax ? 0 : (Math.max(0, Math.min(t, tMax)) / tMax) * pw);
  const y = (v) => P.t + ph - ((Number(v) || 0) - yMin) / span * ph;

  const rules = ruleValues(yMin, yMax).map(v => ({ v, y: y(v), label: moneyTick(v) }));
  const ticks = monthTicks(n, w).map(({ i, year }) => ({
    i, x: x(i),
    label: Number.isFinite(startY) ? monthTick(startY, startM, i, { first: year }) : String(i),
  }));

  return {
    x, xt, y, pad: P, pw, ph, w, h, n,
    inner: { x: P.l, y: P.t, w: pw, h: ph },
    rules, ticks,
    verticals: wantsVerticals(shape) ? ticks.filter(t => t.i !== 0 && t.i !== n - 1) : [],
    // ZERO IS DRAWN HEAVIER THAN ANY RULE and is never one of the four — it is a real event in this
    // product, not a gridline that happens to sit there.
    zeroY: yMin <= 0 && yMax >= 0 ? y(0) : null,
    legend: legendMode,
  };
}
