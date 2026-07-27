import React, { useState } from "react";
import { projectSeries } from "../../engine/projectchart";
import { money } from "../../engine/money";
import { useStart } from "../../state/StartCtx";
import { monthLabel } from "../../engine/time";

// Projected vs actual, per project. Three metrics (cost / revenue / net), each a projected line with
// the recorded-actual overlay drawn only as far as the books go. Monthly ⇄ cumulative toggle.
const METRICS = [
  ["cost", "Cost", "var(--danger)"],
  ["revenue", "Revenue", "var(--signal)"],
  ["net", "Net", "var(--ink-2)"],
];

export function ProjectChart({ project, hist, maps }) {
  const { START_Y, START_M } = useStart();
  const [mode, setMode] = useState("cumulative");   // "monthly" | "cumulative"
  const [metric, setMetric] = useState("cost");
  const s = projectSeries(project, hist, maps);
  const [, label, color] = METRICS.find(m => m[0] === metric);
  const series = s[mode][metric];

  // horizontal extent: show through a bit past the last month with any data
  const lastData = Math.max(s.actualThrough, ...series.projected.map((v, i) => v !== 0 ? i : 0));
  const tMax = Math.max(6, Math.min(series.projected.length - 1, lastData + 1));
  const W = 460, H = 200, PADL = 52, PADR = 12, PADT = 14, PADB = 26;

  const projPts = series.projected.slice(0, tMax + 1);
  const actPts = series.actual.slice(0, Math.max(0, s.actualThrough) + 1);
  const all = [...projPts, ...actPts, 0];
  const vMax = Math.max(...all), vMin = Math.min(...all);
  const span = (vMax - vMin) || 1;

  const x = (t) => PADL + (t / tMax) * (W - PADL - PADR);
  const y = (v) => PADT + (1 - (v - vMin) / span) * (H - PADT - PADB);

  const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  // y-axis ticks: 0, min, max
  const ticks = [...new Set([vMin, 0, vMax].filter(v => v >= vMin && v <= vMax))].sort((a, b) => a - b);

  return (
    <div className="pchart">
      <div className="pchart-ctrl">
        <div className="pchart-metrics">
          {METRICS.map(([k, lbl, c]) => (
            <button key={k} className={"pcm" + (metric === k ? " on" : "")}
              style={metric === k ? { color: "#fff", background: c, borderColor: c } : { color: c }}
              onClick={() => setMetric(k)}>{lbl}</button>
          ))}
        </div>
        <div className="pchart-mode">
          <button className={"pcmode" + (mode === "monthly" ? " on" : "")} onClick={() => setMode("monthly")}>Monthly</button>
          <button className={"pcmode" + (mode === "cumulative" ? " on" : "")} onClick={() => setMode("cumulative")}>Cumulative</button>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="pchart-svg" preserveAspectRatio="xMidYMid meet">
        {/* zero baseline */}
        {vMin < 0 && vMax > 0 && <line x1={PADL} x2={W - PADR} y1={y(0)} y2={y(0)} className="pc-zero" />}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PADL} x2={W - PADR} y1={y(t)} y2={y(t)} className="pc-grid" />
            <text x={PADL - 6} y={y(t) + 3} className="pc-ytick">{money(t)}</text>
          </g>
        ))}
        {/* month ticks */}
        {Array.from({ length: tMax + 1 }, (_, m) => m).filter(m => m % Math.ceil((tMax + 1) / 6) === 0).map(m => (
          <text key={m} x={x(m)} y={H - 8} className="pc-xtick">{monthLabel(START_Y, START_M, m)}</text>
        ))}

        {/* projected: a smooth line the full extent */}
        <path d={line(projPts)} className="pc-proj" style={{ stroke: color }} fill="none" />
        {/* actual: heavier, only through recorded months, with dots */}
        {s.hasActuals && actPts.length > 0 && (
          <>
            <path d={line(actPts)} className="pc-act" style={{ stroke: color }} fill="none" />
            {actPts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.6" style={{ fill: color }} />)}
          </>
        )}
      </svg>

      <div className="pchart-legend">
        <span><i className="pc-sw proj" style={{ background: color }} /> Projected {label.toLowerCase()}</span>
        {s.hasActuals
          ? <span><i className="pc-sw act" style={{ background: color }} /> Recorded (through {monthLabel(START_Y, START_M, s.actualThrough)})</span>
          : <span className="pc-none">No recorded actuals yet — code ledger lines to this project to see reality against the plan.</span>}
      </div>
    </div>
  );
}
