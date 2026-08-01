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
import { money } from "../../engine/money";

const W = 720, H = 252;
const PAD = { l: 52, r: 16, t: 14, b: 38 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;

const TONE = {
  signal: "var(--signal)", muted: "var(--muted-2)", danger: "var(--danger)",
  caution: "var(--caution)", line: "var(--line-2)",
};
const tone = (t) => TONE[t] || TONE.signal;

const fmt = (v, f) => {
  if (!Number.isFinite(v)) return "";
  if (f === "percent") return `${Math.round(v * 100)}%`;
  if (f === "ratio") return v.toFixed(2);
  if (f === "count") return v.toFixed(1);
  return money(v);
};

/** A scale that always includes zero, so a bar chart cannot imply a floor that is not there. */
function scale(values) {
  const finite = values.filter(Number.isFinite);
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  const span = hi - lo || 1;
  return {
    lo, hi,
    y: (v) => PAD.t + PH - ((clean(v) - lo) / span) * PH,
    zero: PAD.t + PH - ((0 - lo) / span) * PH,
  };
}
const clean = (n) => (Number.isFinite(n) ? n : 0);
const xAt = (i, n) => PAD.l + (n <= 1 ? PW / 2 : (i / (n - 1)) * PW);

/** The time axis, shared by every month-indexed chart.
 *
 *  A TICK PER MONTH, A NAME PER CALENDAR QUARTER. Eighteen month names along this axis is a smear at
 *  any font size that fits, and labelling only the ends makes the reader interpolate. Quarters are
 *  Jan/Apr/Jul/Oct — `axisTicks` decides that; this only draws it.
 */
const TimeAxis = ({ ticks, n, y }) => {
  if (!ticks?.length) return null;
  const step = Math.max(1, Math.ceil(ticks.filter(t => t.quarter).length / 7));
  let shown = -1;
  return (
    <g>
      {ticks.map((t, i) => {
        const x = xAt(i, n);
        if (!t.quarter) return <line key={i} x1={x} y1={y} x2={x} y2={y + 3} stroke="var(--line-2)" />;
        shown += 1;
        // Thinned when the span is long, so a three-year model does not stack labels on top of one
        // another — the ticks stay, so nothing is lost but the words.
        const label = shown % step === 0;
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={x} y2={y + 6} stroke="var(--muted-2)" />
            {label && <text x={x} y={y + 16} className="ch-t" textAnchor="middle">{t.label}</text>}
            {label && <text x={x} y={y + 25} className="ch-t" textAnchor="middle"
                            opacity=".75">{t.q}</text>}
          </g>
        );
      })}
    </g>
  );
};

const Axes = ({ s, xs, ticks, format }) => (
  <>
    <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + PH} stroke="var(--line)" />
    <line x1={PAD.l} y1={s.zero} x2={W - PAD.r} y2={s.zero} stroke="var(--line)" />
    <text x={PAD.l - 6} y={s.zero + 3} textAnchor="end" className="ch-t">{fmt(0, format)}</text>
    <text x={PAD.l - 6} y={PAD.t + 8} textAnchor="end" className="ch-t">{fmt(s.hi, format)}</text>
    {ticks?.length
      ? <TimeAxis ticks={ticks} n={ticks.length} y={PAD.t + PH} />
      : xs?.length > 0 && (
          // Charts whose x-axis is not months — periods, milestone names — keep the ends only.
          <>
            <text x={PAD.l} y={H - 8} className="ch-t">{xs[0]}</text>
            <text x={W - PAD.r} y={H - 8} textAnchor="end" className="ch-t">{xs[xs.length - 1]}</text>
          </>
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
  const s = scale(all);
  const n = Math.max(...spec.series.map(sr => sr.values.length), spec.band?.lo?.length || 0);
  const path = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${xAt(i, n)} ${s.y(v)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.aria || "chart"}>
      <Axes s={s} xs={spec.x} ticks={spec.ticks} format={spec.format} />
      {spec.band && (
        // The band is drawn first and lightly: it is context for the line, not a third series.
        <path d={`${path(spec.band.hi)} ${spec.band.lo.map((v, i) =>
                   `L${xAt(spec.band.lo.length - 1 - i, n)} ${s.y(spec.band.lo[spec.band.lo.length - 1 - i])}`).join(" ")} Z`}
              fill="var(--signal-2)" opacity="0.18" />
      )}
      {spec.series.map(sr => (
        <path key={sr.id} d={path(sr.values)} fill="none" stroke={tone(sr.tone)} strokeWidth="2"
              strokeDasharray={sr.dashed ? "4 3" : undefined} />
      ))}
      <Markers marks={spec.markers} n={n} s={s} />
    </svg>
  );
}

