import React from "react";
import { monthLabel } from "../../engine/time";
import { sortedJournal, planDelta } from "../../engine/journal";
import { moneyFull } from "../../engine/money";

// The projection journal, shown as overlaid curves: every past forecast, faintest first, with today's
// forecast bold on top and the cash you actually recorded as dots. The point is the SHAPE of the fan —
// whether your forecasts have been converging on reality or drifting away from it.
//
// This is Phase 1, the recorder. It deliberately computes no error statistics: with a handful of
// snapshots any such number would be false precision, which is the same trap that kept Monte Carlo out
// of the confidence band. What it does do is start the clock.

const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
};

export function JournalPanel({ journal = [], currentCurve = [], cashActuals = {}, startY, startM, onSnapshot }) {
  const snaps = sortedJournal(journal);           // newest first
  const oldestFirst = [...snaps].reverse();

  // how far right to draw: the furthest month any curve meaningfully covers, capped so the fan is legible
  const tMax = Math.max(
    12,
    ...oldestFirst.map(s => Math.min(s.curve.length - 1, (s.zeroMonths ?? 0) + 3)),
    Math.min(currentCurve.length - 1, 18),
  );
  const actualMonths = Object.keys(cashActuals).map(Number).filter(m => Number.isFinite(cashActuals[m]?.cash));

  const all = [
    ...oldestFirst.flatMap(s => s.curve.slice(0, tMax + 1)),
    ...currentCurve.slice(0, tMax + 1),
    ...actualMonths.map(m => cashActuals[m].cash),
  ].filter(Number.isFinite);
  const hi = all.length ? Math.max(...all, 0) : 1;
  const lo = all.length ? Math.min(...all, 0) : 0;

  const W = 900, H = 300, L = 64, R = 18, T = 16, B = 34;
  const x = (m) => L + (m / Math.max(1, tMax)) * (W - L - R);
  const y = (b) => T + (1 - (b - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const line = (curve) => curve.slice(0, tMax + 1)
    .map((b, m) => `${m ? "L" : "M"}${x(m).toFixed(1)} ${y(b).toFixed(1)}`).join(" ");

  const ticks = [];
  const every = tMax > 24 ? 6 : tMax > 14 ? 3 : 2;
  for (let m = 0; m <= tMax; m += every) ticks.push(m);

  return (
    <div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-h">
          <div>
            <h3>Forecast journal</h3>
            <p>What this app predicted, recorded weekly, so it can later be checked against what happened.</p>
          </div>
          <button className="addbtn ghost" onClick={onSnapshot}>Snapshot now</button>
        </div>

        {snaps.length === 0 ? (
          <div className="jr-empty">
            No snapshots yet. One is taken automatically each week — the first arrives as soon as there's
            something worth recording.
          </div>
        ) : (
          <>
            <div style={{ padding: "4px 14px 0" }}>
              <svg className="jr-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
                   aria-label="Past forecasts overlaid with recorded cash">
                {/* zero line */}
                {lo < 0 && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--danger)" strokeWidth="1" strokeDasharray="4 4" opacity="0.5"/>}
                {ticks.map(m => (
                  <g key={m}>
                    <line x1={x(m)} x2={x(m)} y1={T} y2={H - B} stroke="var(--line-2)" strokeWidth="1" opacity="0.6"/>
                    <text x={x(m)} y={H - B + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">
                      {monthLabel(startY, startM, m)}
                    </text>
                  </g>
                ))}
                {/* past forecasts, oldest faintest */}
                {oldestFirst.map((s, i) => (
                  <path key={s.id} data-jr="past" d={line(s.curve)} fill="none" stroke="var(--signal-2)"
                        strokeWidth="1.5" opacity={0.18 + (0.5 * (i + 1)) / oldestFirst.length}/>
                ))}
                {/* today */}
                {currentCurve.length > 1 &&
                  <path data-jr="current" d={line(currentCurve)} fill="none" stroke="var(--ink-txt)" strokeWidth="2.5" strokeLinejoin="round"/>}
                {/* recorded reality */}
                {actualMonths.filter(m => m <= tMax).map(m => (
                  <circle key={m} data-jr="actual" cx={x(m)} cy={y(cashActuals[m].cash)} r="4"
                          fill="var(--caution)" stroke="var(--card)" strokeWidth="1.5"/>
                ))}
              </svg>
              <div className="jr-legend">
                <span><i className="jr-k jr-past" /> past forecasts</span>
                <span><i className="jr-k jr-now" /> today's forecast</span>
                <span><i className="jr-k jr-act" /> cash actually recorded</span>
              </div>
            </div>

            <div className="jr-note">
              A gap between an old forecast and what you recorded is <b>plan versus reality</b>, not pure
              forecast error — hiring someone or landing a grant moves the plan, and no arithmetic
              separates that from a bad prediction after the fact. The weekly cadence is what keeps the
              two legible: two snapshots seven days apart can't differ because a quarter unfolded, so a
              jump that fast is the plan moving.
            </div>
          </>
        )}
      </div>

      {snaps.length > 0 && (
        <div className="panel">
          <div className="panel-h"><div><h3>Snapshots</h3><p>{snaps.length} recorded.</p></div></div>
          <table className="tbl">
            <thead>
              <tr><th>Taken</th><th>Predicted runway</th><th>Tiers</th><th className="amt">Ending balance</th><th className="amt">Moved by</th></tr>
            </thead>
            <tbody>
              {snaps.map((s, i) => {
                const prev = snaps[i + 1];
                const d = prev ? planDelta(prev, s) : null;
                const tiers = [s.toggles.committed && "committed", s.toggles.expected && "expected",
                               s.toggles.speculative && "speculative", s.toggles.financing && "financing"]
                               .filter(Boolean).join(" + ");
                return (
                  <tr key={s.id}>
                    <td className="num">{fmtDate(s.takenAt)}{s.auto ? "" : " ·"}</td>
                    <td className="num">{s.zeroMonths == null ? "no crossing" : `${s.zeroMonths.toFixed(1)} mo`}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{tiers || "none"}</td>
                    <td className="amt num">{moneyFull(s.end)}</td>
                    <td className="amt num" style={{ color: "var(--muted)" }}>
                      {d ? `${moneyFull(d.maxAbs)} in ${d.days.toFixed(0)}d` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
