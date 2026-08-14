// One renderer for every tab chart.
//
// FIVE SHAPES, NOT EIGHTEEN COMPONENTS. Each chart in `engine/charts.js` describes itself in a common
// spec, so an axis, a gridline or a colour is defined once rather than in eighteen places that drift.
//
// SVG BY HAND, because the app has no chart library and adding one to draw six lines would be a
// dependency, a bundle, and a second set of visual conventions to keep in step with the rest of the UI.
//
// AN EMPTY CHART SAYS WHY. `spec.empty` is a sentence — "no spend history imported yet" — because a
// blank box looks like a bug and a sentence looks like an answer.
import React, { useMemo } from "react";
import { useStart } from "../../state/StartCtx";
import { plotFrame } from "../../engine/plotframe";
import { money } from "../../engine/money";
import { TimelineRows } from "./TimelineRows";

const W = 720, H = 252;
const PAD = { l: 52, r: 16, t: 14, b: 38 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;

// ⚠️ FIVE TONES, AND EVERYTHING ELSE FELL BACK TO `signal`. That is the four-green-bars bug at its
// source: `clay`, `brown`, `gate` and `signal-2` were never keys here, so any chart naming them drew
// green — and the fallback made it look deliberate rather than missing.
const TONE = {
  signal: "var(--signal)", "signal-2": "var(--signal-2)", muted: "var(--muted-2)",
  danger: "var(--danger)", caution: "var(--caution)", line: "var(--line-2)",
  clay: "var(--clay)", brown: "var(--brown)", gate: "var(--gate)", thrust: "var(--thrust)",
};

/** ⚠️ AN EXPLICIT `color` WINS OVER A TONE NAME.
 *
 *  A breakdown's colours are COMPUTED — hue from the type, lightness from the member — so there is no
 *  fixed token for "the second grant" and there cannot be one. `palette.js` produced those colours and
 *  this renderer discarded every one of them, because it read `tone` and nothing else.
 */
const tone = (t) => TONE[t] || TONE.signal;
const colorOf = (s) => s?.color || tone(s?.tone);

/** ⚠️ SIGN COLOURING ASSIGNS COLOUR BY VALUE; THE PALETTE ASSIGNS IT BY IDENTITY. Both want the same
 *  channel and cannot share it — four projects all sign-coloured are four red-and-green series nobody
 *  can tell apart, which is the four-green-bars bug with a different cause. `buildCustom` refuses the
 *  combination; this only draws it.
 */
const signColor = (v) => (clean(v) < 0 ? TONE.danger : TONE.signal);

/** Split a series at its INTERPOLATED zero crossings, not at the nearest sample.
 *
 *  ⚠️ SWITCHING AT THE SAMPLE PUTS A GREEN SEGMENT BELOW THE LINE or a red one above it — visibly wrong
 *  at the exact place people look. The crossing sits between two points, at
 *  `i + a / (a - b)`, and that is where the colour has to change.
 */
function signRuns(values, xOf, yOf) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < values.length; i++) {
    const v = clean(values[i]);
    const neg = v < 0;
    if (!cur) { cur = { neg, pts: [[xOf(i), yOf(v)]] }; continue; }
    if (neg !== cur.neg) {
      const a = clean(values[i - 1]), b = v;
      const t = a === b ? 0.5 : a / (a - b);          // fraction of the gap where it crosses zero
      const cx = xOf(i - 1) + (xOf(i) - xOf(i - 1)) * t;
      cur.pts.push([cx, yOf(0)]);
      runs.push(cur);
      cur = { neg, pts: [[cx, yOf(0)], [xOf(i), yOf(v)]] };
    } else cur.pts.push([xOf(i), yOf(v)]);
  }
  if (cur) runs.push(cur);
  return runs;
}

const fmt = (v, f) => {
  if (!Number.isFinite(v)) return "";
  if (f === "percent") return `${Math.round(v * 100)}%`;
  if (f === "ratio") return v.toFixed(2);
  if (f === "count") return v.toFixed(1);
  return money(v);
};

/** A scale that always includes zero, so a bar chart cannot imply a floor that is not there.
 *
 *  ⚠️ DELEGATES TO `plotframe.js` RATHER THAN COMPUTING ITS OWN. This file, `RunwayChart.jsx` and
 *  `ProjectChart.jsx` each had their own `x` and `y` — three independent answers to "where is zero on
 *  this canvas", and a gridline two pixels off its own baseline is the kind of bug nobody reports and
 *  everybody notices. The shape of the return is unchanged so the 600 lines below it are untouched.
 */
function scale(values) {
  const finite = (values || []).filter(Number.isFinite);
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  const f = plotFrame({ w: W, h: H, yMin: lo, yMax: hi, pad: PAD });
  return { lo, hi, y: f.y, zero: f.y(0) };
}

const xAt = (i, n) => plotFrame({ w: W, h: H, n, pad: PAD }).x(i);

const clean = (n) => (Number.isFinite(n) ? n : 0);

/** The time axis, shared by every month-indexed chart.
 *
 *  A TICK PER MONTH, A NAME PER CALENDAR QUARTER. Eighteen month names along this axis is a smear at
 *  any font size that fits, and labelling only the ends makes the reader interpolate. Quarters are
 *  Jan/Apr/Jul/Oct — `axisTicks` decides that; this only draws it.
 */
/** The time axis.
 *
 *  ⚠️ DELEGATES ITS LABELS TO `plotframe.js`. It used to label per calendar quarter and thin by a
 *  ratio; the house style labels adaptively on a FIXED sequence (1, 3, 6, 12) and puts the year on the
 *  first label and every January. Keeping the component's signature means the three call sites below
 *  are untouched — the labels change, the layout does not.
 */
/** The time axis.
 *
 *  ⚠️ IT TAKES THE MODEL START FROM `useStart()`, NOT FROM THE SPEC. I wrote `startY={spec.startY}` at
 *  two call sites and NO CHART'S `build()` RETURNS THAT FIELD — so every chart silently took the
 *  fallback path, which read `axisTicks()`'s `label`. That field is `null` on any non-quarter month,
 *  and the new label positions are counted from the START OF THE CHART rather than from calendar
 *  quarters. On any chart not beginning in Jan/Apr/Jul/Oct the positions landed on months whose label
 *  was null, and the axis lost most of its text.
 *
 *  `useStart()` is where every other view in this file's neighbourhood gets it, and it cannot be
 *  undefined the way a spec field can.
 */
