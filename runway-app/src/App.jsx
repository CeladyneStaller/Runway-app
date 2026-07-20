// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useEffect, useMemo, useState } from "react";
import { load, save } from "./state/storage";
import { demoDoc, toJSON, fromJSON } from "./state/document";
import { compileInstrument, roundMS } from "./engine/capital";
import { burnStats } from "./engine/history";
import { money, moneyFull } from "./engine/money";
import { compileEmployee, empCostAt } from "./engine/payroll";
import { anchorToActuals, balanceAtDate, buildProjection, tagRevenue, zeroInfo } from "./engine/projection";
import { compileProject, resolveProjectRates, syncFulfilStage } from "./engine/projects";
import { blankFulfillment, compilePO, devLines, poDevNeeded, poNeedsReview } from "./engine/sales";
import { HORIZON, dateLong, dateShort, dateStamp, monthLong, uid } from "./engine/time";
import { SEED_ROUNDS } from "./seed";
import { StartCtx } from "./state/StartCtx";
import { CashFlow } from "./views/CashFlow";
import { History } from "./views/History";
import { Investment } from "./views/Investment";
import { Milestones } from "./views/Milestones";
import { Payroll } from "./views/Payroll";
import { Projects } from "./views/Projects";
import { Sales } from "./views/Sales";
import { RunwayChart } from "./views/chrome/RunwayChart";
import { I } from "./views/chrome/icons";

