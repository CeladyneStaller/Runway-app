// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useState } from "react";
import { money, moneyFull } from "../engine/money";
import { empCostAt, empTitleAt } from "../engine/payroll";
import { TIERS, lineSpan } from "../engine/projection";
import { monthLabel, uid } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { Payroll } from "./Payroll";
import { Projects } from "./Projects";
import { I } from "./chrome/icons";
import { saasSeries } from "../engine/saas";
import { useTabPrefs, visibleTabs, resolveTab } from "../state/tabprefs";

export function CashFlow({ routeTab, setRouteTab = () => {}, lines, setLines, projWeeks, projectCount, payrollMonthly, empCount, baselineOpex, employees = [], fringePct = 0, projectLines = [], saas = [], onGoSubs }) {
  const { START_Y, START_M } = useStart();
  const tabPrefs = useTabPrefs();
  const tab = resolveTab("flow", routeTab, "net", tabPrefs);
  const setTab = (t) => setRouteTab(t);
  const upd = (id, patch) => setLines(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l));
  const del = (id) => setLines(ls => ls.filter(l => l.id !== id));
  const add = (kind) => setLines(ls => [...ls, {
    id: uid(), label: kind === "cost" ? "New cost" : "New revenue", cadence: "recurring", kind,
    amount: kind === "cost" ? 5000 : 10000, start: 0, end: null, growthPct: 0,
    ...(kind === "revenue" ? { confidence: "expected" } : {}),
  }]);
  const cycleConf = (id, c) => upd(id, { confidence: TIERS[(TIERS.indexOf(c) + 1) % TIERS.length] });
  const timing = (l) => l.cadence === "onetime"
    ? monthLabel(START_Y, START_M, l.start)
    : `${monthLabel(START_Y, START_M, l.start)} → ${l.end == null ? "ongoing" : monthLabel(START_Y, START_M, l.end)}`;

  const group = (kind) => lines.filter(l => l.kind === kind);
  const activeNow = (l) => (l.start || 0) <= 0 && (l.end == null || l.end >= 0);
  const recSum = (kind) => lines.filter(l => l.kind === kind && l.cadence === "recurring" && activeNow(l)).reduce((a, l) => a + (+l.amount || 0), 0);
  const oneSum = (kind) => lines.filter(l => l.kind === kind && l.cadence === "onetime").reduce((a, l) => a + (+l.amount || 0), 0);
  const recRev = recSum("revenue"), recCost = recSum("cost");
  const grantIn = projectLines.filter(l => l.kind === "revenue");
  const projOut = projectLines.filter(l => l.kind === "cost");
  const grantTotal = grantIn.reduce((a, l) => a + lineSpan(l), 0);
  const projTotal = projOut.reduce((a, l) => a + lineSpan(l), 0);
  const costMo = recCost + payrollMonthly + baselineOpex;

  const Row = (l) => (
    <tr key={l.id}>
      <td style={{ fontWeight: 500 }}>
        <input className="inp" style={{ width: 150, textAlign: "left" }} value={l.label} onChange={e => upd(l.id, { label: e.target.value })} />
      </td>
      <td>
        <select className="sel" value={l.cadence} onChange={e => upd(l.id, { cadence: e.target.value, end: e.target.value === "onetime" ? undefined : null })}>
          <option value="recurring">Recurring</option><option value="onetime">One-time</option>
        </select>
      </td>
      <td className="amt"><input className="inp" type="number" value={l.amount} onChange={e => upd(l.id, { amount: +e.target.value })} /></td>
      <td className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{timing(l)}</td>
      <td className="amt">{l.cadence === "recurring"
        ? <input className="inp sm" type="number" value={l.growthPct || 0} onChange={e => upd(l.id, { growthPct: +e.target.value })} />
        : <span style={{ color: "var(--muted-2)" }}>—</span>}
        {l.cadence === "recurring" ? <span style={{ fontSize: 11, color: "var(--muted-2)", marginLeft: 4 }}>%/mo</span> : null}
      </td>
      <td>{l.kind === "revenue"
        ? <button className={"conf " + l.confidence} onClick={() => cycleConf(l.id, l.confidence)} title="Click to change confidence">{l.confidence}</button>
        : <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>}
      </td>
      <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => del(l.id)} aria-label="Delete line">{I.trash}</button></td>
    </tr>
  );

  // one read-only line in the Net cash flow rollup, whichever tab actually owns it
  const sumRow = (key, label, src, amount, per, when, conf) => (
    <tr key={key} className="rorow">
      <td style={{ fontWeight: 500 }}>{label}</td>
      <td style={{ fontSize: 12, color: "var(--muted)" }}>{src}</td>
      <td className="amt num">{moneyFull(amount)}{per ? <span style={{ fontSize: 11, color: "var(--muted-2)" }}>/mo</span> : null}</td>
      <td className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{when}</td>
      <td>{conf ? <span className={"conf " + conf} style={{ cursor: "default" }}>{conf}</span> : <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>}</td>
    </tr>
  );

  const editPanel = (kind) => (
    <div className="panel">
      <div className="panel-h">
        <div><h3>{kind === "revenue" ? "Company revenue" : "Company costs"}</h3><p>{kind === "revenue" ? "Lines you bill for directly. Click a confidence tag to cycle it." : "Your ongoing operating lines. Edit any figure — the runway updates live."}</p></div>
        <button className="addbtn ghost" onClick={() => add(kind)}>{I.plus} {kind === "revenue" ? "Revenue" : "Cost"}</button>
      </div>
      <table className="tbl">
        <thead><tr><th>Line</th><th>Cadence</th><th style={{ textAlign: "right" }}>Amount</th><th>Timing</th><th style={{ textAlign: "right" }}>Growth</th><th>Confidence</th><th></th></tr></thead>
        <tbody>{group(kind).map(Row)}
          {group(kind).length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No {kind} lines yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  // read-only rows for money that is counted here but owned by another tab
  const roTable = (title, sub, rows, srcLabel) => (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-h"><div><h3>{title}</h3><p>{sub}</p></div><span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>read-only · {srcLabel}</span></div>
      <table className="tbl">
        <thead><tr><th>Line</th><th>Source</th><th style={{ textAlign: "right" }}>Amount</th><th>Timing</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="rorow">
              <td style={{ fontWeight: 500 }}>{r.label}</td>
              <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.src}</td>
              <td className="amt num">{moneyFull(r.amount)}{r.per ? <span style={{ fontSize: 11, color: "var(--muted-2)" }}>/mo</span> : null}</td>
              <td className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{r.when}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>Nothing here yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  // What the subscription books bill THIS month. Recurring revenue in the stat strip would otherwise
  // read as zero for a pure-subscription company, since these expand to per-month one-time lines.
  const includedSaas = (saas || []).filter(x => x.include !== false);
  const subCount = includedSaas.length;
  const saasNow = includedSaas.reduce((a, x) => a + (saasSeries(x).find(p => p.month === 0)?.mrr || 0), 0);

  const TABS = [["net", "Net cash flow"], ["revenue", "Revenue"], ["costs", "Costs"]];
  // Hidden sub-tabs are dropped here, and the active one is resolved against what is LEFT —
  // falling back to the view's own default could land on a tab the person asked not to see.
  const SHOWN = visibleTabs("flow", TABS, tabPrefs);
  return (
    <>
      <div className="subtabs">
        {SHOWN.map(([k, label]) => (
          <button key={k} className={"subtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "net" && (<>
        <div className="stats">
          <div className="stat"><div className="accent" style={{ background: "var(--signal)" }} /><div className="lab">Recurring revenue</div><div className="big">{money(recRev)}</div><div className="meta">per month, all tiers</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--danger)" }} /><div className="lab">Recurring costs</div><div className="big">{money(costMo)}</div><div className="meta">opex + payroll + baseline</div></div>
          <div className="stat hero"><div className="lab">Net per month</div><div className="big" style={{ color: recRev - costMo >= 0 ? "var(--signal-2)" : "#fff" }}>{recRev - costMo >= 0 ? "+" : "−"}{money(Math.abs(recRev - costMo))}</div><div className="meta">run-rate, before one-offs</div></div>
        </div>
        <div className="panel">
          <div className="panel-h">
            <div><h3>Everything in the projection</h3><p>Every line the runway counts, wherever it's owned. Edit company lines under <b>Revenue</b> and <b>Costs</b>; payroll and projects belong to their own tabs.</p></div>
            <span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>read-only</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Line</th><th>Source</th><th style={{ textAlign: "right" }}>Amount</th><th>Timing</th><th>Confidence</th></tr></thead>
            <tbody>
              <tr className="grouprow"><td colSpan={5}>Revenue</td></tr>
              {group("revenue").map(l => sumRow(l.id, l.label, "Cash flow · Revenue", l.amount, l.cadence === "recurring", timing(l), l.confidence))}
              {grantIn.map((l, i) => sumRow("gi" + i, l.label || "Payment", "Projects · " + l.projectName, l.amount, l.cadence === "recurring", timing(l), "committed"))}
              {group("revenue").length === 0 && grantIn.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted-2)", textAlign: "center", padding: 16 }}>No revenue yet.</td></tr>}

              <tr className="grouprow"><td colSpan={5}>Costs</td></tr>
              {group("cost").map(l => sumRow(l.id, l.label, "Cash flow · Costs", l.amount, l.cadence === "recurring", timing(l), null))}
              {payrollMonthly > 0.5 && sumRow("pay", `Payroll — ${empCount} ${empCount === 1 ? "person" : "people"}`, "Payroll", payrollMonthly, true, "ongoing", null)}
              {baselineOpex > 0.5 && sumRow("base", "Other operating costs (baseline)", "Spend history · derived", baselineOpex, true, "ongoing", null)}
              {projOut.map((l, i) => sumRow("po" + i, l.label || "Cost", "Projects · " + l.projectName, l.amount, l.cadence === "recurring", timing(l), null))}
            </tbody>
          </table>
        </div>
        <div className="callout" style={{ marginTop: 16, marginBottom: 0, borderLeftColor: "var(--caution)" }}>
          Your <b>{projectCount} project{projectCount !== 1 ? "s" : ""} &amp; grant{projectCount !== 1 ? "s" : ""}</b> net out to about <b className="num">−{projWeeks} weeks</b> of runway once external grant funding is counted. Manage them in the <b>Projects</b> tab.
        </div>
        {baselineOpex > 0.5 && (
          <div className="callout" style={{ marginTop: 12, marginBottom: 0, borderLeftColor: "var(--muted)" }}>
            The <b>Other operating costs</b> baseline is derived from your measured run-rate, not entered by hand — adjust or switch it off in the <b>Spend history</b> tab.
          </div>
        )}
      </>)}

      {tab === "revenue" && (<>
        <div className="stats">
          <div className="stat"><div className="accent" style={{ background: "var(--signal)" }} /><div className="lab">Recurring revenue</div><div className="big">{money(recRev + saasNow)}</div><div className="meta">per month, all tiers{saasNow > 0 ? " · incl. subscriptions" : ""}</div></div>
          <div className="stat"><div className="lab">One-time revenue</div><div className="big">{money(oneSum("revenue"))}</div><div className="meta">across the horizon</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--signal-2)" }} /><div className="lab">Grant payments</div><div className="big">{money(grantTotal)}</div><div className="meta">from Projects, {grantIn.length} payment{grantIn.length !== 1 ? "s" : ""}</div></div>
        </div>
        {editPanel("revenue")}

        {/* THE FUNNEL, made visible. Subscription revenue is entered under Sales — recurring revenue
            from customers is something you sell, and cash flow is where the consequence lands. It
            still counts here, so the tab says where the money came from rather than leaving an
            unexplained gap between the stat at the top and the lines listed below it. */}
        {saasNow > 0 && (
          <div className="callout" style={{ borderLeftColor: "var(--signal-2)" }}>
            <b>{moneyFull(saasNow)}/mo</b> of the recurring revenue above is subscriptions, from{" "}
            {subCount} product{subCount !== 1 ? "s" : ""} — those are entered under{" "}
            <button className="linkbtn" onClick={() => onGoSubs?.()}>Sales &rsaquo; Subscriptions</button>,
            with the customers they belong to.
          </div>
        )}
        {roTable("Grant payments", "Awarded reimbursements and milestone payments already counted in your runway.",
          grantIn.map(l => ({ label: l.label || "Payment", src: l.projectName, amount: l.cadence === "recurring" ? l.amount : l.amount, per: l.cadence === "recurring", when: timing(l) })), "Projects")}
      </>)}

      {tab === "costs" && (<>
        <div className="stats">
          <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Payroll</div><div className="big">{money(payrollMonthly)}</div><div className="meta">per month, loaded</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--danger)" }} /><div className="lab">Operating lines</div><div className="big">{money(recCost)}</div><div className="meta">per month, recurring</div></div>
          <div className="stat"><div className="lab">Untracked baseline</div><div className="big">{money(baselineOpex)}</div><div className="meta">per month, derived</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--caution)" }} /><div className="lab">Project & grant costs</div><div className="big">{money(projTotal)}</div><div className="meta">across the horizon</div></div>
        </div>
        {editPanel("cost")}
        {roTable("Payroll", `${empCount} on the roster — salary plus ${Math.round(fringePct * 1000) / 10}% employer burden, itemized per person in the Payroll tab.`,
          employees.map(e => ({ label: e.name, src: empTitleAt(e, 0), amount: empCostAt(e, 0, fringePct), per: true,
            when: (e.start || 0) > 0 ? `starts ${monthLabel(START_Y, START_M, e.start)}` : (e.end != null ? `ends ${monthLabel(START_Y, START_M, e.end)}` : "ongoing") })), "Payroll")}
        {roTable("Project & grant costs", "Internal project spend and the cash portion of grant budgets.",
          projOut.map(l => ({ label: l.label || "Cost", src: l.projectName, amount: l.amount, per: l.cadence === "recurring", when: timing(l) })), "Projects")}
        {baselineOpex > 0.5 && (
          <div className="callout" style={{ marginTop: 16, marginBottom: 0, borderLeftColor: "var(--muted)" }}>
            A derived <b>Other operating costs</b> baseline of <b className="num">{moneyFull(baselineOpex)}/mo</b> is also counted, anchoring forward burn to your historical run-rate. Adjust it in the <b>Spend history</b> tab.
          </div>
        )}
      </>)}
    </>
  );
}
