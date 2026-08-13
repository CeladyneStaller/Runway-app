import { plotFrame, legendMode } from "../../engine/plotframe";

/** The chrome every chart draws, and nothing else.
 *
 *  ⚠️ THIS COMPONENT DRAWS NO SERIES. It renders the frame, the rules, the ticks, zero and the today
 *  divider, and hands back the scales through `plotFrame` so each renderer places its own marks. The
 *  split is deliberate: `RunwayChart` carries milestone markers and stranded-milestone logic that has
 *  no business in a generic renderer, and folding the three renderers together to share an axis would
 *  have dragged all of that with it.
 */
export function PlotChrome({ f, divider = null, dividerLabel = "today" }) {
  return (
    <g className="pf" aria-hidden="true">
      <rect x={f.inner.x} y={f.inner.y} width={f.inner.w} height={f.inner.h}
            fill="none" className="pf-frame" />

      {f.rules.map((r, i) => (
        <line key={"r" + i} x1={f.inner.x} y1={r.y} x2={f.inner.x + f.inner.w} y2={r.y}
              className="pf-rule" />
      ))}

      {/* VERTICALS ONLY WHERE NOTHING ELSE DIVIDES THE MONTHS — `plotFrame` returns an empty list for
          bars and stacks, where the marks already separate them. */}
      {f.verticals.map(t => (
        <line key={"v" + t.i} x1={t.x} y1={f.inner.y} x2={t.x} y2={f.inner.y + f.inner.h}
              className="pf-rule" />
      ))}

      {f.rules.map((r, i) => (
        <text key={"rl" + i} x={f.inner.x - 6} y={r.y + 3} className="pf-tick" textAnchor="end">
          {r.label}
        </text>
      ))}

      {f.ticks.map(t => (
        <text key={"tl" + t.i} x={t.x} y={f.inner.y + f.inner.h + 16}
              className="pf-tick" textAnchor="middle">{t.label}</text>
      ))}

      {/* ⚠️ ZERO IS HEAVIER THAN ANY RULE and is never one of the four. In this product zero is an
          event, not a gridline that happens to sit there. */}
      {f.zeroY != null && (
        <line x1={f.inner.x} y1={f.zeroY} x2={f.inner.x + f.inner.w} y2={f.zeroY} className="pf-zero" />
      )}

      {/* ⚠️ THE MOST IMPORTANT MARK ON ANY CHART HERE. Left of it is what happened; right of it is
          arithmetic on assumptions. Never optional where a chart has actuals. */}
      {divider != null && divider > 0 && divider < f.n - 1 && (
        <>
          <line x1={f.x(divider)} y1={f.inner.y} x2={f.x(divider)} y2={f.inner.y + f.inner.h}
                className="pf-divider" />
          <text x={f.x(divider) + 4} y={f.inner.y + 11} className="pf-divlab">{dividerLabel}</text>
        </>
      )}
    </g>
  );
}

/** The legend, in whichever form the series count calls for.
 *
 *  ⚠️ IT SWITCHES ON COUNT, NOT ON A SETTING. One or two series get their name where the eye already
 *  is; three or more collide, so a swatch row. Offering this as an option would be a setting nobody
 *  finds and a second way for two charts on one screen to disagree.
 */
export function PlotLegend({ series = [], f, dimmed = [] }) {
  const mode = legendMode(series.length);
  if (mode === "none") return null;

  if (mode === "endpoint" && f) {
    return (
      <g className="pf-ends" aria-hidden="true">
        {series.map((s, i) => {
          const vals = (s.values || []).filter(v => Number.isFinite(v));
          if (!vals.length) return null;
          const last = vals.length - 1;
          return (
            <text key={s.id || i} x={f.x(last) + 5} y={f.y(vals[last]) + 3}
                  className="pf-end" style={{ fill: s.color }}>{s.label}</text>
          );
        })}
      </g>
    );
  }

  // ORDERED TO MATCH THE STACK, top band first. A legend whose order disagrees with the chart makes
  // the reader do a lookup on every glance.
  return (
    <div className="pf-legend">
      {series.slice().reverse().map((s, i) => (
        <span key={s.id || i} className={dimmed.includes(s.id) ? "dim" : undefined}>
          <i style={{ background: s.color }} />{s.label}
        </span>
      ))}
    </div>
  );
}

export { plotFrame };