const TimeAxis = ({ ticks, n, y, width = W, yearEvery = false }) => {
  const { START_Y, START_M } = useStart();
  const count = n || (ticks || []).length || 1;
  const f = plotFrame({ w: width, h: H, n: count, pad: PAD,
                        startY: START_Y, startM: START_M, yearEvery });
  // A TICK PER MONTH still — the marks are cheap and let somebody count. Only the LABELS thin.
  const labelled = new Map(f.ticks.map(t => [t.i, t.label]));
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const x = f.x(i);
        const label = labelled.get(i);
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={x} y2={y + (label ? 6 : 3)}
                  stroke={label ? "var(--muted-2)" : "var(--line-2)"} />
            {label && <text x={x} y={y + 16} className="ch-t" textAnchor="middle">{label}</text>}
          </g>
        );
      })}
    </g>
  );
};



/** An `<svg>` normally, a bare `<g>` under `Composite`.
 *
 *  ⚠️ EACH RENDERER USED TO EMIT A COMPLETE `<svg>` WITH ITS OWN AXES, so a composite of three drew
 *  THREE STACKED CHARTS — the "split into two charts" symptom. A dispatcher was not enough: the chrome
 *  had to be hoisted out, which is also what guarantees the groups share one scale rather than each
 *  drawing to its own.
 */
const Wrap = ({ marks, aria, children }) => (marks
  ? <g>{children}</g>
  : <svg className="ch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria || "chart"}>{children}</svg>);

/** Names along the axis, one per category.
 *
 *  ⚠️ IT DRAWS THE LABEL THE SPEC GAVE IT. Months are computed from the model start; categories are
 *  not derivable from anything — they come from the data and must be carried.
 */
const CategoryAxis = ({ ticks, y }) => {
  const n = ticks.length;
  const groupW = PW / Math.max(n, 1);
  return (
    <g>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l + i * groupW + groupW / 2} y1={y} x2={PAD.l + i * groupW + groupW / 2} y2={y + 5}
                stroke="var(--muted-2)" />
          <text x={PAD.l + i * groupW + groupW / 2} y={y + 16} className="ch-t" textAnchor="middle">
            {/* TRUNCATED TO ITS SLOT rather than overlapping its neighbour — the Y orientation exists
                precisely because names do not fit here. */}
            {String(t.label).length > 12 ? `${String(t.label).slice(0, 11)}…` : t.label}
          </text>
        </g>
      ))}
    </g>
  );
};

const Axes = ({ s, xs, ticks, format, sRight = null, rightLabel = null }) => (
  <>
    <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + PH} stroke="var(--line)" />
    <line x1={PAD.l} y1={s.zero} x2={W - PAD.r} y2={s.zero} stroke="var(--line)" />
    <text x={PAD.l - 6} y={s.zero + 3} textAnchor="end" className="ch-t">{fmt(0, format)}</text>
    <text x={PAD.l - 6} y={PAD.t + 8} textAnchor="end" className="ch-t">{fmt(s.hi, format)}</text>
    {/* ⚠️ A TICK THAT CARRIES ITS OWN LABEL IS NOT A MONTH. `TimeAxis` builds labels from `useStart()`
        and IGNORES whatever the spec supplied — so a category chart's project names were replaced by
        months, silently, because both are just "ticks" from here. */}
    {/* AN EXPLICIT FLAG, not an inference. My first attempt tried to DETECT categorical ticks from
        their shape and was unreadable and fragile — the spec knows which kind it built, so it says so. */}
    {ticks?.length && ticks[0]?.categorical
      ? <CategoryAxis ticks={ticks} y={PAD.t + PH} />
      : ticks?.length
      ? <TimeAxis ticks={ticks} n={ticks.length} y={PAD.t + PH} />
      : xs?.length > 0 && (
          // Charts whose x-axis is not months — periods, milestone names — keep the ends only.
          <>
            <text x={PAD.l} y={H - 8} className="ch-t">{xs[0]}</text>
            <text x={W - PAD.r} y={H - 8} textAnchor="end" className="ch-t">{xs[xs.length - 1]}</text>
          </>
        )}
    {/* ⚠️ THE RIGHT AXIS IS LABELLED, or it is a mystery. A second scale nobody can read is worse than
        one shared scale: at least a flattened line is visibly flat. Its ticks sit outside the plot and
        carry the name of the series they belong to. */}
    {sRight && (
      <g>
        <line x1={W - PAD.r} y1={PAD.t} x2={W - PAD.r} y2={PAD.t + PH} stroke="var(--line)" />
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = sRight.lo + (sRight.hi - sRight.lo) * (1 - f);
          return (
            <text key={i} x={W - PAD.r + 5} y={PAD.t + PH * f + 3} className="ch-t" textAnchor="start">
              {fmt(v, "count")}
            </text>
          );
        })}
        {rightLabel && (
          <text x={W - PAD.r + 5} y={PAD.t - 4} className="ch-t" textAnchor="start"
                fill="var(--muted-2)">{rightLabel}</text>
        )}
      </g>
    )}
  </>
);

const Markers = ({ marks, n, s }) => (marks || []).map((m, i) => {
  const x = xAt(Math.min(m.x, n - 1), n);
  return (
    <g key={i}>
      <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + PH} stroke={tone(m.tone)}
            strokeWidth="1" strokeDasharray="3 3" />
      <text x={x + 4} y={PAD.t + 10} className="ch-l" fill={tone(m.tone)}>{m.label}</text>
    </g>
  );
});

