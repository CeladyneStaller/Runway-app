// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useState } from "react";
import { grantPaymentsAt } from "../engine/grant";
import { burnStats } from "../engine/history";
import { money, moneyFull } from "../engine/money";
import { HORIZON, monthLabel } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { I } from "./chrome/icons";
import { CashActualModal } from "./chrome/modals";

export function History({ hist, setHist, flagOverrides, setFlagOverrides, method, setMethod, applyBaseline, setApplyBaseline, itemizedOpex, baselineOpex, cashActuals, setCashActuals, modelStarts, startY, startM, setStartY, setStartM, cash, setCash, projects, anchorActuals, setAnchorActuals }) {
  const { START_Y, START_M } = useStart();
  const max = Math.max(...hist.map(h => h.v), itemizedOpex);
  const { rows, avg, trailing, trend, applied, flaggedCount } = burnStats(hist, itemizedOpex, flagOverrides, method);
  const covered = applied <= itemizedOpex + 0.5;
  const methodName = method === "simple" ? "simple average" : method === "trailing" ? "trailing 3-month" : "linear trend";

  // cash-on-hand actuals vs model
  const [actualModal, setActualModal] = useState(null); // { editMonth } | null
  const prevCashOf = (m) => { if (m <= 0) return cash; const prev = cashActuals[m - 1]; return prev ? prev.cash : (modelStarts[m - 1] ?? cash); };
  const grantsReceived = (m, gmap) => grantPaymentsAt(projects, m).reduce((a, p) => a + (Number(gmap?.[p.id]) || 0), 0);
  const spendOf = (m, r) => (r.revenue || 0) + grantsReceived(m, r.grants) + (r.additional || 0) + (prevCashOf(m) - r.cash);
  const actualRows = Object.keys(cashActuals).map(k => ({ m: +k, ...cashActuals[k] })).filter(r => Number.isFinite(r.cash)).sort((a, b) => a.m - b.m);
  const nextMonth = actualRows.length ? Math.min(HORIZON, actualRows[actualRows.length - 1].m + 1) : 0;
  const saveActual = (month, data) => setCashActuals(a => ({ ...a, [month]: data }));
  const delActual = (m) => setCashActuals(a => { const n = { ...a }; delete n[m]; return n; });
  const latest = actualRows.length ? (() => { const r = actualRows[actualRows.length - 1]; const model = modelStarts[r.m] ?? 0; const varc = r.cash - model; return { m: r.m, varc, pct: model ? Math.abs(varc / model * 100).toFixed(1) : "0" }; })() : null;

  const [tab, setTab] = useState("summary");
  const TABS = [["summary", "Summary"], ["burn", "Burn"], ["cash", "Cash on hand"]];
  const driftCallout = latest && (
    <div className="callout" style={{ margin: "0 16px 16px", borderLeftColor: latest.varc >= 0 ? "var(--signal)" : "var(--danger)" }}>
      As of <b>{monthLabel(START_Y, START_M, latest.m)}</b>, actual cash is <b className="num">{latest.varc >= 0 ? "+" : "−"}{moneyFull(Math.abs(latest.varc))}</b> ({latest.pct}% {latest.varc >= 0 ? "above" : "below"}) versus the model — {latest.varc >= 0 ? "you’re burning slower than planned." : "you’re burning faster than planned."}
    </div>
  );

  return (
    <>
      <div className="subtabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={"subtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "summary" && (<>
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <div><h3>Projection setup</h3><p>Month 0 of the model. Every month label, the whole projection, and the Dashboard follow from these two figures.</p></div>
          </div>
          <div className="startcfg">
            <label className="fl">Projection start
              <div className="mrow">
                <select className="sel" value={startM} onChange={e => setStartM(+e.target.value)}>
                  {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((mo, i) => <option key={i} value={i}>{mo}</option>)}
                </select>
                <input className="inp" type="number" style={{ width: 82 }} value={startY} onChange={e => setStartY(+e.target.value)} />
              </div>
            </label>
            <label className="fl">Cash on hand at start
              <input className="inp" type="number" style={{ width: 132 }} value={cash} onChange={e => setCash(+e.target.value)} />
            </label>
            <div className="cfghint">Recorded actuals and every projected month are measured from here.</div>
          </div>
        </div>

        <div className="stats">
          <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Measured burn</div><div className="big">{money(applied)}</div><div className="meta">{methodName}{flaggedCount ? `, ${flaggedCount} flagged out` : ""}</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--danger)" }} /><div className="lab">Itemized lines</div><div className="big">{money(itemizedOpex)}</div><div className="meta">payroll + company costs</div></div>
          <div className="stat"><div className="accent" style={{ background: baselineOpex > 0.5 ? "var(--caution)" : "var(--line)" }} /><div className="lab">Untracked baseline</div><div className="big">{money(baselineOpex)}</div><div className="meta">{covered ? "lines cover measured spend" : "carried as an extra line"}</div></div>
          <div className="stat hero"><div className="lab">Cash drift</div><div className="big" style={{ color: !latest ? "#fff" : latest.varc >= 0 ? "var(--signal-2)" : "var(--danger)" }}>{latest ? <>{latest.varc >= 0 ? "+" : "−"}{money(Math.abs(latest.varc))}</> : "—"}</div><div className="meta">{latest ? `${latest.pct}% vs model at ${monthLabel(START_Y, START_M, latest.m)}` : "no actuals recorded"}</div></div>
        </div>

        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <div><h3>How the model meets reality</h3><p>Two reconciliations drive every number on the Dashboard. Change them under <b>Burn</b> and <b>Cash on hand</b>.</p></div>
            <span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>read-only</span>
          </div>
          <div style={{ padding: 16 }}>
            <div className="fieldlab" style={{ marginBottom: 8 }}>Burn</div>
            <div className="reconcile">
              <div className="rec-row"><span>Measured comprehensive run-rate ({methodName})</span><b className="num">{moneyFull(applied)}/mo</b></div>
              <div className="rec-row"><span>− Expected from line items (payroll + company costs)</span><b className="num">−{moneyFull(itemizedOpex)}/mo</b></div>
              <div className="rec-row rec-total"><span>= Untracked “other operating costs”</span><b className="num" style={{ color: baselineOpex > 0.5 ? "var(--caution)" : "var(--muted)" }}>{moneyFull(baselineOpex)}/mo</b></div>
            </div>
            <div className="fieldlab" style={{ margin: "18px 0 8px" }}>Cash</div>
            <div className="reconcile">
              <div className="rec-row"><span>Model balance at {latest ? monthLabel(START_Y, START_M, latest.m) : "—"}</span><b className="num">{latest ? moneyFull(modelStarts[latest.m] ?? 0) : "—"}</b></div>
              <div className="rec-row"><span>− Recorded actual cash</span><b className="num">{latest ? "−" + moneyFull(actualRows[actualRows.length - 1].cash) : "—"}</b></div>
              <div className="rec-row rec-total"><span>= Drift carried into the forecast</span><b className="num" style={{ color: !latest ? "var(--muted)" : latest.varc >= 0 ? "var(--signal-ink)" : "var(--danger)" }}>{latest ? <>{latest.varc >= 0 ? "+" : "−"}{moneyFull(Math.abs(latest.varc))}</> : "—"}</b></div>
            </div>
            <div className="fieldlab" style={{ margin: "18px 0 8px" }}>What the Dashboard is actually using</div>
            <div className="modechips">
              <span className={"modechip" + (applyBaseline ? " on" : "")}><i />{applyBaseline ? "Comprehensive spend drives the runway" : "Itemized line items only"}</span>
              <span className={"modechip" + (anchorActuals ? " on" : "")}><i />{anchorActuals ? "Re-anchored to recorded actuals" : "Model only — actuals ignored"}</span>
            </div>
          </div>
        </div>
        {driftCallout}
      </>)}

      {tab === "burn" && (<>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h">
          <div><h3>Measured monthly spend</h3><p>Comprehensive company spend. The dark part of each bar is explained by your line items; amber is not. Months that deviate from your expected total are flagged as mismatches — click a bar to flag or clear it.</p></div>
          <span className={"chip " + (flaggedCount ? "warn" : "ok")}>{flaggedCount} flagged</span>
        </div>
        <div style={{ padding: "6px 18px 4px" }}>
          <div className="histbars">
            {rows.map(r => {
              const excess = Math.max(0, r.v - itemizedOpex);
              return (
                <div key={r.i} className={"hbar" + (r.flagged ? " flagged" : "")} onClick={() => setFlagOverrides(o => ({ ...o, [r.i]: !r.flagged }))} title={r.flagged ? "Flagged mismatch — click to include in the run-rate" : "Click to flag as a mismatch"}>
                  <div className="bv">{money(r.v)}{r.flagged && <span className="mm">{r.variance >= 0 ? "+" : "−"}{money(Math.abs(r.variance))}</span>}</div>
                  <div className="bar" style={{ height: `${(r.v / max) * 130}px` }}>
                    {excess > 0 && <div className={"seg exc" + (r.flagged ? " flag" : "")} style={{ height: `${(excess / r.v) * 100}%` }} />}
                    <div className="seg exp" style={{ height: `${(Math.min(r.v, itemizedOpex) / r.v) * 100}%` }} />
                  </div>
                  <div className="bm">{r.mo} ’26{r.flagged ? <span className="flagtag">⚠ mismatch</span> : null}</div>
                </div>
              );
            })}
          </div>
          <div className="histlegend">
            <span><i className="sw exp" /> Explained by line items (expected {moneyFull(itemizedOpex)}/mo)</span>
            <span><i className="sw exc" /> Unexplained</span>
            <span><i className="sw flag" /> Flagged mismatch</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <div><h3>Comprehensive burn → Dashboard</h3><p>Your measured spend, summarized into the run-rate that drives the runway. Flagged months are left out of the summary.</p></div>
        </div>
        <div style={{ padding: 16 }}>
          <div className="methods">
            {[["simple", "Simple average", avg, "Mean of unflagged months. Stable, slow to react."],
              ["trailing", "Trailing 3-month", trailing, "Last 3 unflagged months. Reacts to recent shifts."],
              ["trend", "Linear trend", trend, "Fits a line and projects next month. Captures direction."]].map(([k, name, val, desc]) => (
              <button key={k} className={"method" + (method === k ? " on" : "")} onClick={() => setMethod(k)}>
                <div className="mn">{name}</div>
                <div className="mv num">{moneyFull(val)}</div>
                <div className="md">{desc}</div>
              </button>
            ))}
          </div>
          <div className="reconcile">
            <div className="rec-row"><span>Measured comprehensive run-rate ({methodName}) — drives the Dashboard</span><b className="num">{moneyFull(applied)}/mo</b></div>
            <div className="rec-row"><span>− Expected from line items (payroll + company costs)</span><b className="num">−{moneyFull(itemizedOpex)}/mo</b></div>
            <div className="rec-row rec-total"><span>= Untracked “other operating costs”</span><b className="num" style={{ color: baselineOpex > 0.5 ? "var(--caution)" : "var(--muted)" }}>{moneyFull(baselineOpex)}/mo</b></div>
          </div>
          <div className="basetoggle">
            <button className={"gtoggle " + (applyBaseline ? "on" : "")} onClick={() => setApplyBaseline(v => !v)}>
              <span className="dot" />{applyBaseline ? "Comprehensive spend drives the runway" : "Runway uses itemized line items only"}
            </button>
            <span className="basehint">
              {covered
                ? "Your line items already account for your measured spend, so nothing untracked is added."
                : applyBaseline
                  ? <>The runway is anchored to your measured comprehensive spend — the <b className="num">{moneyFull(baselineOpex)}/mo</b> your line items don’t explain is carried as an “Other operating costs” line.</>
                  : "Turn on to anchor the runway to measured spend; otherwise only your itemized line items count."}
            </span>
          </div>
        </div>
      </div>
      </>)}

      {tab === "cash" && (<>
      <div className="panel">
        <div className="panel-h">
          <div><h3>Cash on hand — actual vs model</h3><p>Record your real numbers each month to validate the projection. Spend is derived from the change in cash net of income; the cash points also plot on the Dashboard chart.</p></div>
          <button className="addbtn" onClick={() => setActualModal({ editMonth: null })}>{I.plus} Add month</button>
        </div>
        <div className="pgrid">
          <table className="tbl">
            <thead><tr><th>Month</th><th style={{ textAlign: "right" }}>Actual cash</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Grants in</th><th style={{ textAlign: "right" }}>Spend</th><th style={{ textAlign: "right" }}>Δ vs model</th><th></th></tr></thead>
            <tbody>
              {actualRows.map((r) => {
                const model = modelStarts[r.m] ?? 0, varc = r.cash - model, gr = grantsReceived(r.m, r.grants);
                return (
                  <tr key={r.m} className="clickrow" onClick={() => setActualModal({ editMonth: r.m })} title="Click to edit">
                    <td className="num" style={{ fontSize: 12.5 }}>{monthLabel(START_Y, START_M, r.m)}</td>
                    <td className="amt num" style={{ fontWeight: 500 }}>{moneyFull(r.cash)}</td>
                    <td className="amt num" style={{ color: "var(--muted)" }}>{moneyFull(r.revenue || 0)}</td>
                    <td className="amt num" style={{ color: gr > 0 ? "var(--signal-ink)" : "var(--muted-2)" }}>{gr > 0 ? moneyFull(gr) : "—"}</td>
                    <td className="amt num" style={{ color: "var(--danger)" }}>{moneyFull(spendOf(r.m, r))}</td>
                    <td className="amt num" style={{ fontWeight: 500, color: varc >= 0 ? "var(--signal-ink)" : "var(--danger)" }}>{varc >= 0 ? "+" : "−"}{moneyFull(Math.abs(varc))}</td>
                    <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={e => { e.stopPropagation(); delActual(r.m); }} aria-label="Remove">{I.trash}</button></td>
                  </tr>
                );
              })}
              {actualRows.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No actuals recorded yet — add a month to start validating.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="basetoggle" style={{ padding: "2px 16px 14px", marginTop: 0 }}>
          <button className={"gtoggle " + (anchorActuals ? "on" : "")} onClick={() => setAnchorActuals(v => !v)}>
            <span className="dot" />{anchorActuals ? "Projection re-anchored to actuals" : "Projection uses the model only"}
          </button>
          <span className="basehint">{anchorActuals
            ? "Recorded months use your actual balance and the forecast continues from your latest actual, so the runway reflects where you really are."
            : "Turn on to replace the model with your recorded balances for elapsed months and re-anchor the forecast."}</span>
        </div>
        {driftCallout}
      </div>
      </>)}

      {actualModal && (
        <CashActualModal
          editMonth={actualModal.editMonth}
          defaultMonth={actualModal.editMonth ?? nextMonth}
          initial={actualModal.editMonth != null ? cashActuals[actualModal.editMonth] : null}
          projects={projects}
          modelStarts={modelStarts}
          prevCashOf={prevCashOf}
          onClose={() => setActualModal(null)}
          onSave={(month, data) => { if (actualModal.editMonth != null && actualModal.editMonth !== month) delActual(actualModal.editMonth); saveActual(month, data); }}
        />
      )}
    </>
  );
}