function RunwayApp({ doc, setDoc }) {
  const startY = doc.startY;
  const setStartY = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.startY) : v; return { ...d, startY: nv }; });
  const startM = doc.startM;
  const setStartM = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.startM) : v; return { ...d, startM: nv }; });
  const cash = doc.cash;
  const setCash = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.cash) : v; return { ...d, cash: nv }; });

  const hist = doc.history;
  const codeMap = doc.codeMap || {};
  const setCodeMap = (v) => setDoc(d => ({ ...d, codeMap: typeof v === "function" ? v(d.codeMap || {}) : v }));
  const setHist = (v) => setDoc(d => ({ ...d, history: typeof v === "function" ? v(d.history) : v }));

  const [view, setView] = useState("dash");
  const toggles = doc.settings.toggles;
  const setToggles = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.toggles) : v; return { ...d, settings: { ...d.settings, toggles: nv } }; });
  const lines = doc.lines;
  const setLines = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.lines) : v; return { ...d, lines: nv }; });
  const employees = doc.employees;
  const setEmployees = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.employees) : v; return { ...d, employees: nv }; });
  const projects = doc.projects;
  const setProjects = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.projects) : v; return { ...d, projects: nv }; });
  const milestones = doc.milestones;
  const setMilestones = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.milestones) : v; return { ...d, milestones: nv }; });
  const flagOverrides = doc.flagOverrides;
  const setFlagOverrides = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.flagOverrides) : v; return { ...d, flagOverrides: nv }; });
  const method = doc.settings.method;
  const setMethod = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.method) : v; return { ...d, settings: { ...d.settings, method: nv } }; });
  const applyBaseline = doc.settings.applyBaseline;
  const setApplyBaseline = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.applyBaseline) : v; return { ...d, settings: { ...d.settings, applyBaseline: nv } }; });
  const [cashActuals, setCashActuals] = useState({
    // Recorded start-of-month cash. Seeded as a gentle drift ~$3k/month behind plan
    // (model: 560,000 / 470,525 / 349,866 / 225,851 / 119,817) — tracking slightly over budget, not off a cliff.
    0: { cash: 560000, revenue: 15000, additional: 0, grants: {} },
    1: { cash: 467000, revenue: 15000, additional: 0, grants: {} },
    2: { cash: 343000, revenue: 16000, additional: 0, grants: {} },
    3: { cash: 216000, revenue: 17000, additional: 0, grants: {} },
    4: { cash: 108000, revenue: 18000, additional: 0, grants: {} },
  }); // recorded granular actuals (start-of-month) for model validation
  const anchorActuals = doc.settings.anchorActuals;
  const setAnchorActuals = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.anchorActuals) : v; return { ...d, settings: { ...d.settings, anchorActuals: nv } }; });
  const fringePct = doc.settings.fringePct;
  const setFringePct = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.fringePct) : v; return { ...d, settings: { ...d.settings, fringePct: nv } }; });
  const rounds = doc.rounds;
  const setRounds = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.rounds) : v; return { ...d, rounds: nv }; });
  const pos = doc.pos;
  const setPos = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.pos) : v; return { ...d, pos: nv }; });

  const allOn = { committed: true, expected: true, speculative: true, financing: toggles.financing };
  // A PO and its fulfillment project are created together — you cannot book revenue without the cost.
  const addPO = (draft) => {
    const po = { id: uid(), devDecision: null, projectId: null, targets: [], ...draft };
    const proj = blankFulfillment(po);
    setProjects(ps => [...ps, proj]);
    setPos(ps => [...ps, { ...po, projectId: proj.id }]);
  };
  const delPO = (id) => {
    const po = pos.find(x => x.id === id);
    if (po?.projectId) setProjects(ps => ps.filter(pr => pr.id !== po.projectId));
    setPos(ps => ps.filter(x => x.id !== id));
  };
  // Executive call on a target gap: kick the development off, or circumvent it. The decision sets the
  // scope of work; the project's stage follows from the review being closed.
  const decideDev = (po, decision) => {
    const next = { ...po, devDecision: decision };
    setPos(ps => ps.map(x => x.id === po.id ? next : x));
    setProjects(ps => ps.map(pr => {
      if (pr.id !== po.projectId) return pr;
      const rest = (pr.lines || []).filter(l => l.phase !== "development");
      return { ...pr, stage: poNeedsReview(next) ? "prospective" : "awarded",
        lines: poDevNeeded(next) ? [...devLines(next), ...rest] : rest };
    }));
  };

  // payroll (from headcount) + internal project costs + grant costs/payments all flow into the master projection
  const employeeLines = useMemo(() => employees.flatMap(e => compileEmployee(e, fringePct)), [employees, fringePct]);
  const rProjects = useMemo(() => syncFulfilStage(resolveProjectRates(projects, employees, fringePct), pos), [projects, employees, fringePct, pos]);
  const projectLines = useMemo(() =>
    rProjects.flatMap(p => {
      if (p.stage === "prospective" && !p.include) return []; // proposals (grant or internal) excluded until modeled
      return compileProject(p).map(l => ({ ...l, projectId: p.id, projectName: p.name }));
    }), [rProjects]);

  // Spend-history-derived burn -> fallback "other operating costs" baseline anchoring forward opex to the historical run-rate
  const payrollNow = useMemo(() => employees.reduce((a, e) => a + empCostAt(e, 0, fringePct), 0), [employees, fringePct]);
  const companyOpexNow = useMemo(() => lines.filter(l => l.kind === "cost" && l.cadence === "recurring" && (l.start || 0) <= 0 && (l.end == null || l.end >= 0)).reduce((a, l) => a + (l.amount || 0), 0), [lines]);
  const itemizedOpex = companyOpexNow + payrollNow; // sum of expected recurring spend from line items
  const derivedBurn = useMemo(() => burnStats(hist, itemizedOpex, flagOverrides, method).applied, [hist, itemizedOpex, flagOverrides, method]); // measured comprehensive run-rate
  const baselineOpex = applyBaseline ? Math.max(0, derivedBurn - itemizedOpex) : 0;
  const baselineLines = useMemo(() => baselineOpex > 0.5
    ? [{ label: "Other operating costs (baseline)", cadence: "recurring", kind: "cost", amount: baselineOpex, start: 0, end: null, growthPct: 0, isBaseline: true }]
    : [], [baselineOpex]);

  const salesLines = useMemo(() => pos.flatMap(po => compilePO(po).map(l => ({ ...l, poId: po.id, poRef: `${po.customer} · ${po.po}` }))), [pos]);
  const roundLines = useMemo(() => rounds.flatMap(x => compileInstrument(x, rounds)), [rounds]);
  const allLines = useMemo(() => tagRevenue([...lines, ...employeeLines, ...projectLines, ...salesLines, ...roundLines, ...baselineLines]), [lines, employeeLines, projectLines, salesLines, roundLines, baselineLines]);
  // Memoised so dependents can depend on IT rather than on its ingredients. Rebuilt every render,
  // it would defeat every memo below; listed by hand, its ingredients drift out of sync (that is how
  // `hist` went missing above). One object, one dependency, verifiable by the linter.
  const model = useMemo(() => ({ cashOnHand: cash, horizon: HORIZON, lineItems: allLines }), [cash, allLines]);

  const modelRows = useMemo(() => buildProjection(model, toggles), [model, toggles]);
  const modelRowsUp = useMemo(() => buildProjection(model, allOn), [model]);
  const rows = useMemo(() => anchorToActuals(modelRows, cashActuals, anchorActuals), [modelRows, cashActuals, anchorActuals]);
  const rowsUp = useMemo(() => anchorToActuals(modelRowsUp, cashActuals, anchorActuals), [modelRowsUp, cashActuals, anchorActuals]);
  // "confident" case: the same plan with speculative revenue stripped out — the floor under the headline date
  const modelRowsConf = useMemo(() => buildProjection(model, { ...toggles, speculative: false }), [model, toggles.committed, toggles.expected]);
  const rowsConf = useMemo(() => anchorToActuals(modelRowsConf, cashActuals, anchorActuals), [modelRowsConf, cashActuals, anchorActuals]);
  const rowsBase = useMemo(() => buildProjection({ cashOnHand: cash, horizon: HORIZON, lineItems: [...lines, ...employeeLines, ...baselineLines] }, toggles), [lines, employeeLines, baselineLines, toggles, cash]);
  const zero = useMemo(() => zeroInfo(rows, startY, startM), [rows, startY, startM]);
  const zeroUp = useMemo(() => zeroInfo(rowsUp, startY, startM), [rowsUp, startY, startM]);
  const zeroConf = useMemo(() => zeroInfo(rowsConf, startY, startM), [rowsConf, startY, startM]);
  const zeroBase = useMemo(() => zeroInfo(rowsBase, startY, startM), [rowsBase, startY, startM]);
  const zeroModel = useMemo(() => zeroInfo(modelRows, startY, startM), [modelRows, startY, startM]);
  const projWeeks = (zeroModel && zeroBase) ? Math.round((zeroBase.months - zeroModel.months) * 4.345) : 0;
  // What the runway looks like if this round never lands. That, not the post-raise number, is the deadline.
  // A covenant only exists if you take the money, so it must be judged against the world where you did.
  const rowsFin = useMemo(() => anchorToActuals(buildProjection(model, { ...toggles, financing: true }), cashActuals, anchorActuals), [allLines, toggles, cash, cashActuals, anchorActuals]);
  const rowsNoRaise = useMemo(() => anchorToActuals(buildProjection({ ...model, lineItems: allLines.filter(l => !l.instId) }, toggles), cashActuals, anchorActuals), [allLines, toggles, cash, cashActuals, anchorActuals]);
  const zeroNoRaise = useMemo(() => zeroInfo(rowsNoRaise, startY, startM), [rowsNoRaise, startY, startM]);
  const modelStarts = useMemo(() => modelRows.map(r => r.start), [modelRows]); // PURE model start-of-month balance, for the actual-vs-model comparison
  const actualsCash = useMemo(() => Object.fromEntries(Object.entries(cashActuals).map(([m, o]) => [m, o.cash])), [cashActuals]); // cash-only map for the chart

  const msWithBal = [...milestones, ...roundMS(rounds, startY, startM)].map(ms => {
    const b = balanceAtDate(rows, startY, startM, ms.y, ms.m, ms.day);
    return { ...ms, bal: b?.bal ?? 0, t: b?.t ?? 0, date: new Date(ms.y, ms.m, ms.day) };
  }).sort((a, b) => a.t - b.t);

  const netBurn = rows.slice(0, 3).reduce((a, r) => a + r.net, 0) / 3;
  const grossBurn = rows.slice(0, 3).reduce((a, r) => a + r.cost, 0) / 3;
  const opBurn = itemizedOpex + baselineOpex; // steady operating run-rate (payroll + opex + untracked; excludes projects/grants/one-offs)
  // Upside ghost: draw it whenever the hidden tiers move the trace at all. Speculative money that lands
  // AFTER the zero crossing still matters — it just doesn't defer the date — so don't gate on the zero date.
  const upsideGap = Math.max(0, ...rows.map((r, i) => Math.abs((rowsUp[i]?.start ?? r.start) - r.start)),
                             Math.abs((rowsUp[rowsUp.length - 1]?.end ?? 0) - (rows[rows.length - 1]?.end ?? 0)));
  const showUpside = !(toggles.committed && toggles.expected && toggles.speculative) && upsideGap > 1;
  const upsideDefersZero = !!zero && (!zeroUp || zeroUp.t > zero.t + 0.02);
  // With speculative revenue switched on, the headline date leans on money that may not arrive —
  // so show the floor underneath it: the same plan without speculative.
  const showConf = toggles.speculative && !!zeroConf;
  const sameAsConf = showConf && !!zero && Math.abs(zero.t - zeroConf.t) < 0.02;
  const nextMs = msWithBal.find(m => m.t > 0);

  // tier sums
  const tierSum = (conf) => {
    const rec = lines.filter(l => l.kind === "revenue" && l.confidence === conf && l.cadence === "recurring").reduce((a, l) => a + Number(l.amount), 0);
    const one = lines.filter(l => l.kind === "revenue" && l.confidence === conf && l.cadence === "onetime").reduce((a, l) => a + Number(l.amount), 0);
    const count = lines.filter(l => l.kind === "revenue" && l.confidence === conf).length;
    return { rec, one, count };
  };
  // the persistent runway pill should say when the number it's showing leans on money that may not arrive
  const specInRunway = toggles.speculative && tierSum("speculative").count > 0;

  const NAV = [
    ["dash", "Dashboard", I.dash], ["flow", "Cash flow", I.flow], ["pay", "Payroll", I.pay], ["proj", "Projects", I.proj],
    ["sales", "Sales", I.sales], ["inv", "Investment", I.invest], ["hist", "Spend history", I.hist], ["ms", "Milestones", I.flag],
  ];

  const startCtx = useMemo(() => ({ START_Y: startY, START_M: startM }), [startY, startM]);


  // Your entire backup story: a JSON file you own, on a disk you own. It's also the migration test —
  // export before a schema change, import after, confirm the golden number hasn't moved.
  const doExport = () => {
    const blob = new Blob([toJSON(doc)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.name || "runway").replace(/[^\w.-]+/g, "-").toLowerCase()}-${dateStamp(startY, startM).replace(/[ ,]+/g, "-")}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const doImport = (file) => {
    const r = new FileReader();
    r.onload = () => { try { setDoc(fromJSON(String(r.result))); } catch (e) { alert("That file isn't a Runway document: " + e.message); } };
    r.readAsText(file);
  };
  const isEmpty = !doc.employees.length && !doc.lines.length && !doc.projects.length && !doc.cash;

  if (isEmpty) return (
    <StartCtx.Provider value={startCtx}>
      <div className="rw">
        <div className="empty-shell">
          <span className="mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><path d="M3 17 9 9l4 3 8-9" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <h1>Nothing in the model yet</h1>
          <p>Runway starts with what you have and what you spend. Put your cash on hand in, then add
             the people and the costs — the projection appears as soon as there's something to project.</p>
          <div className="empty-cash">
            <label>Cash on hand</label>
            <input className="inp" type="number" value={doc.cash} onChange={e => setCash(+e.target.value)} autoFocus />
          </div>
          <div className="empty-acts">
            <button className="rvbtn go" onClick={() => setDoc(demoDoc())}>Load the demo company</button>
            <label className="addbtn ghost" style={{ cursor: "pointer" }}>Import a model
              <input type="file" accept="application/json,.json" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
            </label>
          </div>
          <p className="empty-foot">Your model lives in this browser and in whatever JSON you export. No account, no server, no network.</p>
        </div>
      </div>
    </StartCtx.Provider>
  );

  return (
    <StartCtx.Provider value={startCtx}>
    <div className="rw">
      <div className="shell">
        {/* NAV RAIL */}
        <aside className="rail">
          <div className="brand">
            <span className="mark"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><path d="M3 17 9 9l4 3 8-9" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
            <div><b>Waterline</b><span>runway control</span></div>
          </div>
          {NAV.map(([k, label, icon]) => (
            <button key={k} className={"nav" + (view === k ? " on" : "")} onClick={() => setView(k)}>{icon}{label}</button>
          ))}
          <div className="railfoot">
            <input className="docname" value={doc.name} onChange={e => setDoc(d => ({ ...d, name: e.target.value }))}
              aria-label="Model name" placeholder="Untitled model" />
            <div className="railmeta">Projection start · {monthLong(startY, startM)}<br />{HORIZON}-month horizon</div>
            <div className="docacts">
              <button className="addbtn ghost" onClick={doExport} title="Download this model as JSON — your only backup">Export</button>
              <label className="addbtn ghost" title="Replace this model with a JSON file">Import
                <input type="file" accept="application/json,.json" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
              </label>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="main">
          <div className="topbar">
            <div>
              <span className="eyebrow">Startup runway</span>
              <h1 className="h1">{view === "dash" ? "Runway projection" : view === "flow" ? "Cash-flow lines" : view === "pay" ? "Payroll" : view === "proj" ? "Projects" : view === "sales" ? "Sales & purchase orders" : view === "inv" ? "Investment & fundraising" : view === "hist" ? "Spend history & burn" : "Critical dates"}</h1>
              <p className="sub">Northwind Labs · projecting from {monthLong(startY, startM)} · cash on hand {moneyFull(model.cashOnHand)}</p>
            </div>
            <div className="statuspill">
              <span>Runway</span>
              <b className="num" style={specInRunway ? { color: "var(--caution)" } : null}>{zero ? zero.months.toFixed(1) + " mo" : "18+ mo"}</b>
              <em className="num">{zero ? dateShort(zero.date) : "positive"}</em>
              {specInRunway && (
                <span className="specflag" title={zeroConf ? `Includes speculative revenue — without it, zero on ${dateShort(zeroConf.date)}.` : "Includes speculative revenue."}>
                  <i />incl. speculative
                </span>
              )}
            </div>
          </div>

          {view === "dash" && (
            <>
              {/* STATS */}
              <div className="stats">
                <div className="stat hero">
                  <div className="lab">Runway remaining</div>
                  <div className="big">{zero ? `${zero.months.toFixed(1)} mo` : "18+ mo"}</div>
                  <div className="meta">{zero ? `zero on ${dateShort(zero.date)}` : "cash-flow positive"}</div>
                  {showConf && <div className="meta conf">confident to {dateShort(zeroConf.date)}{sameAsConf ? " — speculative lands too late to move it" : ""}</div>}
                </div>
                <div className="stat">
                  <div className="accent" style={{ background: "var(--caution)" }} />
                  <div className="lab">Operating burn / mo</div>
                  <div className="big">{money(opBurn)}</div>
                  <div className="meta">payroll + opex · run-rate</div>
                </div>
                <div className="stat">
                  <div className="accent" style={{ background: "var(--danger)" }} />
                  <div className="lab">Net cash flow / mo</div>
                  <div className="big">{money(netBurn)}</div>
                  <div className="meta">incl. projects &amp; grants · 3-mo avg</div>
                </div>
                <div className="stat">
                  <div className="accent" style={{ background: "var(--signal)" }} />
                  <div className="lab">Cash on hand</div>
                  <div className="big">{money(model.cashOnHand)}</div>
                  <div className="meta">as of {dateStamp(startY, startM)}</div>
                </div>
                <div className="stat">
                  <div className="accent" style={{ background: nextMs && nextMs.bal >= 0 ? "var(--signal)" : "var(--caution)" }} />
                  <div className="lab">Next milestone</div>
                  <div className="big" style={{ fontSize: 19, marginTop: 13 }}>{nextMs ? nextMs.label : "—"}</div>
                  <div className="meta" style={{ color: nextMs && nextMs.bal >= 0 ? "var(--signal-ink)" : "var(--caution)" }}>
                    {nextMs ? `${money(nextMs.bal)} projected ${nextMs.bal >= 0 ? "✓" : "✗"}` : ""}
                  </div>
                </div>
              </div>

              {/* insight callout */}
              <div className="callout">
                {zero
                  ? <>On your <b>committed + expected</b> plan you run dry <b className="num">{dateLong(zero.date)}</b>
                     {(() => { const seed = msWithBal.find(m => /seed/i.test(m.label)); return seed
                       ? <> — {seed.bal >= 0 ? <>clearing</> : <>falling short of</>} <b>{seed.label}</b> ({dateShort(seed.date)}) by <span className="num">{money(Math.abs(seed.bal))}</span>.</>
                       : "."; })()}
                     {showUpside && (upsideDefersZero
                       ? <> Turn on <b>speculative</b> revenue and zero moves out to <b className="num">{zeroUp ? dateShort(zeroUp.date) : "beyond the horizon"}</b>.</>
                       : <> <b>Speculative</b> revenue adds up to <span className="num">{money(upsideGap)}</span>, but it lands after that date — it doesn't extend the runway.</>)}
                     {projWeeks > 0 && <> Your active projects draw about <b className="num">{projWeeks} weeks</b> off that runway.</>}
                    </>
                  : <>This plan stays above the waterline for the full 18-month horizon. Net cash flow turns positive as recurring revenue outgrows burn.</>}
              </div>

              {/* CHART */}
              <div className="chartwrap">
                <div className="ch-h">
                  <div>
                    <h3>Cash balance · runway to zero funds</h3>
                    <p>Balance at each month end. Below the dashed waterline you're out of cash.</p>
                  </div>
                  <div className="legend">
                    <span><i style={{ borderColor: "var(--signal-2)" }} />projected balance</span>
                    {Object.keys(cashActuals).length > 0 && <span><i style={{ borderColor: "#fff" }} />actual cash</span>}
                    {showUpside && <span><i style={{ borderColor: "var(--caution)", borderTopStyle: "dashed" }} />with speculative</span>}
                    <span><i style={{ borderColor: "var(--danger)", borderTopStyle: "dashed" }} />waterline</span>
                  </div>
                </div>
                <RunwayChart rows={rows} rowsUp={rowsUp} rowsOp={rowsNoRaise} cash={model.cashOnHand} milestones={msWithBal}
                             projectEnd={null} showUpside={showUpside} zero={zero} zeroUp={zeroUp} actuals={actualsCash} />
              </div>

              {/* TIERS */}
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-h">
                  <div><h3>Revenue confidence</h3><p>Toggle tiers to see runway with and without money you're not sure about.</p></div>
                </div>
                <div style={{ padding: 16 }}>
                  <div className="tiers">
                    {[["committed", "var(--signal)", "Signed, in the bank, or contractually certain."],
                      ["expected", "var(--ink-2)", "Reasonable forecast — recurring growth, likely renewals."],
                      ["speculative", "var(--caution)", "Deals in the pipeline that may or may not close."]].map(([k, c, d]) => {
                      const s = tierSum(k), on = toggles[k];
                      return (
                        <button key={k} className={"tier" + (on ? "" : " off")} onClick={() => setToggles(t => ({ ...t, [k]: !t[k] }))}>
                          <div className="th">
                            <span className="tname"><span className="dot" style={{ background: c }} />{k[0].toUpperCase() + k.slice(1)}</span>
                            <span className={"sw" + (on ? " on" : "")} />
                          </div>
                          <div className="tval">{s.rec ? money(s.rec) + "/mo" : "—"} {s.one ? <small> + {money(s.one)} one-time</small> : null}</div>
                          <div className="tdesc">{d} · {s.count} line{s.count !== 1 ? "s" : ""}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "flow" && <CashFlow lines={lines} setLines={setLines} projWeeks={projWeeks} projectCount={projects.length} payrollMonthly={payrollNow} empCount={employees.length} baselineOpex={baselineOpex} employees={employees} fringePct={fringePct} projectLines={projectLines} />}
          {view === "pay" && <Payroll employees={employees} setEmployees={setEmployees} fringePct={fringePct} setFringePct={setFringePct} derivedBurn={derivedBurn} companyOpexNow={companyOpexNow} rProjects={rProjects} toggles={toggles} />}
          {view === "proj" && <Projects projects={rProjects} setProjects={setProjects} hist={hist} codeMap={codeMap} projWeeks={projWeeks} employees={employees} pos={pos} />}
          {view === "sales" && <Sales pos={pos} setPos={setPos} projects={projects} addPO={addPO} delPO={delPO} decideDev={decideDev} />}
          {view === "inv" && <Investment rounds={rounds} setRounds={setRounds} zeroNoRaise={zeroNoRaise} rowsNoRaise={rowsNoRaise} rowsFin={rowsFin} rowsUp={rowsUp} zeroUp={zeroUp} toggles={toggles} setToggles={setToggles} />}
          {view === "hist" && <History hist={hist} setHist={setHist} codeMap={codeMap} setCodeMap={setCodeMap} projects={projects} flagOverrides={flagOverrides} setFlagOverrides={setFlagOverrides} method={method} setMethod={setMethod} applyBaseline={applyBaseline} setApplyBaseline={setApplyBaseline} itemizedOpex={itemizedOpex} baselineOpex={baselineOpex} cashActuals={cashActuals} setCashActuals={setCashActuals} modelStarts={modelStarts} startY={startY} startM={startM} setStartY={setStartY} setStartM={setStartM} cash={cash} setCash={setCash} projects={projects} anchorActuals={anchorActuals} setAnchorActuals={setAnchorActuals} />}
          {view === "ms" && <Milestones ms={msWithBal} setMilestones={setMilestones} />}
        </main>
      </div>
    </div>
    </StartCtx.Provider>
  );
}


/** Owns the document: loads it once, saves it debounced, and never renders an empty company at
 *  someone whose company is not empty. */
export default function App() {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { load().then(setDoc).catch(e => { setErr(e); setDoc(demoDoc()); }); }, []);
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => save(doc).catch(e => setErr(e)), 400);   // this app recomputes on every
    return () => clearTimeout(t);                                        // keystroke; don't write per key
  }, [doc]);

  if (!doc) return <div className="rw"><div className="splash">Loading your model…</div></div>;
  return <>
    {err && <div className="rw"><div className="callout" style={{ borderLeftColor: "var(--danger)" }}>
      Could not reach local storage: {String(err.message || err)}. Your work is still on screen — export it before closing this tab.
    </div></div>}
    <RunwayApp doc={doc} setDoc={setDoc} />
  </>;
}

export { RunwayApp, demoDoc, toJSON, fromJSON };