function Lines({ spec }) {
  const all = [...spec.series.flatMap(sr => sr.values),
               ...(spec.band ? [...spec.band.lo, ...spec.band.hi] : [])];
  const s = scale(spec.domain || (all));
  // ⚠️ A SERIES ON THE RIGHT AXIS USES THE RIGHT SCALE. Everything shared one, so a count against money
  // was drawn on money's range — technically plotted and practically invisible.
  const sR = spec.domainRight ? scale(spec.domainRight) : null;
  const yOf = (sr) => (sR && spec.rightIds?.has(sr.id) ? sR.y : s.y);
  const n = Math.max(...spec.series.map(sr => sr.values.length), spec.band?.lo?.length || 0);
  const path = (vals, y = s.y) => vals.map((v, i) => `${i ? "L" : "M"}${xAt(i, n)} ${y(v)}`).join(" ");

  return (

    <Wrap marks={spec.marks} aria={spec.aria}>
      <Axes s={s} xs={spec.x} ticks={spec.ticks} format={spec.format} />
      {spec.band && (
        // The band is drawn first and lightly: it is context for the line, not a third series.
        <path d={`${path(spec.band.hi)} ${spec.band.lo.map((v, i) =>
                   `L${xAt(spec.band.lo.length - 1 - i, n)} ${s.y(spec.band.lo[spec.band.lo.length - 1 - i])}`).join(" ")} Z`}
              fill="var(--signal-2)" opacity="0.18" />
      )}
      {/* THE UNDERWATER STRETCH, filled and hatched. The line already dips below zero; without this
          the recovery on the far side reads as good news rather than as a gap somebody has to cross
          with money they do not yet have. */}
      {spec.underwater && Number.isFinite(spec.underwater.fromT) && (() => {
        const u = spec.underwater;
        const x0 = xAt(u.fromT, n);
        const x1 = u.toT == null ? W - PAD.r : xAt(u.toT, n);
        return (
          <g>
            <rect x={x0} y={s.zero} width={Math.max(0, x1 - x0)}
                  height={Math.max(0, PAD.t + PH - s.zero)} fill="var(--danger)" opacity="0.14" />
            <line x1={x0} y1={PAD.t} x2={x0} y2={PAD.t + PH} stroke="var(--danger)" strokeWidth="1.4" />
            {u.deepest != null && (
              <text x={(x0 + x1) / 2} y={PAD.t + PH - 4} textAnchor="middle" className="ch-d"
                    fill="var(--danger)">
                {u.days != null ? `${u.days} days underwater · ` : "underwater · "}
                deepest {fmt(u.deepest, "money")}
              </text>
            )}
          </g>
        );
      })()}
      {/* CASH LESS WHAT IS PROMISED. Dashed and in its own colour: it is not another scenario of the
          same line, it is the same money with obligations taken off — and where it crosses zero first
          is the moment the signatures outrun the bank. */}
      {spec.committed?.values && (() => {
        const v = spec.committed.values;
        // `s.y` is the scaler this shape already built — the same one the cash line uses, so the two
        // are drawn against one axis rather than two that happen to look alike.
        const d = v.map((val, i) => `${i ? "L" : "M"}${xAt(i, n)} ${s.y(val)}`).join(" ");
        return <path d={d} fill="none" stroke="var(--commit)" strokeWidth="1.8" strokeDasharray="5 4" />;
      })()}
      {spec.series.map(sr => (
        sr.signColor
        ? signRuns(sr.values, (i) => xAt(i, n), yOf(sr)).map((r, k) => (
            <path key={`${sr.id}-${k}`} fill="none" strokeWidth="2"
                  stroke={r.neg ? TONE.danger : TONE.signal}
                  d={r.pts.map(([px, py], j) => `${j ? "L" : "M"}${px} ${py}`).join(" ")} />
          ))
        : <path key={sr.id} d={path(sr.values, yOf(sr))} fill="none" stroke={colorOf(sr)} strokeWidth="2"
              strokeDasharray={sr.dashed ? "4 3" : undefined} />
      ))}
      <Markers marks={spec.markers} n={n} s={s} />
    </Wrap>
  );
}

function Stack({ spec }) {
  const n = Math.max(...spec.series.map(sr => sr.values.length));
  // SIGNS SUMMED SEPARATELY, so the domain reaches both extremes rather than the net of them.
  const totals = Array.from({ length: n }, (_, i) => spec.series.reduce((a, sr) => a + clean(sr.values[i]), 0));
  // A SUPPLIED DOMAIN WINS. Under `Composite` all three groups must share one scale.
  const s = scale(spec.domain || [...totals, spec.refLine?.y ?? 0]);

  // ⚠️ TWO BASELINES, BECAUSE A STACK WITH MIXED SIGNS HAS TWO DIRECTIONS. With one accumulator a
  // -40k segment is drawn INSIDE a +100k one and the total is nonsense. Positives stack up from zero,
  // negatives stack down — each value starts from the baseline for its own sign.
  let up = Array(n).fill(0), down = Array(n).fill(0);
  const bands = spec.series.map(sr => {
    const lo = sr.values.map((v, i) => (clean(v) < 0 ? down[i] : up[i]));
    up = up.map((b, i) => (clean(sr.values[i]) < 0 ? b : b + clean(sr.values[i])));
    down = down.map((b, i) => (clean(sr.values[i]) < 0 ? b + clean(sr.values[i]) : b));
    const base = sr.values.map((v, i) => (clean(v) < 0 ? down[i] : up[i]));
    return { sr, lo, hi: [...base] };
  });

  return (

    <Wrap marks={spec.marks} aria={spec.aria}>
      <Axes s={s} xs={spec.x} ticks={spec.ticks} format={spec.format} />
      {/* ⚠️ THERE WAS NO STACKED-BAR RENDERER AT ALL. `Stack` only ever drew filled paths, so selecting
          Bar and then Stacked produced a stacked AREA — the shapes are the same bands either way, and
          only the drawing differs. The band arithmetic above (two baselines, one per sign) serves both.

          `spec.bars` comes from the composite, which now keeps stacked bars and stacked lines in
          separate groups rather than folding every stacked series into one. */}
      {bands.map(({ sr, lo, hi }) => (spec.bars
        ? <g key={sr.id}>
            {hi.map((v, i) => {
              const y0 = s.y(lo[i]), y1 = s.y(v);
              // ⚠️ A BAND LAYOUT, NOT A POINT ONE. `xAt(i, n)` returns the POSITION OF A DATA POINT, and
              // `xAt(0, n)` is exactly `PAD.l` — the y-axis itself — so a rect centred there hung half
              // of the first bar over the axis. A line legitimately starts on the axis; a bar occupies
              // a slot BESIDE it. This is `Bars`' own layout: a group per month, inset by 15%.
              const groupW = PW / Math.max(n, 1);
              const w = Math.max(2, groupW * 0.7);
              return Math.abs(y1 - y0) < 0.5 ? null : (
                <rect key={i} x={PAD.l + i * groupW + groupW * 0.15} y={Math.min(y0, y1)}
                      width={w} height={Math.abs(y1 - y0)}
                      fill={sr.signColor ? signColor(sr.values[i]) : colorOf(sr)} opacity="0.85" />
              );
            })}
          </g>
        : <path key={sr.id} fill={colorOf(sr)} opacity="0.5"
                d={hi.map((v, i) => `${i ? "L" : "M"}${xAt(i, n)} ${s.y(v)}`).join(" ") + " " +
                   lo.map((v, i) => `L${xAt(n - 1 - i, n)} ${s.y(lo[n - 1 - i])}`).join(" ") + " Z"} />
      ))}
      {spec.refLine && (
        <>
          <line x1={PAD.l} y1={s.y(spec.refLine.y)} x2={W - PAD.r} y2={s.y(spec.refLine.y)}
                stroke="var(--caution)" strokeDasharray="3 2" />
          {spec.refLine.label && (
            <text x={W - PAD.r} y={s.y(spec.refLine.y) - 4} textAnchor="end" className="ch-l"
                  fill="var(--caution)">{spec.refLine.label}</text>
          )}
        </>
      )}
      <Markers marks={spec.markers} n={n} s={s} />
    </Wrap>
  );
}

