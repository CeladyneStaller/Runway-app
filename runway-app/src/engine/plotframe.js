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
export function monthTicks(n, width, { yearEvery = false, startY, startM } = {}) {
  if (n <= 1) return [{ i: 0, year: true }];
  const per = width < 380 ? 96 : width < 620 ? 74 : 58;   // px a label needs
  const room = Math.max(2, Math.floor(width / per));
  let step = 12;
  for (const s of [1, 3, 6, 12]) if (Math.ceil(n / s) <= room) { step = s; break; }

  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);

  // ⚠️ THE RULE IS: THE FIRST LABEL SHOWN FOR EACH CALENDAR YEAR CARRIES THE YEAR.
  //
  // "First label plus every January" had a hole Corey found: **when labels thin, a chart spanning a year
  // change may show no January at all** — `Jul 26 · Jul · Jul` at a twelve-month step — and the year
  // change becomes invisible on a chart whose whole subject is when things happen.
  //
  // This rule SUBSUMES the old one rather than adding a case to it. January is the first month of its
  // year, so it still gets the year whenever it is shown; the first label is the first of its year, so
  // it still gets one; and a bare `Jul` in a new year now gets one too. **One rule, no exceptions, and
  // strictly more correct than the version it replaces.**
  const seen = new Set();
  return idx.map(i => {
    const y = Number.isFinite(startY) ? new Date(startY, (startM || 0) + i, 1).getFullYear() : null;
    const first = y != null && !seen.has(y);
    if (y != null) seen.add(y);
    return { i, year: yearEvery || first || i === 0 };
  });
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
export const legendMode = (count) => (count === 0 ? "none" : count <= 2 ? "endpoint" : "swatch");
// ⚠️ THE ZERO CHECK MUST COME FIRST. Written as `count <= 2 ? "endpoint" : count === 0 ? "none" : ...`
// the none branch was UNREACHABLE — `0 <= 2` is true — so an empty chart drew an endpoint legend. Lint
// does not flag a dead ternary branch; the test caught it the first time the suite ran.

/** The frame. Scales, geometry, and everything a renderer needs to place its own series. */
export function plotFrame({
  w = 720, h = 252, yMin = 0, yMax = 1, n = 1, startY, startM,
  shape = "line", pad, yearEvery = false,
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
  const ticks = monthTicks(n, w, { yearEvery, startY, startM }).map(({ i, year }) => ({
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


/** ⚠️ THE GUTTER IS A FUNCTION OF WHAT IS DRAWN IN IT.
 *
 *  `PAD = { l: 52, r: 16, t: 14, b: 38 }` was set before axis titles, a right axis, or a hover tooltip
 *  existed — and every element added since competed with a constant that predated it. **The right
 *  gutter is 16px and a right axis needs about 44**, so on any two-unit chart those tick labels were
 *  being drawn past the edge of the viewBox. "Cramped" was the visible half of a clipping bug.
 *
 *  A chart with one unit keeps exactly today's plot width; a chart with two pays for its second axis —
 *  which is the chart that needs the room. **Most of the 37 curated charts are single-unit and none of
 *  them shifts because the builder gained a feature.**
 */
export const BASE_PAD = Object.freeze({ l: 52, r: 16, t: 14, b: 38 });

export function padFor({ rightAxis = false, titled = false, categorical = false } = {}) {
  return {
    // A rotated title needs room OUTSIDE the tick labels, which already set this width.
    l: BASE_PAD.l + (titled ? 14 : 0),
    // FIVE TICK LABELS PLUS A TITLE. This is the clipping bug.
    r: BASE_PAD.r + (rightAxis ? 44 : 0),
    // So a title clears the frame rather than sitting on it.
    t: BASE_PAD.t + (titled ? 10 : 0),
    // Category names wrap where `Jul 26` does not.
    b: BASE_PAD.b + (categorical ? 12 : 0),
  };
}
