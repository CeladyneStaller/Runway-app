// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useMemo, useState } from "react";
import { TabInsights } from "./chrome/TabInsights";
import { money, moneyFull } from "../engine/money";
import { itemizedFringeRate, itemizedIsEmpty } from "../engine/fringe";
import { HRS_YR, empCostAt, empMonthlyOf, empSalaryAt, empSalaryMoAt, empTitleAt } from "../engine/payroll";
import { teamLoad } from "../engine/projects";
import { LaborPriority } from "./chrome/LaborPriority";
import { HORIZON, clampM, monthLabel, uid } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { MOPTS } from "./chrome/bits";
import { I } from "./chrome/icons";
import { PayrollActionModal } from "./chrome/modals";
import { useTabPrefs, visibleTabs, resolveTab } from "../state/tabprefs";

export function Payroll({ routeTab, setRouteTab = () => {}, baseDoc, employees, setEmployees, fringePct = 0, setFringePct, fringeConfig = {}, setFringe = () => {}, derivedBurn = 0, companyOpexNow = 0, rProjects = [], toggles }) {
  const { START_Y, START_M } = useStart();
  const [modal, setModal] = useState(null); // { empId, action }
  const tabPrefs = useTabPrefs();
  const tab = resolveTab("pay", routeTab, "total", tabPrefs);
  const setTab = (t) => setRouteTab(t);

  const patch = (id, p) => setEmployees(es => es.map(e => e.id === id ? { ...e, ...p } : e));
  const del = (id) => setEmployees(es => es.filter(e => e.id !== id));
  const add = () => setEmployees(es => [...es, { id: uid(), name: "New hire", title: "Title", basis: "annual", amount: 120000, start: 0, end: null, raises: [], promotions: [] }]);
  const addRaise = (id, r) => setEmployees(es => es.map(e => e.id === id ? { ...e, raises: [...(e.raises || []), { id: uid(), ...r }] } : e));
  const addPromo = (id, pr) => setEmployees(es => es.map(e => e.id === id ? { ...e, promotions: [...(e.promotions || []), { id: uid(), ...pr }] } : e));
  const updateRaise = (eid, rid, r) => setEmployees(es => es.map(e => e.id !== eid ? e : { ...e, raises: e.raises.map(x => x.id === rid ? { ...x, ...r } : x) }));
  const updatePromo = (eid, pid, pr) => setEmployees(es => es.map(e => e.id !== eid ? e : { ...e, promotions: e.promotions.map(x => x.id === pid ? { ...x, ...pr } : x) }));
  const delRaise = (eid, rid) => setEmployees(es => es.map(e => e.id !== eid ? e : { ...e, raises: e.raises.filter(r => r.id !== rid) }));
  const delPromo = (eid, pid) => setEmployees(es => es.map(e => e.id !== eid ? e : { ...e, promotions: e.promotions.filter(pr => pr.id !== pid) }));

  const salaryNow = employees.reduce((a, e) => a + empSalaryMoAt(e, 0), 0);
  const totalNow = salaryNow * (1 + fringePct);
  const burdenNow = totalNow - salaryNow;
  // what the measured burn can actually support on top of salaries, once opex is accounted for
  const ceiling = salaryNow > 0 ? (derivedBurn - companyOpexNow - salaryNow) / salaryNow : 0;
  const overCeiling = fringePct > ceiling + 0.001;
  const series = Array.from({ length: HORIZON + 1 }, (_, m) => employees.reduce((a, e) => a + empCostAt(e, m, fringePct), 0));
  const peak = Math.max(0, ...series), maxS = Math.max(1, ...series);
  const hasRamp = new Set(series.map(v => Math.round(v))).size > 1;
  const unit = (e) => e.basis === "annual" ? "/yr" : "/mo";
  const modalEmp = modal && employees.find(e => e.id === modal.empId);

  // planned changes render in BOTH Total and Employees; only Employees can edit them
  const changesOf = (e) => [
    ...(e.raises || []).map(r => ({ kind: "raise", id: r.id, month: r.month, r })),
    ...(e.promotions || []).map(pr => ({ kind: "promo", id: pr.id, month: pr.month, pr })),
    ...(e.end != null ? [{ kind: "term", id: "term", month: e.end }] : []),
  ].sort((a, b) => a.month - b.month);

  const changeRows = (e, colSpan, editable) => changesOf(e).map(c => {
    let schip, scolor, desc;
    if (c.kind === "raise") {
      schip = "Raise"; scolor = { background: "rgba(16,135,107,.12)", color: "var(--signal-ink)" };
      const after = empSalaryAt(e, c.month);
      const repeat = c.r.everyMonths && c.r.everyMonths > 0;
      desc = c.r.mode === "pct"
        ? <>+{c.r.value}%{repeat ? ` every ${c.r.everyMonths} mo` : ""} → <b>{moneyFull(after)}{unit(e)}</b></>
        : <>set to <b>{moneyFull(c.r.value)}{unit(e)}</b></>;
    } else if (c.kind === "promo") {
      schip = "Promotion"; scolor = { background: "rgba(34,69,79,.1)", color: "var(--ink-2)" };
      desc = <>title → <b style={{ fontFamily: "var(--fb)" }}>{c.pr.title}</b></>;
    } else {
      schip = "Termination"; scolor = { background: "rgba(188,59,42,.1)", color: "var(--danger)" };
      desc = <>last month on payroll</>;
    }
    const openEdit = () => setModal({ empId: e.id, action: c.kind === "raise" ? "raise" : c.kind === "promo" ? "promote" : "terminate", editId: c.id });
    return (
      <tr className="emprow-sub" key={c.id}>
        <td colSpan={colSpan}>
          <div className={"subchange" + (editable ? "" : " ro")} onClick={editable ? openEdit : undefined} title={editable ? "Click to edit" : "Edit in the Employees tab"}>
            <span className="branch">└</span>
            <span className="schip" style={scolor}>{schip}</span>
            <span className="subdesc">{desc}</span>
            <span className="subeff">effective <b className="num" style={{ fontWeight: 500, color: "var(--ink-2)" }}>{monthLabel(START_Y, START_M, c.month)}</b></span>
            <div style={{ flex: 1 }} />
            {editable && <>
              <span className="subedit">{I.edit} Edit</span>
              <button className="iconbtn" onClick={ev => { ev.stopPropagation(); c.kind === "raise" ? delRaise(e.id, c.id) : c.kind === "promo" ? delPromo(e.id, c.id) : patch(e.id, { end: null }); }} aria-label="Remove change">{I.trash}</button>
            </>}
          </div>
        </td>
      </tr>
    );
  });

  // Annualised contracted rate — what the role pays once they're on payroll, even if that's still ahead.
  const yearlyRate = (e) => empMonthlyOf(e, empSalaryAt(e, Math.max(0, e.start || 0))) * 12;
  // Salary actually earned across a calendar year (1 Jan -> 31 Dec), honouring start, end and raises.
  // Calendar months before the projection begins are assumed to sit at the month-0 salary — the model
  // has no per-person history behind its start date.
  const yearSalary = (e, year) => {
    let s = 0;
    for (let mo = 0; mo < 12; mo++) s += empSalaryMoAt(e, clampM((year - START_Y) * 12 + (mo - START_M)));
    return s;
  };
  const cyRate = employees.reduce((a, e) => a + yearlyRate(e), 0);
  const cySalary = employees.reduce((a, e) => a + yearSalary(e, START_Y), 0);
  // Highest monthly salary held at any point this calendar year — so a mid-year raise shows the new
  // figure and a mid-year departure still shows what they were on. Anyone not on payroll at all this
  // year (a hire that starts next January) falls back to their contracted rate rather than reading $0.
  const maxMoInYear = (e, year) => {
    let mx = 0;
    for (let mo = 0; mo < 12; mo++) mx = Math.max(mx, empSalaryMoAt(e, clampM((year - START_Y) * 12 + (mo - START_M))));
    return mx > 0 ? mx : yearlyRate(e) / 12;
  };
  const cyMoSalary = employees.reduce((a, e) => a + maxMoInYear(e, START_Y), 0);

    const load = useMemo(() => teamLoad(rProjects, toggles), [rProjects, toggles]);
  const peakOf = (id) => { const ms = Object.values(load[id]?.months || {}); return ms.length ? Math.max(...ms) : 0; };
  const overCount = employees.filter(e => peakOf(e.id) > HRS_YR / 12).length;
  const TABS = [["total", "Total"], ["employees", "Employees"], ["fringe", "Fringe"], ["alloc", "Allocation"], ["priority", "Prioritization"]];
  // Hidden sub-tabs are dropped here, and the active one is resolved against what is LEFT —
  // falling back to the view's own default could land on a tab the person asked not to see.
  const SHOWN = visibleTabs("pay", TABS, tabPrefs);
  return (
    <>
      <div className="subtabs">
        {SHOWN.map(([k, label]) => (
          <button key={k} className={"subtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "total" && (<>
      <div className="stats">
        <div className="stat"><div className="lab">Headcount</div><div className="big">{employees.length}</div><div className="meta">on payroll</div></div>
        <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Monthly payroll</div><div className="big">{money(totalNow)}</div><div className="meta">{money(salaryNow)} salary + {money(burdenNow)} burden</div></div>
        <div className="stat"><div className="accent" style={{ background: "var(--signal)" }} /><div className="lab">Annual run-rate</div><div className="big">{money(totalNow * 12)}</div><div className="meta">current × 12</div></div>
        <div className="stat hero"><div className="lab">Peak monthly</div><div className="big">{money(peak)}</div><div className="meta">over the horizon</div></div>
      </div>
      <TabInsights tab="pay" subtab={tab} />

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><div><h3>Monthly payroll over horizon</h3><p>{hasRamp ? "Steps up and down as hires start, raises land, and roles end." : "Flat while comp is constant — add a hire or a raise to see it move."}</p></div></div>
        <div style={{ padding: "8px 18px 20px" }}>
          <div className="pmini" style={{ height: 84, gap: 4 }}>
            {series.map((v, m) => (
              <div key={m} className="pbwrap" title={monthLabel(START_Y, START_M, m) + ": " + moneyFull(v) + "/mo"}>
                <div className="pb" style={{ height: `${(v / maxS) * 62}px` }} />
                <span>{m % 3 === 0 ? monthLabel(START_Y, START_M, m).split(" ")[0] : "\u00A0"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <div><h3>Total cost per person</h3><p><b>Yearly salary</b> and the monthly figures are rates — the most this person is paid at any point in {START_Y}, so nobody reads $0. <b>{START_Y} salary</b> and <b>{START_Y} total cost</b> are what actually lands this calendar year, after start dates, raises and departures. Edit any of it in the <b>Employees</b> tab.</p></div>
          <span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>read-only</span>
        </div>
        <table className="tbl">
          <thead><tr><th>Employee</th><th>Title</th><th style={{ textAlign: "right" }}>Yearly salary</th><th style={{ textAlign: "right" }}>{START_Y} salary</th><th style={{ textAlign: "right" }}>Monthly salary</th><th style={{ textAlign: "right" }}>Fringe</th><th style={{ textAlign: "right" }}>Monthly cost</th><th style={{ textAlign: "right" }}>{START_Y} total cost</th></tr></thead>
          <tbody>
            {employees.map(e => {
              const sal = maxMoInYear(e, START_Y), fr = sal * fringePct, cy = yearSalary(e, START_Y);
              return (
                <React.Fragment key={e.id}>
                  <tr>
                    <td style={{ fontWeight: 500 }}>{e.name}{(e.start || 0) > 0 && <span className="chip" style={{ marginLeft: 8, background: "rgba(201,130,27,.14)", color: "var(--caution)" }}>planned</span>}</td>
                    <td style={{ color: "var(--muted)" }}>{empTitleAt(e, 0)}</td>
                    <td className="amt num" style={{ color: "var(--muted)" }}>{moneyFull(yearlyRate(e))}</td>
                    <td className="amt num">{moneyFull(cy)}</td>
                    <td className="amt num">{moneyFull(sal)}</td>
                    <td className="amt num" style={{ color: "var(--caution)" }}>{moneyFull(fr)}</td>
                    <td className="amt num" style={{ fontWeight: 600 }}>{moneyFull(sal + fr)}</td>
                    <td className="amt num" style={{ fontWeight: 600 }}>{moneyFull(cy * (1 + fringePct))}</td>
                  </tr>
                  {changeRows(e, 8, false)}
                </React.Fragment>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--line)" }}>
              <td colSpan={2} style={{ fontWeight: 600, color: "var(--muted)" }}>Total payroll</td>
              <td className="amt num" style={{ fontWeight: 600, color: "var(--muted)" }}>{moneyFull(cyRate)}</td>
              <td className="amt num" style={{ fontWeight: 600 }}>{moneyFull(cySalary)}</td>
              <td className="amt num" style={{ fontWeight: 600 }}>{moneyFull(cyMoSalary)}</td>
              <td className="amt num" style={{ fontWeight: 600, color: "var(--caution)" }}>{moneyFull(cyMoSalary * fringePct)}</td>
              <td className="amt num" style={{ fontWeight: 700, color: "var(--ink)" }}>{moneyFull(cyMoSalary * (1 + fringePct))}</td>
              <td className="amt num" style={{ fontWeight: 700, color: "var(--ink)" }}>{moneyFull(cySalary * (1 + fringePct))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </>)}

      {tab === "employees" && (<>
      <div className="callout" style={{ borderLeftColor: "var(--signal)" }}>
        Salaries are time-dependent — schedule <b>raises</b>, <b>promotions</b>, and <b>termination</b> per person and payroll recomputes month by month into your Dashboard runway. Planned changes appear beneath each employee.
      </div>
      </>)}

      {tab === "employees" && (
      <div className="panel">
        <div className="panel-h">
          <div><h3>Employees</h3><p>Current salary and title per person. Use the actions to plan raises, promotions, and departures.</p></div>
          <button className="addbtn ghost" onClick={add}>{I.plus} Add employee</button>
        </div>
        <table className="tbl">
          <thead><tr><th>Employee</th><th>Title</th><th style={{ textAlign: "right" }}>Current salary</th><th>Start</th><th style={{ textAlign: "right" }}>Monthly (loaded)</th><th></th></tr></thead>
          <tbody>
            {employees.map(e => {
              const future = (e.start || 0) > 0;
              return (
                <React.Fragment key={e.id}>
                  <tr>
                    <td>
                      <input className="inp" style={{ width: 150, textAlign: "left" }} value={e.name} onChange={ev => patch(e.id, { name: ev.target.value })} />
                      {future && <span className="chip" style={{ marginLeft: 8, background: "rgba(201,130,27,.14)", color: "var(--caution)" }}>planned</span>}
                    </td>
                    <td><input className="inp" style={{ width: 150, textAlign: "left" }} value={e.title} onChange={ev => patch(e.id, { title: ev.target.value })} /></td>
                    <td className="amt">
                      <input className="inp" type="number" value={e.amount} onChange={ev => patch(e.id, { amount: +ev.target.value })} />
                      <select className="sel" style={{ marginLeft: 6 }} value={e.basis} onChange={ev => patch(e.id, { basis: ev.target.value })}><option value="annual">/yr</option><option value="monthly">/mo</option></select>
                    </td>
                    <td><select className="sel" value={e.start || 0} onChange={ev => patch(e.id, { start: +ev.target.value })}>{MOPTS(START_Y, START_M)}</select></td>
                    <td className="amt num" style={{ fontWeight: 500 }}>{moneyFull(empCostAt(e, 0, fringePct))}</td>
                    <td>
                      <div className="actcell">
                        <button className="actbtn" onClick={() => setModal({ empId: e.id, action: "raise" })}>Raise</button>
                        <button className="actbtn" onClick={() => setModal({ empId: e.id, action: "promote" })}>Promote</button>
                        <button className="actbtn danger" onClick={() => setModal({ empId: e.id, action: "terminate" })}>{e.end != null ? "End date" : "Terminate"}</button>
                        <button className="iconbtn" onClick={() => del(e.id)} aria-label="Remove employee">{I.trash}</button>
                      </div>
                    </td>
                  </tr>
                  {changeRows(e, 6, true)}
                </React.Fragment>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--line)" }}>
              <td colSpan={4} style={{ fontWeight: 600, color: "var(--muted)" }}>Total monthly payroll (current)</td>
              <td className="amt num" style={{ fontWeight: 700, color: "var(--ink)" }}>{moneyFull(totalNow)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {tab === "priority" && <LaborPriority baseDoc={baseDoc} />}

      {tab === "alloc" && (<>
        <div className="stats">
          <div className="stat"><div className="lab">People committed</div><div className="big">{Object.keys(load).length}</div><div className="meta">of {employees.length} on the roster</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Committed hours</div><div className="big">{Math.round(Object.values(load).reduce((a, r) => a + r.items.reduce((x, i) => x + i.hours, 0), 0)).toLocaleString()}</div><div className="meta">across grants &amp; fulfillment</div></div>
          <div className="stat hero"><div className="lab">Over-allocated</div><div className="big" style={{ color: overCount ? "var(--danger)" : "#fff" }}>{overCount}</div><div className="meta">people past 100% in a month</div></div>
        </div>
        <TabInsights tab="pay" subtab={tab} />
        <div className="callout" style={{ borderLeftColor: overCount ? "var(--danger)" : "var(--signal)" }}>
          Grant personnel and fulfillment labour are charged to real people. None of it draws cash twice — payroll already paid for it — but capacity is finite, and this is where you find out that two projects booked the same engineer.
        </div>
        <div className="panel">
          <div className="panel-h">
            <div><h3>Team allocation</h3><p>Peak load is the worst single month, not an average — an engineer at 60% across a year can still be at 140% in March.</p></div>
            <span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>read-only</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Employee</th><th>Title</th><th style={{ textAlign: "right" }}>Committed hours</th><th style={{ textAlign: "right" }}>Peak month</th><th>Status</th></tr></thead>
            <tbody>
              {employees.map(e => {
                const rec = load[e.id], peak = peakOf(e.id), cap = HRS_YR / 12;
                const pct = Math.round((peak / cap) * 100), over = peak > cap;
                const hrs = rec ? rec.items.reduce((a, i) => a + i.hours, 0) : 0;
                return (
                  <React.Fragment key={e.id}>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{e.name}</td>
                      <td style={{ color: "var(--muted)" }}>{empTitleAt(e, 0)}</td>
                      <td className="amt num">{Math.round(hrs).toLocaleString()}<span style={{ fontSize: 11, color: "var(--muted-2)" }}> h</span></td>
                      <td className="amt num" style={{ color: over ? "var(--danger)" : undefined, fontWeight: over ? 600 : 400 }}>{pct}%</td>
                      <td>{!rec ? <span className="schip" style={{ background: "var(--line-2)", color: "var(--muted-2)" }}>Unassigned</span>
                        : over ? <span className="schip" style={{ background: "rgba(188,59,42,.1)", color: "var(--danger)" }}>Over-allocated</span>
                        : pct > 85 ? <span className="schip" style={{ background: "rgba(201,130,27,.14)", color: "var(--caution)" }}>At capacity</span>
                        : <span className="schip" style={{ background: "rgba(16,135,107,.12)", color: "var(--signal-ink)" }}>Has headroom</span>}</td>
                    </tr>
                    {(rec?.items || []).map((it, i) => (
                      <tr className="emprow-sub" key={i}><td colSpan={5}>
                        <div className="subchange ro">
                          <span className="branch">└</span>
                          <span className="subdesc"><b style={{ fontFamily: "var(--fb)" }}>{it.project}</b> · {it.label}</span>
                          <span className="subeff">{Math.round(it.hours).toLocaleString()} h · <b className="num" style={{ fontWeight: 500, color: "var(--ink-2)" }}>{monthLabel(START_Y, START_M, it.start)} → {monthLabel(START_Y, START_M, it.end)}</b> · {it.load}% of their time</span>
                        </div>
                      </td></tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}

      {tab === "fringe" && (() => {
        const mode = fringeConfig.mode || "itemized";
        const avgSal = employees.length ? (salaryNow / employees.length) * 12 : 0;
        const itemizedRate = itemizedFringeRate(fringeConfig, avgSal);
        const setF = (k, v) => setFringe({ [k]: v });
        const NUM = (k, label, suffix, ph) => (
          <label className="frg-field" key={k}><span>{label}</span>
            <div className="frg-inwrap">
              <input className="inp" type="number" value={fringeConfig[k] ?? ""} placeholder={ph || "0"}
                onChange={e => setF(k, e.target.value)} />
              {suffix && <em>{suffix}</em>}
            </div>
          </label>
        );
        return (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <div><h3>Employer burden</h3><p>What every salary actually costs you on top of the number in the offer letter. Build it from its parts, or set the blended rate directly.</p></div>
            <div className="frg-modeseg">
              <button className={"frg-mode" + (mode !== "manual" ? " on" : "")} onClick={() => setFringe({ mode: "itemized" })}>Itemized</button>
              <button className={"frg-mode" + (mode === "manual" ? " on" : "")} onClick={() => setFringe({ mode: "manual" })}>Manual %</button>
            </div>
          </div>

          {mode === "manual" ? (
            <div className="frg-manual">
              <label className="frg-field"><span>Fringe rate</span>
                <div className="frg-inwrap">
                  <input className="inp" type="number" value={fringeConfig.manualPct ?? ""} placeholder="30"
                    onChange={e => setFringe({ manualPct: e.target.value })} />
                  <em>%</em>
                </div>
              </label>
              <p className="frg-hint">Leave blank to fall back to the itemized calculation{itemizedRate != null ? <> ({Math.round(itemizedRate * 1000) / 10}%)</> : null}.</p>
            </div>
          ) : (
            <div className="frg-grid">
              <div className="frg-group">
                <div className="frg-gh">Paid time off</div>
                {NUM("vacationDays", "Vacation", "days/yr")}
                {NUM("holidayDays", "Holidays", "days/yr")}
                {NUM("sickDays", "Sick leave", "days/yr")}
              </div>
              <div className="frg-group">
                <div className="frg-gh">Taxes & benefits</div>
                {NUM("payrollTaxPct", "Payroll taxes", "%")}
                {NUM("insurancePerPerson", "Group insurance", "$/person")}
              </div>
              <div className="frg-group">
                <div className="frg-gh">401(k)</div>
                {NUM("k401Pct", "Plan (employee defers)", "%")}
                {NUM("k401MatchPct", "Company match", "%")}
                <p className="frg-hint">The company pays the match up to what employees defer.</p>
              </div>
            </div>
          )}
        <div className="burden">
          <div className="bcalc">
            <span>Salaries<b className="num">{moneyFull(salaryNow)}</b></span>
            <em>+</em>
            <span>Burden @ {Math.round(fringePct * 1000) / 10}%<b className="num" style={{ color: "var(--caution)" }}>{moneyFull(burdenNow)}</b></span>
            <em>=</em>
            <span>True payroll cost<b className="num" style={{ color: "var(--ink)" }}>{moneyFull(totalNow)}</b><i>per month</i></span>
          </div>
          <div className={"bnote" + (overCeiling ? " warn" : "")}>
            {overCeiling
              ? <>Your measured burn of <b className="num">{moneyFull(derivedBurn)}</b>/mo only supports about <b className="num">{Math.round(ceiling * 1000) / 10}%</b> on top of salaries once <b className="num">{moneyFull(companyOpexNow)}</b> of opex is counted. At {Math.round(fringePct * 1000) / 10}% your itemized costs come to <b className="num">{moneyFull(totalNow + companyOpexNow)}</b>/mo — more than you actually spent — so the untracked baseline drops to zero and modeled burn rises above history. Either your spend history is missing something, or the real rate is nearer {Math.round(ceiling * 1000) / 10}%.</>
              : <>At {Math.round(fringePct * 1000) / 10}% the burden fits inside your measured burn of <b className="num">{moneyFull(derivedBurn)}</b>/mo — it moves spend out of the untracked baseline into a named line without changing the forecast.</>}
          </div>
        </div>
      </div>
        );
      })()}

      {modal && modalEmp && (
        <PayrollActionModal
          emp={modalEmp} action={modal.action} editId={modal.editId}
          initial={modal.editId
            ? (modal.action === "raise" ? (modalEmp.raises || []).find(r => r.id === modal.editId)
              : modal.action === "promote" ? (modalEmp.promotions || []).find(pr => pr.id === modal.editId)
              : { month: modalEmp.end })
            : null}
          onClose={() => setModal(null)}
          onSaveRaise={r => modal.editId ? updateRaise(modalEmp.id, modal.editId, r) : addRaise(modalEmp.id, r)}
          onSavePromo={pr => modal.editId ? updatePromo(modalEmp.id, modal.editId, pr) : addPromo(modalEmp.id, pr)}
          onSaveTerminate={m => patch(modalEmp.id, { end: m })}
        />
      )}
    </>
  );
}