function Bars({ spec }) {
  const n = Math.max(...spec.series.map(sr => sr.values.length));
  const s = scale(spec.domain || (spec.series.flatMap(sr => sr.values)));
  // ⚠️ A SERIES ON THE RIGHT AXIS USES THE RIGHT SCALE. Everything shared one, so a count against money
  // was drawn on money's range — technically plotted and practically invisible.
  const sR = spec.domainRight ? scale(spec.domainRight) : null;
  const yOf = (sr) => (sR && spec.rightIds?.has(sr.id) ? sR.y : s.y);
  const groupW = PW / Math.max(n, 1);
  const barW = Math.max(2, (groupW * 0.7) / spec.series.length);

  return (

    <Wrap marks={spec.marks} aria={spec.aria}>
      <Axes s={s} xs={spec.x} ticks={spec.ticks} format={spec.format} />
      {spec.series.map((sr, si) => sr.values.map((v, i) => {
        const x = PAD.l + i * groupW + groupW * 0.15 + si * barW;
        const yy = yOf(sr); const y = Math.min(yy(v), yy(0));
        // `tones` lets one series colour bars individually — over plan in red, within it in green —
        // without splitting it into two series that would then be drawn side by side.
        return <rect key={`${sr.id}-${i}`} x={x} y={y} width={barW}
                     height={Math.max(1, Math.abs(yOf(sr)(v) - yOf(sr)(0)))}
                     fill={sr.signColor ? signColor(sr.values[i]) : colorOf(sr.tones?.[i] ? { tone: sr.tones[i] } : sr)} opacity="0.75" />;
      }))}
    </Wrap>
  );
}

