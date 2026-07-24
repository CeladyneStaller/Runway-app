// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { load, save, flush, status, subscribe, hasUnsavedWork, syncConfigured, peekLocal,
         adoptionDismissed, dismissAdoption, LOAD_OK, LOAD_STALE, LOAD_FAILED } from "./state/storage";
import { getSessionProvider } from "./state/sync";
import { SignIn } from "./views/SignIn";
import { ConflictDialog } from "./views/chrome/ConflictDialog";
import { AdoptLocalDialog } from "./views/chrome/AdoptLocalDialog";
import { hasSubstance } from "./views/chrome/docsummary";
import { demoDoc, emptyDoc, toJSON, fromJSON } from "./state/document";
import { roundMS } from "./engine/capital";
import { money, moneyFull } from "./engine/money";
import { buildModelFromDoc, buildModelParts } from "./engine/buildmodel";
import { confidenceBand } from "./engine/band";
import { makeSnapshot, dueForSnapshot, appendSnapshot, worthSnapshotting } from "./engine/journal";
import { useHashRoute } from "./state/hashroute";
import { Scenarios } from "./views/Scenarios";
import { anchorToActuals, balanceAtDate, buildProjection, zeroInfo } from "./engine/projection";
import { blankFulfillment, devLines, poDevNeeded, poNeedsReview } from "./engine/sales";
import { HORIZON, dateLong, dateShort, dateStamp, monthLong, uid } from "./engine/time";
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
  // memoised so dependents get a stable reference the linter can verify; emptyDoc always defines
  // these and migrate() spreads it, so the fallback is belt-and-braces rather than a live path.
  const codeMap = useMemo(() => doc.codeMap || {}, [doc.codeMap]);
  const setCodeMap = (v) => setDoc(d => ({ ...d, codeMap: typeof v === "function" ? v(d.codeMap || {}) : v }));
  const customerMap = useMemo(() => doc.customerMap || {}, [doc.customerMap]);
  const setCustomerMap = (v) => setDoc(d => ({ ...d, customerMap: typeof v === "function" ? v(d.customerMap || {}) : v }));
  const importProfiles = doc.importProfiles || [];
  const setImportProfiles = (v) => setDoc(d => ({ ...d, importProfiles: typeof v === "function" ? v(d.importProfiles || []) : v }));
  const scenarios = doc.scenarios || [];
  const setScenarios = (v) => setDoc(d => ({ ...d, scenarios: typeof v === "function" ? v(d.scenarios || []) : v }));
  const setHist = (v) => setDoc(d => ({ ...d, history: typeof v === "function" ? v(d.history) : v }));

  const { view, tab: routeTab, setView, setTab } = useHashRoute();
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
  // Recorded start-of-month cash. THIS IS A DOCUMENT FIELD, like every other piece of state here.
  // It used to be local useState seeded with the demo's numbers, which meant (a) nothing a user
  // recorded survived a reload and (b) a brand-new user saw the demo company's balances AND had their
  // forecast anchored to them — a $100k/$25k-per-month user was shown 8.3 months instead of 4.0.
  const cashActuals = doc.cashActuals;
  const setCashActuals = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.cashActuals) : v; return { ...d, cashActuals: nv }; });
  const anchorActuals = doc.settings.anchorActuals;
  const setAnchorActuals = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.anchorActuals) : v; return { ...d, settings: { ...d.settings, anchorActuals: nv } }; });
  const fringeConfig = doc.settings.fringe || {};
  const setFringe = (patch) => setDoc(d => ({ ...d, settings: { ...d.settings, fringe: { ...(d.settings.fringe || {}), ...(typeof patch === "function" ? patch(d.settings.fringe || {}) : patch) } } }));
  // ONE model assembly, shared with scenarios, confidence bands and labor prioritisation. App used to
  // rebuild every piece of this inline — two parallel assemblies pinned together by a single golden
  // assertion. Verified identical across 272 document x toggle combinations before merging.
  // Depends on `doc` wholesale rather than hand-listing the fields it reads. Listing fields would skip
  // recomputes on unrelated edits, but it is exactly the unverifiable pattern that caused three stale-memo
  // bugs — and the saving is imaginary: measured at 0.9ms for a document with 472 line items (60 staff,
  // 40 projects, 120 POs, 36 months of history), well under a React render.
  const parts = useMemo(() => buildModelParts(doc), [doc]);
  const { avgSalary, fringePct, employeeLines, rProjects, projectLines, salesLines, roundLines,
          baselineLines, payrollNow, companyOpexNow, itemizedOpex, derivedBurn, baselineOpex,
          revenueVariances } = parts;
  const setFringePct = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.fringePct) : v; return { ...d, settings: { ...d.settings, fringePct: nv } }; });
  const rounds = doc.rounds;
  const setRounds = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.rounds) : v; return { ...d, rounds: nv }; });
  const pos = doc.pos;
  const setPos = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.pos) : v; return { ...d, pos: nv }; });

  // Memoised so dependents can depend on the OBJECT rather than hand-naming the field inside it. A
  // plain object here is rebuilt every render, which forces every consumer to list `toggles.financing`
  // by hand — correct if you get it right, unverifiable by the linter either way, and that gap is
  // precisely where the stale upside/confident-line bugs lived.
  const allOn = useMemo(
    () => ({ committed: true, expected: true, speculative: true, financing: toggles.financing }),
    [toggles.financing]);
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

  // finInstCount is a UI concern (how many instruments the financing switch governs), not part of the
  // model, so it stays here — derived from the shared assembly's roundLines rather than a second copy.
  const finInstCount = useMemo(() => new Set(roundLines.map(l => l.instId).filter(Boolean)).size, [roundLines]);
  const allLines = parts.model.lineItems;

  // Memoised so dependents can depend on IT rather than on its ingredients. Rebuilt every render,
  // it would defeat every memo below; listed by hand, its ingredients drift out of sync (that is how
  // `hist` went missing above). One object, one dependency, verifiable by the linter.
  const model = parts.model;

  const modelRows = useMemo(() => buildProjection(model, toggles), [model, toggles]);
  const modelRowsUp = useMemo(() => buildProjection(model, allOn), [model, allOn]);
  const rows = useMemo(() => anchorToActuals(modelRows, cashActuals, anchorActuals), [modelRows, cashActuals, anchorActuals]);
  const rowsUp = useMemo(() => anchorToActuals(modelRowsUp, cashActuals, anchorActuals), [modelRowsUp, cashActuals, anchorActuals]);
  // "confident" case: the same plan with speculative revenue stripped out — the floor under the headline date
  // Spreads ALL of `toggles`, so it must depend on all of them that can vary. It listed only committed
  // and expected, which froze the "confident to <date>" floor whenever financing was toggled. Same
  // defect as modelRowsUp above, and the same one that lost `hist` from a dep array long before that.
  // The "confident" case: the same plan with speculative revenue stripped out. Memoised for the same
  // reason as allOn — depending on the object is checkable; hand-listing the fields it spreads is not,
  // and omitting one (financing) is exactly how this line went stale.
  const confToggles = useMemo(() => ({ ...toggles, speculative: false }), [toggles]);
  const modelRowsConf = useMemo(() => buildProjection(model, confToggles), [model, confToggles]);
  const rowsConf = useMemo(() => anchorToActuals(modelRowsConf, cashActuals, anchorActuals), [modelRowsConf, cashActuals, anchorActuals]);
  const rowsBase = useMemo(() => buildProjection({ cashOnHand: cash, horizon: HORIZON, lineItems: [...lines, ...employeeLines, ...baselineLines] }, toggles), [lines, employeeLines, baselineLines, toggles, cash]);
  const zero = useMemo(() => zeroInfo(rows, startY, startM), [rows, startY, startM]);

  // PROJECTION JOURNAL — record what the forecast said, weekly, so it can later be checked against what
  // actually happened. Nothing here computes statistics; this is the recorder, and the value only
  // accrues once it has been running. Which is exactly why it takes the first snapshot immediately.
  const takeSnapshot = useCallback((auto = true) => setDoc(d => {
    if (!worthSnapshotting({ cash: d.cash, rows })) return d;      // never record an empty document
    const snap = makeSnapshot({ rows, toggles, cash: d.cash, startY, startM, now: new Date(), auto });
    return { ...d, journal: appendSnapshot(d.journal, snap) };
  }), [setDoc, rows, toggles, startY, startM]);
  useEffect(() => {
    // Self-limiting: the moment a snapshot lands, dueForSnapshot goes false for another week, so the
    // doc change this triggers cannot feed back into another snapshot. That guard is what makes it safe
    // to depend on takeSnapshot honestly rather than suppressing the dependency check.
    if (!dueForSnapshot(doc.journal, new Date())) return;
    if (!worthSnapshotting({ cash, rows })) return;
    takeSnapshot(true);
  }, [doc.journal, rows, cash, takeSnapshot]);
  const [showBand, setShowBand] = useState(true);
  const band = useMemo(() => {
    const b = confidenceBand(doc);
    if (!b) return b;
    // anchor every band curve to recorded cash exactly as the main line is anchored (line `rows` above),
    // so the band starts from the same real-cash baseline and its expected curve lands on the line
    // instead of sitting ~$18k off wherever the un-anchored projection happened to be.
    const anchor = (rs) => anchorToActuals(rs, cashActuals, anchorActuals);
    return {
      ...b,
      floor: { ...b.floor, rows: anchor(b.floor.rows) },
      expected: { ...b.expected, rows: anchor(b.expected.rows) },
      ceiling: { ...b.ceiling, rows: anchor(b.ceiling.rows) },
    };
  }, [doc, cashActuals, anchorActuals]);
  const zeroUp = useMemo(() => zeroInfo(rowsUp, startY, startM), [rowsUp, startY, startM]);
  const zeroConf = useMemo(() => zeroInfo(rowsConf, startY, startM), [rowsConf, startY, startM]);
  const zeroBase = useMemo(() => zeroInfo(rowsBase, startY, startM), [rowsBase, startY, startM]);
  const zeroModel = useMemo(() => zeroInfo(modelRows, startY, startM), [modelRows, startY, startM]);
  const projWeeks = (zeroModel && zeroBase) ? Math.round((zeroBase.months - zeroModel.months) * 4.345) : 0;
  // What the runway looks like if this round never lands. That, not the post-raise number, is the deadline.
  // A covenant only exists if you take the money, so it must be judged against the world where you did.
  const finToggles = useMemo(() => ({ ...toggles, financing: true }), [toggles]);
  const rowsFin = useMemo(() => anchorToActuals(buildProjection(model, finToggles), cashActuals, anchorActuals), [model, finToggles, cashActuals, anchorActuals]);
  const rowsNoRaise = useMemo(() => anchorToActuals(buildProjection({ ...model, lineItems: allLines.filter(l => !l.instId) }, toggles), cashActuals, anchorActuals), [model, allLines, toggles, cashActuals, anchorActuals]);
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
    ["scn", "Scenarios", I.invest],
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
              <span className="eyebrow">Startup runway</span><SyncPill /><SessionPill />
              <h1 className="h1">{view === "dash" ? "Runway projection" : view === "flow" ? "Cash-flow lines" : view === "pay" ? "Payroll" : view === "proj" ? "Projects" : view === "sales" ? "Sales & purchase orders" : view === "inv" ? "Investment & fundraising" : view === "hist" ? "Spend history & burn" : "Critical dates"}</h1>
              <p className="sub">Northwind Labs · projecting from {monthLong(startY, startM)} · cash on hand {moneyFull(model.cashOnHand)}</p>
            </div>
            <div className="statuspill">
              <span>Runway</span>
              <b className="num" style={specInRunway ? { color: "var(--caution)" } : null}>{zero ? zero.months.toFixed(1) + " mo" : `${HORIZON}+ mo`}</b>
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
                  <div className="big">{zero ? `${zero.months.toFixed(1)} mo` : `${HORIZON}+ mo`}</div>
                  {showBand && band && (band.floor.zero != null || band.ceiling.zero != null) && (
                    <div className="meta band-range">
                      {band.floor.zeroNull ? `${HORIZON}+` : band.floor.zero.toFixed(1)}
                      <span className="band-dash">–</span>
                      {band.ceiling.zeroNull ? `${HORIZON}+` : band.ceiling.zero.toFixed(1)} mo range
                    </div>
                  )}
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
                  : <>This plan stays above the waterline for the full {HORIZON}-month horizon. Net cash flow turns positive as recurring revenue outgrows burn.</>}
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
                <RunwayChart rows={rows} rowsUp={rowsUp} rowsOp={rowsNoRaise} band={showBand ? band : null} cash={model.cashOnHand} milestones={msWithBal}
                             projectEnd={null} showUpside={showUpside} zero={zero} zeroUp={zeroUp} actuals={actualsCash} />
              </div>

              {/* TIERS */}
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-h">
                  <div><h3>Revenue confidence</h3><p>Toggle tiers to see runway with and without money you're not sure about.</p></div>
                  <button className={"addbtn ghost" + (showBand ? " on" : "")} onClick={() => setShowBand(b => !b)}>{showBand ? "Hide" : "Show"} range band</button>
                </div>
                {showBand && band && (band.floor.zero != null || band.ceiling.zero != null) && (
                  <div className="band-caption">
                    <div className="band-caption-line">
                      Runway range <b className="num">{band.floor.zeroNull ? `${HORIZON}+` : band.floor.zero.toFixed(1)}</b>–<b className="num">{band.ceiling.zeroNull ? `${HORIZON}+` : band.ceiling.zero.toFixed(1)} mo</b>.
                      {band.wide
                        ? <span className="band-warn"> Your runway depends heavily on uncertain revenue.</span>
                        : <span className="band-ok"> Your runway is fairly robust to revenue assumptions.</span>}
                    </div>
                    <div className="band-caption-note">
                      Range reflects which uncertain revenue lands (the tiers below){band.burnCV > 0.01 ? <>, widened by your historical spend variance (±{Math.round(band.burnCV * 100)}%)</> : null} — not statistical probability.
                    </div>
                  </div>
                )}
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
                  <div className="fin-row">
                    <button className={"fin-toggle" + (toggles.financing ? " on" : "")} onClick={() => setToggles(t => ({ ...t, financing: !t.financing }))}>
                      <span className="fin-name"><span className="fin-dot" />Financing</span>
                      <span className="fin-mid">
                        {finInstCount > 0
                          ? <>{finInstCount} instrument{finInstCount !== 1 ? "s" : ""} · {toggles.financing ? "included" : "not shown"}</>
                          : "No rounds or debt yet"}
                      </span>
                      <span className={"sw fin" + (toggles.financing ? " on" : "")} />
                    </button>
                    <div className="fin-note">
                      A separate axis from the revenue tiers — fundraising and debt, shown assuming your rounds close.
                      {finInstCount > 0
                        ? (toggles.financing ? <> It's in the runway above.</> : <> Turn it on to see the runway with your raise.</>)
                        : <> Add a round or facility in the Investment tab.</>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "flow" && <CashFlow routeTab={routeTab} setRouteTab={setTab} lines={lines} setLines={setLines} projWeeks={projWeeks} projectCount={projects.length} payrollMonthly={payrollNow} empCount={employees.length} baselineOpex={baselineOpex} employees={employees} fringePct={fringePct} projectLines={projectLines} />}
          {view === "pay" && <Payroll routeTab={routeTab} setRouteTab={setTab} baseDoc={doc} employees={employees} setEmployees={setEmployees} fringeConfig={fringeConfig} setFringe={setFringe} fringePct={fringePct} setFringePct={setFringePct} derivedBurn={derivedBurn} companyOpexNow={companyOpexNow} rProjects={rProjects} toggles={toggles} />}
          {view === "proj" && <Projects routeTab={routeTab} setRouteTab={setTab} projects={rProjects} setProjects={setProjects} hist={hist} codeMap={codeMap} customerMap={customerMap} projWeeks={projWeeks} employees={employees} pos={pos} />}
          {view === "sales" && <Sales routeTab={routeTab} setRouteTab={setTab} pos={pos} setPos={setPos} projects={projects} addPO={addPO} delPO={delPO} decideDev={decideDev} />}
          {view === "inv" && <Investment routeTab={routeTab} setRouteTab={setTab} rounds={rounds} setRounds={setRounds} zeroNoRaise={zeroNoRaise} rowsNoRaise={rowsNoRaise} rowsFin={rowsFin} rowsUp={rowsUp} zeroUp={zeroUp} toggles={toggles} setToggles={setToggles} />}
          {view === "hist" && <History journal={doc.journal} takeSnapshot={takeSnapshot} currentCurve={modelStarts} routeTab={routeTab} setRouteTab={setTab} hist={hist} setHist={setHist} codeMap={codeMap} setCodeMap={setCodeMap} customerMap={customerMap} revenueVariances={revenueVariances} importProfiles={importProfiles} setImportProfiles={setImportProfiles} setCustomerMap={setCustomerMap} projects={projects} flagOverrides={flagOverrides} setFlagOverrides={setFlagOverrides} method={method} setMethod={setMethod} applyBaseline={applyBaseline} setApplyBaseline={setApplyBaseline} itemizedOpex={itemizedOpex} baselineOpex={baselineOpex} cashActuals={cashActuals} setCashActuals={setCashActuals} modelStarts={modelStarts} startY={startY} startM={startM} setStartY={setStartY} setStartM={setStartM} cash={cash} setCash={setCash} projects={projects} anchorActuals={anchorActuals} setAnchorActuals={setAnchorActuals} />}
          {view === "scn" && <Scenarios baseDoc={doc} buildModel={buildModelFromDoc} scenarios={scenarios} setScenarios={setScenarios} />}
          {view === "ms" && <Milestones ms={msWithBal} setMilestones={setMilestones} />}
        </main>
      </div>
    </div>
    </StartCtx.Provider>
  );
}


