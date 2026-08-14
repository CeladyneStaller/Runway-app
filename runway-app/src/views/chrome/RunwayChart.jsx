// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React from "react";
import { plotFrame } from "../../engine/plotframe";
import { money } from "../../engine/money";
import { dateShort } from "../../engine/time";
import { useStart } from "../../state/StartCtx";

export function RunwayChart({ rows, rowsUp, rowsOp, band, upBand = null, cash,
                              // ⚠️ BOTH DEFAULT TO TODAY'S BEHAVIOUR. `axisBreak` false forces one true
                              // scale; `months` widens the window. A caller that has not been updated
                              // renders exactly as before.
                              axisBreak = true, months = null, milestones, projectEnd, showUpside, zero, zeroUp, actuals }) {
  const { START_Y, START_M } = useStart();
  const W = 980, H = 400, L = 66, R = 26, T = 22, B = 40;

  const lastMsT = Math.max(0, ...milestones.map(m => m.t), projectEnd ? projectEnd.t : 0);
  // ⚠️ THE WINDOW IS ALREADY ADAPTIVE — it fits the crossing and the last milestone rather than a fixed
  // 18. So "show the full horizon" does not widen a fixed window; it REMOVES the fit, which is a
  // different thing from what the option's first draft assumed and worth saying in its wording.
  const tMax = months
    ? Math.min(rows.length, months)
    : Math.min(rows.length, Math.ceil(Math.max((zeroUp?.t || 0) + 2, lastMsT + 2, 12)));

  // trace points (t = months elapsed; balance = start-of-month value, plus final end)
  const traceOf = (rs) => {
    const p = rs.map((r, m) => ({ t: m, b: r.start }));
    p.push({ t: rs.length, b: rs[rs.length - 1].end });
    return p;
  };
  const clip = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].t <= tMax) out.push(pts[i]);
      else { const a = pts[i - 1], b = pts[i], f = (tMax - a.t) / (b.t - a.t); out.push({ t: tMax, b: a.b + f * (b.b - a.b) }); break; }
    }
    return out;
  };
  const pts = clip(traceOf(rows));
  const ptsUp = clip(traceOf(rowsUp));
  const actualPts = Object.keys(actuals || {}).map(k => ({ t: +k, b: +actuals[k] })).filter(p => p.t <= tMax && Number.isFinite(p.b)).sort((a, b) => a.t - b.t);

  const balMax = Math.ceil(Math.max(cash, ...pts.map(p => p.b), ...ptsUp.map(p => p.b), ...actualPts.map(p => p.b)) / 50000) * 50000 || 50000;
  const negMin = Math.min(0, ...pts.map(p => p.b), ...actualPts.map(p => p.b));
  const balMin = -Math.max(50000, Math.ceil(Math.abs(negMin * 0.35) / 50000) * 50000);

  // A raise is a step change, not part of the band you operate in. Left on one linear axis it flattens
  // the entire runway onto the baseline — the $6M decides the scale and the $300k you actually live on
  // becomes unreadable. So break the axis: full resolution where the decisions are, a compressed shelf
  // for the money that lands. The operating ceiling comes from the runway WITHOUT financing.
  const ptsOp = clip(traceOf(rowsOp || rows));
  const opCeil = Math.max(50000, Math.ceil(Math.max(cash, ...ptsOp.map(p => p.b), ...actualPts.map(p => p.b)) / 50000) * 50000);
  // ⚠️ THE BREAK IS STILL COMPUTED, AND CAN NOW BE REFUSED. `wouldBreak` is what the modal asks to
  // decide whether the option is worth showing at all — a switch with nothing to act on is hidden.
  const wouldBreak = balMax > opCeil * 1.8;
  const BRK = wouldBreak && axisBreak !== false;
  const breakAt = BRK ? opCeil : balMax;
  const F = 0.74;              // share of the plot given to the operating band
  const PH = H - T - B;

  // ⚠️ THE X SCALE DELEGATES; THE Y SCALE DOES NOT, AND MUST NOT.
  //
  // `y` below is a BROKEN AXIS — above a 1.8x break it gives 74% of the plot to the operating band and
  // compresses a raise into the rest. `plotFrame.y` is linear, so delegating it would flatten the
  // operating band into invisibility on exactly the charts the break exists for.
  //
  // `xt` is the CONTINUOUS mode, not the index mode: this chart places marks at a fractional position
  // in a time domain, and a milestone at month 6.5 is a real thing. Forcing it into month indices to
  // share a frame would have moved every marker.
  //
  // ⚠️ AND ONLY THE X-SIDE CHROME IS SAFE TO TAKE FROM THE FRAME. `f.rules` and `f.zeroY` assume a
  // linear y and would be drawn in the wrong places here.
  const _f = plotFrame({ w: W, h: H, n: tMax + 1, startY: START_Y, startM: START_M,
                         pad: { l: L, r: R, t: T, b: B },
                         // THIS CHART CARRIES A YEAR ON EVERY LABEL — it labels every 2-6 months, so
                         // there is no smear to avoid, and Corey wants it kept. An explicit opt-in from
                         // the one chart that wants it, rather than a rule that infers it panel-wide.
                         yearEvery: true });
  const x = (t) => _f.xt(t, tMax);
  const y = (b) => {
    if (!BRK) return T + (1 - (b - balMin) / (balMax - balMin)) * PH;
    if (b <= breakAt) return T + PH * (1 - ((b - balMin) / (breakAt - balMin)) * F);
    return T + PH * (1 - F) * (1 - (b - breakAt) / (balMax - breakAt));
  };
  const yc = (b) => Math.min(H - B, Math.max(T, y(b))); // clamp to plot for markers
  const y0 = y(0);
  const cb = (b) => Math.max(balMin, Math.min(balMax, b)); // clamp balance into visible range

  const line = (P) => P.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(cb(p.b)).toFixed(1)}`).join(" ");

  // Confidence band polygon: fill between the ceiling (top) and floor (bottom) curves. Ceiling forward
  // then floor backward = a closed area. Drawn behind everything so the expected line sits on top.
  // Sample the band through the SAME clip(traceOf()) path as the main line so the two use identical
  // month sampling (start-of-month at t=m, plus the final end point) and the identical horizontal clip
  // to tMax — otherwise the band is shifted a month and sprays past where the line stops.
  const bandPts = (rws) => (rws && rws.length ? clip(traceOf(rws)) : []);
  const bandArea = (() => {
    if (!band) return null;
    const top = bandPts(band.ceiling.rows).map(p => `${x(p.t).toFixed(1)} ${y(cb(p.b)).toFixed(1)}`);
    const bot = bandPts(band.floor.rows).map(p => `${x(p.t).toFixed(1)} ${y(cb(p.b)).toFixed(1)}`).reverse();
    if (top.length < 2) return null;
    return `M${top.join(" L")} L${bot.join(" L")} Z`;
  })();
  // ── the speculative band ─────────────────────────────────────────────────────────────────────
  //
  // ⚠️ IT ANSWERS A DIFFERENT QUESTION FROM THE SPECULATIVE LINE. The line says "here is the curve if
  // this money arrives". The band says "and here is how wide the answer is EVEN THEN" — computed as if
  // that revenue were committed, because a band around a curve that may not happen at all would
  // compound two uncertainties into one shape nobody can read.
  //
  // ⚠️ AND IT IS DRAWN ONLY WHERE IT SITS OUTSIDE THE GREEN ONE. Two translucent fills produce a third
  // colour that means nothing — a reader sees a muddy region and cannot tell whether it is agreement,
  // disagreement, or a rendering artefact. Clamping this band's FLOOR to the committed band's CEILING
  // means that where the two agree, the green shows through, and that is the honest reading.
  const upBandArea = (() => {
    if (!showUpside || !upBand) return null;
    const ceilPts = bandPts(upBand.ceiling.rows);
    const floorPts = bandPts(upBand.floor.rows);
    if (ceilPts.length < 2) return null;
    const greenCeil = band ? bandPts(band.ceiling.rows) : [];
    const at = (arr, t) => arr.find(p => p.t === t);
    const top = ceilPts.map(p => `${x(p.t).toFixed(1)} ${y(cb(p.b)).toFixed(1)}`);
    const bot = floorPts.map(p => {
      const g = at(greenCeil, p.t);
      // the higher of the two floors, so nothing is drawn over the committed band
      const b = g && g.b > p.b ? g.b : p.b;
      return `${x(p.t).toFixed(1)} ${y(cb(b)).toFixed(1)}`;
    }).reverse();
    return `M${top.join(" L")} L${bot.join(" L")} Z`;
  })();

  const actualPath = actualPts.length > 1 ? actualPts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(cb(p.b)).toFixed(1)}`).join(" ") : "";

  // split active trace at zero crossing for colour
  let above = pts, below = null;
  if (zero && zero.t <= tMax) {
    above = []; below = [{ t: zero.t, b: 0 }];
    for (const p of pts) (p.t <= zero.t ? above : below).push(p);
    above.push({ t: zero.t, b: 0 });
  }
  const areaPath = (() => {
    const a = above;
    if (a.length < 2) return "";
    return line(a) + ` L${x(a[a.length - 1].t)} ${y0} L${x(a[0].t)} ${y0} Z`;
  })();

  // Tick step follows the band being labelled, not the outlier: a fixed 100k step across a $6M domain
  // draws sixty gridlines. Above a break we want one label — the number the money reaches.
  const niceStep = (span) => {
    const raw = Math.max(span, 1) / 6, p = Math.pow(10, Math.floor(Math.log10(raw)));
    return Math.max(50000, Math.ceil(raw / p) * p);
  };
  const yTicks = [];
  const step = niceStep(breakAt - balMin);
  for (let v = Math.ceil(balMin / step) * step; v <= breakAt + 1; v += step) yTicks.push(v);
  if (!yTicks.some(v => Math.abs(v) < 1)) yTicks.push(0);
  if (BRK) yTicks.push(balMax);

  return (
    <svg className="svgc" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Cash balance projection over time showing the zero-funds crossing and milestone dates">
      <defs>
        <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--signal-2)" stopOpacity="0.32"/>
          <stop offset="1" stopColor="var(--signal-2)" stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      {/* ORANGE UNDER GREEN. It is already clamped to the committed ceiling, so it cannot cover it —
          drawing it first is belt and braces, and keeps the committed band unambiguously on top. */}
      {upBandArea && (
        <path d={upBandArea} fill="var(--caution)" opacity="0.13" stroke="none"/>
      )}
      {bandArea && (
        <>
          <path d={bandArea} fill="var(--signal-2)" opacity="0.10" stroke="none"/>
          <path data-band="floor" d={line(bandPts(band.floor.rows))} fill="none" stroke="var(--signal-2)" strokeWidth="1" strokeDasharray="3 3" opacity="0.35"/>
          <path data-band="ceiling" d={line(bandPts(band.ceiling.rows))} fill="none" stroke="var(--signal-2)" strokeWidth="1" strokeDasharray="3 3" opacity="0.35"/>
        </>
      )}

      {/* danger band below waterline */}
      <rect x={L} y={y0} width={W - L - R} height={H - B - y0} fill="var(--danger)" opacity="0.07"/>

      {/* axis break — the scale changes here, and it has to say so */}
      {BRK && (() => {
        const yb = T + PH * (1 - F);
        return (
          <g>
            <rect x={L} y={yb - 5} width={W - L - R} height={10} fill="var(--ink)" opacity="0.55"/>
            <line x1={L} x2={W - R} y1={yb} y2={yb} stroke="#fff" strokeOpacity="0.22" strokeDasharray="3 5"/>
            <path d={`M${L - 7} ${yb + 4} l9 -8 M${L - 2} ${yb + 4} l9 -8`} fill="none" stroke="var(--on-dark-mute)" strokeWidth="1.5" strokeOpacity="0.9" strokeLinecap="round"/>
            <text x={W - R} y={yb - 9} textAnchor="end" fontSize="9.5" fontFamily="var(--fb)" letterSpacing="0.08em"
                  fill="var(--on-dark-mute)" opacity="0.7">SCALE BREAK · {money(breakAt)} TO {money(balMax)} COMPRESSED</text>
          </g>
        );
      })()}

      {/* gridlines */}
      {yTicks.map(v => (
        <g key={"y" + v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#fff" strokeOpacity={v === 0 ? 0 : 0.055}/>
          <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize="11.5" fontFamily="var(--fm)"
                fill={v === 0 ? "var(--danger)" : "var(--on-dark-mute)"} opacity={v === 0 ? 0.95 : 0.75}>
            {v === 0 ? "$0" : money(v)}
          </text>
        </g>
      ))}
      {/* LABELS FROM THE SHARED FRAME. Same text this chart already produced — `yearEvery` keeps the
          year on every one — but the SPACING is now the panel's adaptive sequence rather than this
          file's own `tickEvery`, so a 36-month window thins the same way here as everywhere else. */}
      {_f.ticks.map(t => (
        <text key={"x" + t.i} x={x(t.i)} y={H - B + 22} textAnchor="middle" fontSize="11.5"
              fontFamily="var(--fm)" fill="var(--on-dark-mute)" opacity="0.75">{t.label}</text>
      ))}

      {/* waterline */}
      <line x1={L} x2={W - R} y1={y0} y2={y0} stroke="var(--danger)" strokeWidth="1.5" strokeDasharray="2 4" opacity="0.8"/>
      <text x={W - R} y={y0 - 7} textAnchor="end" fontSize="10.5" letterSpacing="0.12em" fontFamily="var(--fb)"
            fontWeight="600" fill="var(--danger)" opacity="0.85">WATERLINE · OUT OF CASH</text>

      {/* upside ghost line */}
      {showUpside && (
        <>
          <path data-trace="upside" d={line(ptsUp)} fill="none" stroke="var(--caution)" strokeWidth="2" strokeDasharray="5 5" opacity="0.85"/>
          {zeroUp && zeroUp.t <= tMax && (!zero || zeroUp.t > zero.t + 0.02) && <circle cx={x(zeroUp.t)} cy={y0} r="4" fill="none" stroke="var(--caution)" strokeWidth="2"/>}
        </>
      )}

      {/* area + active trace */}
      <path d={areaPath} fill="url(#fill)"/>
      {above.length > 1 && <path data-trace="main" d={line(above)} fill="none" stroke="var(--signal-2)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>}
      {below && below.length > 1 && <path d={line(below)} fill="none" stroke="var(--danger)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>}

      {/* milestone gates */}
      {milestones.map((ms, i) => {
        // ⚠️ THIS RECOMPUTED `pass` LOCALLY and ignored `stranded`, so the chart kept drawing a green
        // dot and a tick for a milestone the company cannot reach — the same false green the tile had,
        // surviving in the graphic beside it because the two derived the answer independently.
        //
        // `msWithBal` already carries both. A SECOND DEFINITION of "does this milestone pass" is
        // exactly what let one of them stay wrong.
        const stranded = !!ms.stranded;
        const pass = ms.bal >= 0 && !stranded;
        const lx = x(ms.t); if (ms.t > tMax) return null;
        const ly = 34 + (i % 2) * 30;
        return (
          <g key={ms.id}>
            <line x1={lx} x2={lx} y1={T} y2={H - B} stroke="#fff" strokeOpacity="0.16" strokeDasharray="3 4"/>
            {/* DOT IS THE BALANCE, RING IS WHETHER YOU GET THERE — the convention the milestones
                chart uses, so the two read the same way. A hollow ring on a pale dot is a milestone
                with money on the day and no company left to collect it. */}
            <circle cx={lx} cy={yc(ms.bal)} r="3.5"
                    fill={stranded ? "none" : (pass ? "var(--signal-2)" : "var(--danger)")}
                    stroke={stranded ? "var(--danger)" : "none"} strokeWidth="1.6" />
            <g transform={`translate(${Math.min(lx, W - R - 96)}, ${ly})`}>
              <text x="0" y="0" fontSize="11" fontFamily="var(--fb)" fontWeight="600" fill="var(--on-dark)">{ms.label}</text>
              <text x="0" y="15" fontSize="11.5" fontFamily="var(--fm)" fill={stranded ? "var(--danger)" : pass ? "var(--signal-2)" : "var(--danger)"}>
                {/* NAMED, not just marked. "Needs $90k" is the next thing to do; a cross is not. */}
                {money(ms.bal, false)}{" "}
                {stranded ? `needs ${money(ms.bridge || 0, false)}` : (pass ? "✓" : "✗")}
              </text>
            </g>
          </g>
        );
      })}

      {/* project end gate */}
      {projectEnd && projectEnd.t <= tMax && (
        <g>
          <line x1={x(projectEnd.t)} x2={x(projectEnd.t)} y1={T} y2={H - B} stroke="var(--signal-2)" strokeWidth="1.5" strokeOpacity="0.5"/>
          <circle cx={x(projectEnd.t)} cy={yc(projectEnd.bal)} r="4" fill="var(--signal-2)" stroke="var(--ink)" strokeWidth="1.5"/>
          <text x={x(projectEnd.t)} y={H - B - 8} textAnchor="middle" fontSize="10.5" letterSpacing=".08em" fontWeight="600" fill="var(--signal-2)">PROJECT END</text>
        </g>
      )}

      {/* zero crossing marker */}
      {zero && zero.t <= tMax && (
        <g>
          <circle cx={x(zero.t)} cy={y0} r="5.5" fill="var(--danger)" stroke="var(--ink)" strokeWidth="2"/>
          <g transform={`translate(${x(zero.t)}, ${y0 + 26})`}>
            <text x="0" y="0" textAnchor="middle" fontSize="12" fontFamily="var(--fm)" fontWeight="500" fill="#fff">{dateShort(zero.date)}</text>
            <text x="0" y="15" textAnchor="middle" fontSize="10.5" fontFamily="var(--fb)" fill="var(--danger)">zero funds</text>
          </g>
        </g>
      )}

      {/* actual cash overlay — validates the projection against recorded balances */}
      {actualPts.length > 0 && (
        <g>
          {actualPath && <path d={actualPath} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>}
          {actualPts.map(p => <circle key={p.t} cx={x(p.t)} cy={yc(p.b)} r="3.8" fill="#fff" stroke="var(--ink)" strokeWidth="1.5"/>)}
        </g>
      )}

      {/* start marker */}
      <circle cx={x(0)} cy={y(cash)} r="4" fill="#fff"/>
      <text x={x(0) + 8} y={y(cash) - 8} fontSize="11.5" fontFamily="var(--fm)" fill="#fff">{money(cash)}</text>
    </svg>
  );
}