/** Horizontal segmented bars: allocation, budget spent, ownership. */
function HBars({ spec }) {
  const rows = spec.rows || [];
  const rowH = Math.min(26, Math.max(14, PH / Math.max(rows.length, 1)));
  // 132, AND THE CAP LOWERED TO MATCH. At 118px with a 22-character cap, "Northwind Energy —
  // PO-2026-0142" measured 115px against a 110px usable gutter and overlapped its own bar. The cap was
  // set above what the gutter could hold.
  const labelW = 132;

  return (
    <svg className="ch-svg" viewBox={`0 0 ${W} ${Math.max(60, rows.length * rowH + 24)}`} role="img"
         aria-label={spec.aria || "chart"}>
      {/* ⚠️ THIS RENDERER NORMALISES EACH ROW TO ITS OWN TOTAL — a SHARE chart, where every bar fills
          the width and the segments divide it. That is right for "what is this made of" and wrong for
          "how big is each of these": with one segment per row, EVERY BAR DREW FULL WIDTH regardless of
          value, which is why no amount of sign fixing made a negative visible.

          `spec.magnitude` switches it to a common scale across all rows, with zero in the middle when
          anything is negative — so the bars mean something relative to each other. The curated
          share-style charts pass nothing and are untouched. */}
      {/* ⚠️ A ZERO LINE, WHERE THERE ARE NEGATIVES. Bars growing both ways from an unmarked point are
          unreadable — the reader cannot tell which side is which without it. */}
      {spec.magnitude && (() => {
        const vals = rows.flatMap(rr => (rr.segments || []).map(sg => clean(sg.value)));
        const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
        if (lo >= 0) return null;
        const zx = labelW + (-lo / ((hi - lo) || 1)) * (W - labelW - PAD.r);
        return <line x1={zx} y1={0} x2={zx} y2={rows.length * rowH} stroke="var(--ink)" strokeWidth="1.2" />;
      })()}
      {rows.map((r, i) => {
        const vals = rows.flatMap(rr => (rr.segments || []).map(sg => clean(sg.value)));
        const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
        const span = (hi - lo) || 1;
        const plotW = W - labelW - PAD.r;
        const zeroX = labelW + (spec.magnitude ? (-lo / span) * plotW : 0);
        let x = labelW;
        let xPos = zeroX, xNeg = zeroX;
        const total = r.segments.reduce((a, sg) => a + Math.abs(clean(sg.value)), 0) || 1;
        return (
          <g key={i}>
            <title>{r.label}</title>
            <text x={labelW - 10} y={i * rowH + rowH * 0.68} textAnchor="end" className="ch-l">
              {String(r.label).slice(0, 20)}
            </text>
            {r.segments.map((sg, j) => {
              const v = clean(sg.value);
              // SHARE MODE: proportion of this row. MAGNITUDE MODE: proportion of the common span, and
              // a negative grows LEFT from zero rather than right.
              const w = spec.magnitude ? (Math.abs(v) / span) * plotW
                                       : (Math.abs(v) / total) * plotW;
              // ⚠️ TWO ACCUMULATORS, ONE PER DIRECTION. With a single `x`, a negative segment moved the
              // cursor LEFT and the next POSITIVE segment then started from there — so a row with one
              // of each drew both bars on the left of zero, overlapping. Positives grow right from
              // zero and stack rightward; negatives grow left and stack leftward. Same rule as the
              // vertical stack, which needed the same fix for the same reason.
              const rx = !spec.magnitude ? x : (v < 0 ? xNeg - w : xPos);
              const rect = <rect key={j} x={rx} y={i * rowH + 3} width={Math.max(0, w)}
                                 height={rowH - 8}
                                 fill={sg.signColor ? signColor(v) : (sg.color || tone(sg.tone))}
                                 opacity={sg.tone === "line" ? 1 : 0.65} />;
              if (!spec.magnitude) x += w;
              else if (v < 0) xNeg -= w;
              else xPos += w;
              return rect;
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** Bars either side of a centre line: over plan to the right, under to the left. */
function Diverging({ spec }) {
  const rows = spec.rows || [];
  const rowH = 24, labelW = 118;
  const max = Math.max(1, ...rows.map(r => Math.abs(clean(r.value))));
  const mid = labelW + (W - labelW - PAD.r) / 2;
  const half = (W - labelW - PAD.r) / 2;

  return (
    <svg className="ch-svg" viewBox={`0 0 ${W} ${Math.max(60, rows.length * rowH + 20)}`} role="img"
         aria-label={spec.aria || "chart"}>
      <line x1={mid} y1={0} x2={mid} y2={rows.length * rowH} stroke="var(--line)" />
      {rows.map((r, i) => {
        const v = clean(r.value);
        const w = (Math.abs(v) / max) * half;
        return (
          <g key={i}>
            <text x={labelW - 8} y={i * rowH + 16} textAnchor="end" className="ch-l">
              {String(r.label).slice(0, 20)}
            </text>
            <rect x={v >= 0 ? mid : mid - w} y={i * rowH + 5} width={Math.max(1, w)} height={rowH - 11}
                  fill={v >= 0 ? TONE.danger : TONE.signal} opacity="0.62" />
          </g>
        );
      })}
    </svg>
  );
}

/** Cumulative spend against the diagonal it would follow burning evenly. */
function Pace({ spec }) {
  const rows = spec.rows || [];
  return (
    <svg className="ch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.aria || "chart"}>
      <line x1={PAD.l} y1={PAD.t + PH} x2={W - PAD.r} y2={PAD.t + PH} stroke="var(--line)" />
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + PH} stroke="var(--line)" />
      <line x1={PAD.l} y1={PAD.t + PH} x2={W - PAD.r} y2={PAD.t}
            stroke="var(--muted-2)" strokeDasharray="4 3" />
      <text x={W - PAD.r - 8} y={PAD.t + 26} textAnchor="end" className="ch-l" fill="var(--muted-2)">
        even pace
      </text>
      {rows.map(r => {
        const x = PAD.l + Math.max(0, Math.min(1, r.elapsed)) * PW;
        const y = PAD.t + PH - Math.max(0, Math.min(1, r.spent)) * PH;
        return (
          <g key={r.id}>
            <line x1={PAD.l} y1={PAD.t + PH} x2={x} y2={y} stroke={tone(r.tone)} strokeWidth="2" />
            <circle cx={x} cy={y} r="3.5" fill={tone(r.tone)} />
            <text x={x + 7} y={y + 3} className="ch-l" fill={tone(r.tone)}>
              {String(r.label).slice(0, 18)} · {Math.round(r.spent * 100)}%
            </text>
          </g>
        );
      })}
      <text x={PAD.l} y={H - 8} className="ch-t">period elapsed →</text>
    </svg>
  );
}

/** Goals on a calendar, in two phases, against two runways.
 *
 *  ONE TIMELINE, TWO BANDS, THE CLOSE AS THE BOUNDARY — before it you are spending your own money,
 *  after it you are spending theirs. Splitting into two charts would lose the thing worth seeing:
 *  whether the gating evidence exists before the money stops.
 *
 *  EVERY GOAL STATES ITS OWN DATE, so nothing depends on reading a position against an axis. That is
 *  what lets it degrade on a narrow screen into rows with the date in the label.
 */
function Goals({ spec }) {
  const pre = spec.pre || [];
  const post = spec.post || [];
  // GAP 34, NOT 26. The band heading sits above the first row of its band, and at 26 the heading's
  // baseline and the row's name text were 8px apart with a ~10px line box — they overlapped at every
  // row count, not just crowded ones.
  const ROW = 26, GAP = 34;
  const top = PAD.t + 22;
  const preBottom = top + pre.length * ROW;
  const postTop = preBottom + (post.length ? GAP : 0);
  const base = postTop + post.length * ROW + 6;
  const H2 = base + 34;

  const n = spec.span || spec.ticks?.length || 18;
  const x = (m) => PAD.l + (Math.max(0, Math.min(n, m)) / n) * PW;
  const cliff = Number.isFinite(spec.cashOut) ? x(spec.cashOut) : null;
  const close = Number.isFinite(spec.closeM) ? x(spec.closeM + 1) : null;
  const later = Number.isFinite(spec.afterRound) ? x(spec.afterRound) : null;

  const band = (rows, y0, phase) => rows.map((r, i) => {
    const y = y0 + i * ROW;
    const cx = x(r.due);
    // LABELS FLIP AT 60% OF THE PLOT. Every row draws its text to the right of its dot, so a date late
    // in the span ran past the viewBox — measured at 109px clipped for a goal at month 20 of 23. The
    // connector line still runs back to the axis, so the association survives the flip.
    const flip = cx > PAD.l + PW * 0.6;
    const tx = flip ? cx - 13 : cx + 14;
    const anchor = flip ? "end" : "start";
    // Same two marks as the milestones chart: the DOT is the goal's own standing, the RING is whether
    // the company gets there. Learning one chart should teach the other.
    const colour = r.misfiled ? TONE.caution : r.beyondCash ? TONE.danger : TONE.signal;
    return (
      <g key={r.id}>
        <line x1={PAD.l} y1={y} x2={cx} y2={y} stroke={colour} strokeWidth="1.4" opacity="0.28" />
        <circle cx={cx} cy={y} r="4.5" fill={colour} />
        {r.stranded && (
          <circle cx={cx} cy={y} r="9.5" fill="none" stroke="var(--danger)" strokeWidth="1.6" />
        )}
        {/* Filed in the wrong phase gets its own ring: a pre-raise goal after the close cannot gate the
            round, and a post-raise goal before it spends money that has not arrived. */}
        {!r.stranded && r.misfiled && (
          <circle cx={cx} cy={y} r="8" fill="none" stroke="var(--caution)" strokeWidth="1.5" />
        )}
        <title>{r.label}</title>
        <text x={tx} y={y - 2} textAnchor={anchor} className="ch-g">
          {String(r.label).slice(0, 36)}
        </text>
        <text x={tx} y={y + 9} textAnchor={anchor} className="ch-d" fill={colour}>
          {r.dueLabel}
          {/* A post-raise goal stranded by a PRE-ROUND hole is a different sentence: the money that
              pays for it never arrives, because the company does not reach the close. */}
          {r.strandedBeforeRound ? ` · the round never lands${r.bridge ? `; needs ${money(r.bridge)} first` : ""}` : ""}
          {!r.strandedBeforeRound && r.stranded && r.bridge ? ` · needs ${money(r.bridge)} to reach` : ""}
          {!r.strandedBeforeRound && r.stranded && !r.bridge ? " · unreachable without bridging" : ""}
          {!r.stranded && r.lateBy ? ` · ${r.lateBy} days past the cash` : ""}
          {!r.stranded && !r.lateBy && r.misfiled
            ? (phase === "pre" ? " · after the close" : " · before the close") : ""}
        </text>
      </g>
    );
  });

  return (
    <svg className="ch-svg" viewBox={`0 0 ${W} ${H2}`} role="img"
         aria-label={`${pre.length} pre-raise and ${post.length} post-raise goals on a calendar` +
           (spec.cashOutLabel ? `, cash running out on ${spec.cashOutLabel}` : "")}>
      {/* The two runways, each shaded only under its own phase. Shading the whole width would claim
          the pre-raise cash cliff applies to post-raise goals, which is the confusion this split
          exists to remove. */}
      {cliff != null && pre.length > 0 && (
        <rect x={cliff} y={PAD.t} width={Math.max(0, W - PAD.r - cliff)}
              height={preBottom - PAD.t + 4} fill="var(--danger)" opacity="0.06" />
      )}
      {later != null && post.length > 0 && (
        <rect x={later} y={postTop - 14} width={Math.max(0, W - PAD.r - later)}
              height={base - postTop + 14} fill="var(--danger)" opacity="0.06" />
      )}

      {pre.length > 0 && (
        <text x={PAD.l} y={PAD.t + 8} className="ch-p" fill="var(--raise)">
          Pre-raise · your money
        </text>
      )}
      {post.length > 0 && (
        <text x={PAD.l} y={postTop - 16} className="ch-p" fill="var(--signal-ink)">
          Post-raise · their money
        </text>
      )}

      {cliff != null && (
        <>
          <line x1={cliff} y1={PAD.t} x2={cliff} y2={base} stroke="var(--danger)" strokeWidth="1.8" />
          <text x={cliff + 5} y={PAD.t + 8} className="ch-f" fill="var(--danger)">
            Cash out · {spec.cashOutLabel}
          </text>
        </>
      )}
      {close != null && (
        <>
          <line x1={close} y1={PAD.t} x2={close} y2={base} stroke="var(--raise)" strokeWidth="2" />
          <text x={close + 5} y={PAD.t + 8} className="ch-f" fill="var(--raise)">
            Closes · {spec.closeLabel}
          </text>
        </>
      )}
      {later != null && (
        <line x1={later} y1={postTop - 14} x2={later} y2={base} stroke="var(--danger)"
              strokeWidth="1.4" strokeDasharray="4 3" />
      )}

      {band(pre, top, "pre")}
      {band(post, postTop, "post")}

      <line x1={PAD.l} y1={base} x2={W - PAD.r} y2={base} stroke="var(--line)" />
      <TimeAxis ticks={spec.ticks} n={n} y={base} />
    </svg>
  );
}


/** Milestones on a calendar: two bands, cash on the day, target where there is one.
 *
 *  SHARES ITS LAYOUT WITH `Goals` on purpose — same bands, same cliff, same axis — because they are
 *  the same question asked about two different things, and a reader who has learned one should not
 *  have to learn the other.
 */
function Milestones({ spec }) {
  const mine = spec.mine || [];
  const fromRound = spec.fromRound || [];
  // Same 34 as the goals chart: at 26 the band heading overlapped the first row beneath it.
  const ROW = 26, GAP = 34;
  const top = PAD.t + 22;
  const mineBottom = top + mine.length * ROW;
  const roundTop = mineBottom + (fromRound.length ? GAP : 0);
  const base = roundTop + fromRound.length * ROW + 6;
  const H2 = base + 34;

  const n = spec.span || spec.ticks?.length || 18;
  const x = (m) => PAD.l + (Math.max(0, Math.min(n, m)) / n) * PW;
  const cliff = Number.isFinite(spec.cashOut) ? x(spec.cashOut) : null;
  // BOUNDED WHERE CASH RECOVERS. Shading to the edge would make a 61-day gap and a permanent one look
  // identical, and they are different conversations.
  const back = Number.isFinite(spec.recoversT) ? x(spec.recoversT) : (W - PAD.r);

  const band = (rows, y0) => rows.map((r, i) => {
    const y = y0 + i * ROW;
    const cx = x(r.due);
    // Flipped past 60% of the plot, as in the goals chart — a date late in the span ran off the edge.
    const flip = cx > PAD.l + PW * 0.6;
    const tx = flip ? cx - 13 : cx + 14;
    const anchor = flip ? "end" : "start";
    // THE DOT IS THE BALANCE ON THE DAY. THE RING IS WHETHER THE COMPANY GETS THERE. A green dot in a
    // red ring says "solvent that day, insolvent before it" — the truth in two marks, which is what a
    // single colour could not hold.
    const colour = r.negative ? TONE.danger : r.short ? TONE.caution : TONE.signal;
    return (
      <g key={r.id}>
        <line x1={PAD.l} y1={y} x2={cx} y2={y} stroke={colour} strokeWidth="1.4" opacity="0.28" />
        <circle cx={cx} cy={y} r="4.5" fill={colour} />
        {r.stranded && (
          <circle cx={cx} cy={y} r="9.5" fill="none" stroke="var(--danger)" strokeWidth="1.6" />
        )}
        {!r.stranded && r.short && (
          <circle cx={cx} cy={y} r="8" fill="none" stroke="var(--caution)" strokeWidth="1.5" />
        )}
        <title>{r.label}</title>
        <text x={tx} y={y - 2} textAnchor={anchor} className="ch-g">
          {String(r.label).slice(0, 34)}
        </text>
        <text x={tx} y={y + 9} textAnchor={anchor} className="ch-d"
              fill={r.stranded ? TONE.danger : colour}>
          {r.dueLabel}
          {` · ${money(r.bal)}`}
          {/* The bridge is what turns a colour into something to do: $84k and $188k are different
              problems, and without the number every date after the crossing looks equally doomed. */}
          {r.stranded && r.bridge ? ` · needs ${money(r.bridge)} to reach` : ""}
          {r.stranded && !r.bridge ? " · unreachable without bridging" : ""}
          {!r.stranded && r.short ? `, ${money(r.shortBy)} short` : ""}
          {!r.stranded && !r.short && r.target > 0 ? `, target ${money(r.target)}` : ""}
        </text>
      </g>
    );
  });

  return (
    <svg className="ch-svg" viewBox={`0 0 ${W} ${H2}`} role="img"
         aria-label={`${mine.length + fromRound.length} milestones on a calendar` +
           (spec.cashOutEndless ? "" : `, cash running out on ${spec.cashOutLabel}`)}>
      {cliff != null && (
        <>
          <rect x={cliff} y={PAD.t} width={Math.max(0, back - cliff)} height={base - PAD.t}
                fill="var(--danger)" opacity="0.09" />
          {spec.daysUnderwater != null && spec.deepest != null && (
            <text x={(cliff + back) / 2} y={base - 5} textAnchor="middle" className="ch-d"
                  fill="var(--danger)">
              {spec.daysUnderwater} days · deepest {money(spec.deepest)}
            </text>
          )}
        </>
      )}

      {mine.length > 0 && (
        <text x={PAD.l} y={PAD.t + 8} className="ch-p" fill="var(--muted)">Dates you set</text>
      )}
      {fromRound.length > 0 && (
        <text x={PAD.l} y={roundTop - 16} className="ch-p" fill="var(--raise)">
          From rounds · not editable here
        </text>
      )}

      {cliff != null && (
        <>
          <line x1={cliff} y1={PAD.t} x2={cliff} y2={base} stroke="var(--danger)" strokeWidth="1.8" />
          <text x={cliff + 5} y={PAD.t + 8} className="ch-f" fill="var(--danger)">
            Cash out · {spec.cashOutLabel}
          </text>
          {spec.recoversLabel && (
            <>
              <line x1={back} y1={PAD.t} x2={back} y2={base} stroke="var(--muted-2)"
                    strokeWidth="1.2" strokeDasharray="4 3" />
              <text x={back - 5} y={PAD.t + 8} textAnchor="end" className="ch-f" fill="var(--muted)">
                Recovers · {spec.recoversLabel}
              </text>
            </>
          )}
        </>
      )}

      {band(mine, top)}
      {band(fromRound, roundTop)}

      <line x1={PAD.l} y1={base} x2={W - PAD.r} y2={base} stroke="var(--line)" />
      <TimeAxis ticks={spec.ticks} n={n} y={base} />
    </svg>
  );
}

/** Several shapes on one canvas, sharing one scale.
 *
 *  ⚠️ THE FAULT THIS FIXES: `SHAPES[spec.kind]` picked ONE renderer and handed it every series, so a
 *  per-series `shape` was never read by anything. The first measure's settings became the chart's
 *  settings — and the commitments chart drew cash as a stacked band because its spec said `stack` while
 *  cash carried a `shape: "lines"` nothing looked at. **The spec was right and nothing could draw it.**
 *
 *  This is a DISPATCHER, not a rewrite. `Lines`, `Stack`, `Bars` each already draw a SET of series in
 *  one shape; they are handed subsets and left alone.
 */
function Composite({ spec }) {
  // ⚠️ A SPEC WITH NO SERIES IS NOT A CHART WITH NOTHING IN IT — it may be a shape this renderer does
  // not handle, or a refusal carrying only a note. Drawing an empty canvas would hide both.
  if (!spec?.series?.length) return null;
  const series = spec.series || [];
  // ⚠️ STACKED BARS AND STACKED LINES ARE DIFFERENT GROUPS. Folding every stacked series into one sent
  // bars to the area renderer — "Bar then Stacked" drew a stacked area. Four combinations, four groups.
  const key = (sr) => (sr.stacked
    ? (sr.shape === "bars" ? "stackBars" : "stackArea")
    : sr.shape === "bars" ? "bars" : "lines");
  const groups = { stackBars: [], stackArea: [], bars: [], lines: [] };
  for (const sr of series) groups[key(sr)].push(sr);

  // ⚠️ ONE DOMAIN, COMPUTED FROM THE COMPOSITION. A stack's height is the SUM of its members; a line's
  // is its own values. Letting each group scale itself would draw two charts on one canvas that
  // silently disagree about height.
  const n = Math.max(1, ...series.map(sr => (sr.values || []).length));
  // ⚠️ THE STACK'S EXTREMES, NOT ITS NET. Summing signed values gives the middle of a mixed stack, so
  // a chart with +100k above and -40k below would size itself to 60k and clip both ends.
  const stacked = [...groups.stackBars, ...groups.stackArea];
  const loose = groups.lines.flatMap(sr => (sr.values || []).map(clean));

  // ⚠️ TWO DOMAINS, ONE PER AXIS. `axis` was carried on every series and read by nothing — the
  // renderers computed ONE scale from everything, so three orders against $400k of revenue drew as a
  // flat line on the baseline. **A second axis whose range matches the first is not a second axis.**
  //
  // Each side gets the extent of ITS OWN series. A stack still contributes its summed totals, because
  // that is what a stack occupies.
  const onRight = (sr) => sr.axis === "right";
  const rightIds = new Set(series.filter(onRight).map(sr => sr.id));
  const pick = (arr) => arr.filter(sr => !rightIds.has(sr.id));
  const pickR = (arr) => arr.filter(sr => rightIds.has(sr.id));
  const totalsOf = (list) => Array.from({ length: n }, (_, i) => [
    list.reduce((a, sr) => a + Math.max(0, clean(sr.values?.[i])), 0),
    list.reduce((a, sr) => a + Math.min(0, clean(sr.values?.[i])), 0),
  ]).flat();

  const domain = [...totalsOf(pick(stacked)),
                  ...pick(groups.bars).flatMap(sr => (sr.values || []).map(clean)),
                  ...pick(groups.lines).flatMap(sr => (sr.values || []).map(clean)), 0];
  const rightSeries = series.filter(onRight);
  const domainRight = rightSeries.length
    ? [...totalsOf(pickR(stacked)),
       ...pickR(groups.bars).flatMap(sr => (sr.values || []).map(clean)),
       ...pickR(groups.lines).flatMap(sr => (sr.values || []).map(clean)), 0]
    : null;

  // ⚠️ EACH RENDERER EMITS A COMPLETE `<svg>` WITH ITS OWN AXES — so rendering three of them produced
  // THREE STACKED CHARTS rather than one. That is the "split into two charts" symptom, and it is why a
  // dispatcher alone was not enough.
  //
  // `marks: true` asks a renderer for its marks in a `<g>` and nothing else: no svg, no frame, no
  // ticks. The chrome is drawn ONCE, here, from the shared domain — which is also what guarantees the
  // groups cannot disagree about where a value sits.
  const sub = (list) => ({ ...spec, series: list, domain, domainRight, rightIds, marks: true });
  return (
    <svg className="ch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.aria || "chart"}>
      <Axes s={scale(domain)} xs={spec.x} ticks={spec.ticks} format={spec.format}
            sRight={domainRight ? scale(domainRight) : null}
            rightLabel={rightSeries[0]?.label} />
      {/* FILLS BENEATH, LINES ABOVE, AND THAT IS FIXED. A filled stack over a line hides it
          completely; a line over a stack is always readable. */}
      {groups.stackBars.length > 0 && <Stack spec={{ ...sub(groups.stackBars), bars: true }} />}
      {groups.stackArea.length > 0 && <Stack spec={sub(groups.stackArea)} />}
      {groups.bars.length > 0 && <Bars spec={sub(groups.bars)} />}
      {groups.lines.length > 0 && <Lines spec={sub(groups.lines)} />}
    </svg>
  );
}

const SHAPES = { composite: Composite, lines: Lines, stack: Stack, bars: Bars, hbars: HBars, diverging: Diverging,
                 pace: Pace, goals: Goals, milestones: Milestones };

/** Is the viewport too narrow to draw an axis on?
 *
 *  A MEDIA QUERY CANNOT REACH INSIDE AN SVG, so the substitution has to happen in JS. Subscribed rather
 *  than read once: somebody rotating a phone changes this, and a chart that only checks on mount would
 *  keep drawing an axis into 328px until the next render happened to come along.
 */
function useNarrow(px = 640) {
  const [narrow, setNarrow] = React.useState(
    () => typeof matchMedia === "function" && matchMedia(`(max-width:${px}px)`).matches);
  React.useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const q = matchMedia(`(max-width:${px}px)`);
    const on = (e) => setNarrow(e.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, [px]);
  return narrow;
}

export function Chart({ spec }) {
  const narrow = useNarrow();
  const Shape = useMemo(() => SHAPES[spec?.kind], [spec?.kind]);

  // Declared key first, falling back to the series for the shapes that have them.
  // ⚠️ THE LEGEND CARRIES THE COLOUR TOO. It copied `tone` and dropped `color`, so the swatches kept
  // falling back to green while the chart beside them drew the real ramp — **the legend disagreeing
  // with the chart it explains**, which is worse than both being wrong, because the reader trusts the
  // key to tell them which line is which.
  //
  // Same fault as the renderer itself, one consumer later: a field nobody copies is a field nobody
  // notices is missing.
  const legend = spec?.legend
    || (spec?.series || []).map(sr => ({ id: sr.id, label: sr.label, tone: sr.tone, color: sr.color }));

  if (!spec || spec.empty || !Shape) {
    return (
      <div className="ch-empty">
        {spec?.empty || "Nothing to show yet."}
        {/* The underlying error is kept out of the sentence but not thrown away: a chart that cannot
            be drawn is worth reporting, and a stack trace on a dashboard is not. */}
        {spec?.error && <span className="ch-err" title={spec.error}> ⓘ</span>}
      </div>
    );
  }

  // THE TIMELINES BECOME ROWS. Their axis is the thing that does not survive 328px — 34 characters of
  // label have nowhere to go, and a dot's position along a 276px line resolves to a fortnight either
  // way. Every row already states its own date, so nothing is lost with the axis.
  const asRows = narrow && (spec.kind === "goals" || spec.kind === "milestones");

  return (
    <div className="ch">
      {asRows ? <TimelineRows spec={spec} /> : <Shape spec={spec} />}
      {/* A SPEC MAY DECLARE ITS OWN KEY. The legend was built from `spec.series`, and the row-based
          shapes — goals, milestones, pace, hbars, diverging — carry `rows` instead. Six charts were
          emitting an EMPTY legend div, which meant the ones whose entire meaning is colour had nothing
          explaining any of it. */}
      {legend.length > 0 && !asRows && (
        <div className="ch-legend">
          {legend.map((k, i) => (
            <span key={k.id || k.label || i}>
              <i className={k.ring ? "ring" : ""}
                 style={k.ring ? { borderColor: colorOf(k) } : { background: colorOf(k) }} />
              {k.label}
            </span>
          ))}
        </div>
      )}
      {spec.note && <div className="ch-note">{spec.note}</div>}
    </div>
  );
}