function Stack({ spec }) {
  const n = Math.max(...spec.series.map(sr => sr.values.length));
  const totals = Array.from({ length: n }, (_, i) => spec.series.reduce((a, sr) => a + clean(sr.values[i]), 0));
  const s = scale([...totals, spec.refLine?.y ?? 0]);

  let base = Array(n).fill(0);
  const bands = spec.series.map(sr => {
    const lo = [...base];
    base = base.map((b, i) => b + clean(sr.values[i]));
    return { sr, lo, hi: [...base] };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.aria || "chart"}>
      <Axes s={s} xs={spec.x} ticks={spec.ticks} format={spec.format} />
      {bands.map(({ sr, lo, hi }) => (
        <path key={sr.id} fill={tone(sr.tone)} opacity="0.5"
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
    </svg>
  );
}

function Bars({ spec }) {
  const n = Math.max(...spec.series.map(sr => sr.values.length));
  const s = scale(spec.series.flatMap(sr => sr.values));
  const groupW = PW / Math.max(n, 1);
  const barW = Math.max(2, (groupW * 0.7) / spec.series.length);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.aria || "chart"}>
      <Axes s={s} xs={spec.x} ticks={spec.ticks} format={spec.format} />
      {spec.series.map((sr, si) => sr.values.map((v, i) => {
        const x = PAD.l + i * groupW + groupW * 0.15 + si * barW;
        const y = Math.min(s.y(v), s.zero);
        // `tones` lets one series colour bars individually — over plan in red, within it in green —
        // without splitting it into two series that would then be drawn side by side.
        return <rect key={`${sr.id}-${i}`} x={x} y={y} width={barW}
                     height={Math.max(1, Math.abs(s.y(v) - s.zero))}
                     fill={tone(sr.tones?.[i] || sr.tone)} opacity="0.75" />;
      }))}
    </svg>
  );
}

/** Horizontal segmented bars: allocation, budget spent, ownership. */
function HBars({ spec }) {
  const rows = spec.rows || [];
  const rowH = Math.min(26, Math.max(14, PH / Math.max(rows.length, 1)));
  const labelW = 118;

  return (
    <svg viewBox={`0 0 ${W} ${Math.max(60, rows.length * rowH + 24)}`} role="img"
         aria-label={spec.aria || "chart"}>
      {rows.map((r, i) => {
        let x = labelW;
        const total = r.segments.reduce((a, sg) => a + Math.max(0, clean(sg.value)), 0) || 1;
        return (
          <g key={i}>
            <text x={labelW - 8} y={i * rowH + rowH * 0.68} textAnchor="end" className="ch-l">
              {String(r.label).slice(0, 22)}
            </text>
            {r.segments.map((sg, j) => {
              const w = (Math.max(0, clean(sg.value)) / total) * (W - labelW - PAD.r);
              const rect = <rect key={j} x={x} y={i * rowH + 3} width={Math.max(0, w)}
                                 height={rowH - 8} fill={tone(sg.tone)}
                                 opacity={sg.tone === "line" ? 1 : 0.65} />;
              x += w;
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
    <svg viewBox={`0 0 ${W} ${Math.max(60, rows.length * rowH + 20)}`} role="img"
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
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.aria || "chart"}>
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
  const ROW = 26, GAP = 26;
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
    const colour = r.beyondCash ? TONE.danger : r.misfiled ? TONE.caution : TONE.signal;
    return (
      <g key={r.id}>
        <line x1={PAD.l} y1={y} x2={cx} y2={y} stroke={colour} strokeWidth="1.4" opacity="0.28" />
        <circle cx={cx} cy={y} r="4.5" fill={colour} />
        {/* Filed in the wrong phase gets a ring, because it is a DIFFERENT problem from being late:
            a pre-raise goal after the close cannot gate the round, and a post-raise goal before it
            spends money that has not arrived. */}
        {r.misfiled && (
          <circle cx={cx} cy={y} r="8" fill="none" stroke="var(--caution)" strokeWidth="1.5" />
        )}
        <text x={cx + 12} y={y - 2} className="ch-g">{String(r.label).slice(0, 36)}</text>
        <text x={cx + 12} y={y + 9} className="ch-d" fill={colour}>
          {r.dueLabel}
          {r.lateBy ? ` · ${r.lateBy} days past the cash` : ""}
          {!r.lateBy && r.misfiled
            ? (phase === "pre" ? " · after the close" : " · before the close") : ""}
        </text>
      </g>
    );
  });

  return (
    <svg viewBox={`0 0 ${W} ${H2}`} role="img"
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
        <text x={PAD.l} y={postTop - 8} className="ch-p" fill="var(--signal-ink)">
          Post-raise · their money
        </text>
      )}

      {cliff != null && (
        <>
          <line x1={cliff} y1={PAD.t} x2={cliff} y2={base} stroke="var(--danger)" strokeWidth="1.6" />
          <text x={cliff + 5} y={base - 4} className="ch-f" fill="var(--danger)">
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

const SHAPES = { lines: Lines, stack: Stack, bars: Bars, hbars: HBars, diverging: Diverging,
                 pace: Pace, goals: Goals };

export function Chart({ spec }) {
  const Shape = useMemo(() => SHAPES[spec?.kind], [spec?.kind]);

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

  return (
    <div className="ch">
      <Shape spec={spec} />
      <div className="ch-legend">
        {(spec.series || []).map(sr => (
          <span key={sr.id}>
            <i style={{ background: tone(sr.tone) }} />{sr.label}
          </span>
        ))}
      </div>
      {spec.note && <div className="ch-note">{spec.note}</div>}
    </div>
  );
}