/** Whether your work is actually somewhere other than this browser tab. The app had no concept of
 *  unsaved state, which is survivable when writes are local and instant, and is not once they cross a
 *  network. Deliberately always visible rather than a toast: the question "is my work safe" should be
 *  answerable by looking, not by remembering whether something flashed. */
function SyncPill() {
  const [s, setS] = useState(status());
  useEffect(() => subscribe(setS), []);
  const label = { saved: "Saved", saving: "Saving\u2026", unsaved: "Unsaved changes", error: "Couldn't save",
                  conflict: "Changed elsewhere", stale: "Reload needed" }[s.state];
  if (!label) return null;
  const title = s.state === "error"
    ? `${String(s.error?.message || s.error || "Write failed")} \u2014 your work is still on screen; export it if this persists.`
    : s.at ? `Last change ${s.at.toLocaleTimeString()}` : undefined;
  return <span className={"syncpill " + s.state} title={title} data-sync={s.state}><i />{label}</span>;
}

/** Owns the document: loads it once, saves it debounced, and never renders an empty company at
 *  someone whose company is not empty.
 *
 *  THE SAVE GUARD. `save()` runs only when the in-memory document descends from a SUCCESSFUL load.
 *  Without that rule, a failed read hands back an empty document and the debounced save writes it
 *  straight over the real one — which was a live bug, not a theoretical one, and is the exact failure
 *  a network makes routine (offline start, 500, expired session). "No document yet" and "couldn't
 *  read the document" must never take the same code path. */
function DocumentHost() {
  const [doc, setDoc] = useState(null);
  const [loadState, setLoadState] = useState(null);   // LOAD_OK | LOAD_STALE | LOAD_FAILED
  const [conflict, setConflict] = useState(false);
  const [strandedLocal, setStrandedLocal] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    load().then(async r => {
      if (!alive) return;
      setLoadState(r.state); setDoc(r.doc); if (r.error) setErr(r.error);

      // Only when the ACCOUNT IS EMPTY. If the server already holds a document, offering to replace it
      // with whatever is in this browser is not a migration, it is a conflict — and a conflict does not
      // get a cheerful blue button.
      if (r.state !== LOAD_OK || !r.isNew || !getSessionProvider()) return;
      if (await adoptionDismissed()) return;
      const local = await peekLocal();
      if (alive && hasSubstance(local)) setStrandedLocal(local);
    }).catch(e => { if (alive) { setLoadState(LOAD_FAILED); setErr(e); setDoc(emptyDoc()); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!doc || loadState !== LOAD_OK) return;   // ← the guard: never save what we didn't successfully load
    save(doc);   // storage owns the cadence: debounce, coalescing, no-op skipping, retry
  }, [doc, loadState]);

  // A conflict is a question, so it gets asked once and stays asked until answered.
  useEffect(() => subscribe(st => setConflict(st.state === "conflict")), []);

  // Getting the last edit out before the tab goes away. `visibilitychange` is the one that actually
  // fires reliably on mobile; `beforeunload` is the desktop backstop and the only place a browser will
  // let us warn about unsaved work at all.
  useEffect(() => {
    const onHide = () => { if (window.document.visibilityState === "hidden") flush(); };
    const onLeave = (e) => {
      if (!hasUnsavedWork()) return;
      flush();
      e.preventDefault();
      e.returnValue = "";   // browsers show their own generic wording; ours lives in the indicator
    };
    window.document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, []);

  if (!doc) return <div className="rw"><div className="splash">Loading your model…</div></div>;

  // Could not read the stored document. Show why, and do NOT hand over an editable company that would
  // overwrite it — the original is still there, and a copy has been parked.
  if (loadState !== LOAD_OK) return (
    <div className="rw"><div className="splash" style={{ maxWidth: 560, textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>
        {loadState === LOAD_STALE ? "This model needs a newer version of the app" : "Couldn't open your model"}
      </h2>
      <p>{loadState === LOAD_STALE
        ? "It was last saved by a newer build than the one running here. Reload to pick up the current version — your model has not been changed."
        : "Your saved model couldn't be read just now. It has not been changed or deleted."}</p>
      {err && <p style={{ fontFamily: "var(--fm)", fontSize: 12, color: "var(--muted)" }}>{String(err.message || err)}</p>}
      <p><b>Nothing has been overwritten.</b> Editing is disabled here on purpose, so that an empty
        model can't be saved over your real one.</p>
      <button className="addbtn" onClick={() => window.location.reload()}>Reload</button>
    </div></div>
  );

  return <>
    <RunwayApp doc={doc} setDoc={setDoc} />
    {conflict && <ConflictDialog onAdopt={setDoc} onDone={() => setConflict(false)} />}
    {!conflict && strandedLocal && (
      <AdoptLocalDialog
        localDoc={strandedLocal}
        onUpload={async (local) => {
          setDoc(local);          // adopt it locally...
          save(local);            // ...and push it to the account
          await flush();
          setStrandedLocal(null);
        }}
        onDismiss={async () => { await dismissAdoption(); setStrandedLocal(null); }}
      />
    )}
  </>;
}

export { RunwayApp, demoDoc, toJSON, fromJSON };

/** THE AUTH GATE. In hosted mode there is nobody to be until someone signs in, so the document is not
 *  even requested until there is a session — asking for it first is how you get a FORBIDDEN read that
 *  looks, from the outside, exactly like a broken app.
 *
 *  In local mode this is a pass-through: the document lives in this browser and there is nobody to be. */
export default function App() {
  const session = getSessionProvider();
  // The registered provider IS the signal that hosted mode is live — enableHostedSync only registers one
  // when the config is complete. Re-deriving it from env here would be a second source of truth for the
  // same fact, and the two can disagree.
  const gated = !!session;
  // undefined = still checking (the SDK reads a stored session asynchronously); null = signed out.
  const [user, setUser] = useState(gated ? undefined : null);

  useEffect(() => {
    if (!gated) return;
    let alive = true;
    session.current().then(s => { if (alive) setUser(s); }).catch(() => { if (alive) setUser(null); });
    const off = session.onChange(s => setUser(s));   // covers sign-in, sign-out AND token refresh
    return () => { alive = false; off(); };
  }, [gated, session]);

  if (gated && user === undefined) {
    return <div className="rw"><div className="splash">Checking your session\u2026</div></div>;
  }
  if (gated && user === null) return <SignIn session={session} />;
  return <DocumentHost />;
}

/** Who you are signed in as, and the way out. Reads the registered provider directly rather than being
 *  threaded through the app, and renders nothing at all in local mode. */
function SessionPill() {
  const session = getSessionProvider();
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    session.current().then(s => { if (alive) setUser(s); });
    return session.onChange(s => setUser(s));
  }, [session]);
  if (!session || !user) return null;
  const email = user?.user?.email || user?.email;
  return (
    <span className="sessionpill">
      {email && <span className="sessionpill-who" title={email}>{email}</span>}
      <button className="linkbtn" onClick={async () => {
        // flush first: signing out with unsaved work in the buffer would drop it silently
        await flush();
        await session.signOut();
      }}>Sign out</button>
    </span>
  );
}
