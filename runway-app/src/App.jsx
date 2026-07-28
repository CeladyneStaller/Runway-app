// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { load, save, flush, status, subscribe, hasUnsavedWork, syncConfigured, peekLocal,
         adoptionDismissed, dismissAdoption, activateDemoBackend, clearDemo, demoInProgress, isDemo,
         demoExpired, demoRemainingMs, stashPromotion, pendingPromotion, clearPromotion,
         markDemoReset, takeDemoReset, switchCompany,
         LOAD_OK, LOAD_STALE, LOAD_FAILED } from "./state/storage";
import { getSessionProvider, getAccountApi, getAuthAdapter } from "./state/sync";
import { reportError } from "./state/errors";
import { TabPrefsProvider, load as loadTabPrefs, save as saveTabPrefs,
         visibleNav, landingView } from "./state/tabprefs";
import { SignIn } from "./views/SignIn";
import { SetPassword } from "./views/SetPassword";
import { Account } from "./views/Account";
import { ConflictDialog } from "./views/chrome/ConflictDialog";
import { AdoptLocalDialog } from "./views/chrome/AdoptLocalDialog";
import { PromoteDemoDialog } from "./views/chrome/PromoteDemoDialog";
import { Landing } from "./views/Landing";
import { Setup } from "./views/Setup";
import { hasSubstance } from "./views/chrome/docsummary";
import { demoDoc, emptyDoc, toJSON, fromJSON } from "./state/document";
import { roundMS, msTarget, msPass, msGap } from "./engine/capital";
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

function RunwayApp({ doc, setDoc, onOpenAccount, demo = false, onLeaveDemo, onKeepDemo = () => {},
                    companyName = null, tabPrefs, onSetup = null }) {
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

  const { view, tab: routeTab, setView, setTab, navigate } = useHashRoute();
  const toggles = doc.settings.toggles;
  const setToggles = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.settings.toggles) : v; return { ...d, settings: { ...d.settings, toggles: nv } }; });
  const lines = doc.lines;
  const setLines = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.lines) : v; return { ...d, lines: nv }; });
  const saas = doc.saas || [];
  const setSaas = (v) => setDoc(d => { const nv = typeof v === "function" ? v(d.saas || []) : v; return { ...d, saas: nv }; });
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

  // `pass` and `gap` are computed HERE, once, and read everywhere. The dashboard used to re-derive
  // `bal >= 0` in three places; with targets in play that would let the headline call a date green
  // while the panel below called it a shortfall.
  const msWithBal = [...milestones, ...roundMS(rounds, startY, startM)].map(ms => {
    const b = balanceAtDate(rows, startY, startM, ms.y, ms.m, ms.day);
    const bal = b?.bal ?? 0;
    return { ...ms, bal, t: b?.t ?? 0, date: new Date(ms.y, ms.m, ms.day),
             target: msTarget(ms), pass: msPass(bal, ms), gap: msGap(bal, ms) };
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
  // Hidden tabs are dropped from the NAV only. A hash that points at a hidden view still renders it:
  // this is decluttering, not permissions, and bouncing somebody off their own bookmark would be a
  // worse surprise than a tab they had tidied away showing up when they asked for it by name.
  const SHOWN_NAV = visibleNav(NAV, tabPrefs);

  const startCtx = useMemo(() => ({ START_Y: startY, START_M: startM }), [startY, startM]);

  // If the view you are LOOKING AT gets hidden, you have to end up somewhere. Dashboard is locked
  // against hiding precisely so there is always a destination.
  useEffect(() => {
    const next = landingView(view, tabPrefs);
    if (next !== view) setView(next);
  }, [view, tabPrefs, setView]);


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
  // The empty screen used to be escapable ONLY by entering cash, loading the demo, or importing — and
  // nothing said that typing a number was a way through. Someone who wanted to start by listing their
  // team, or who simply did not know their balance yet, had no door at all.
  const [startedBlank, setStartedBlank] = useState(false);

  // A LOCAL-MODE SCREEN NOW. In hosted mode the setup wizard is the single door into a new model and
  // this one is retired — see SetupBar for why a second full-screen front door was the wrong shape.
  // Local mode has no account, no landing screen and therefore no wizard, and this is also the only
  // place the demo can be reached there, so it stays exactly as it was.
  //
  // KEYED ON `onSetup`, NOT on `syncConfigured()`. The host decides the mode once and passes the
  // consequence down; re-deriving it here would be a second source of truth for one fact, which is the
  // trap this file already records for the auth gate — and the two DO disagree, because the host is
  // configured by an injected env while `syncConfigured()` reads `import.meta.env`.
  if (isEmpty && !startedBlank && !onSetup) return (
    <TabPrefsProvider value={tabPrefs}>
    <StartCtx.Provider value={startCtx}>
      <div className="rw">
        <div className="empty-shell">
          <span className="mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><path d="M3 17 9 9l4 3 8-9" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <h1>Nothing in the model yet</h1>
          <p>Runway starts with what you have and what you spend. Put your cash on hand in below, or
             go straight in and add the people and costs first — the projection appears as soon as
             there's something to project.</p>
          <div className="empty-cash">
            <label>Cash on hand</label>
            <input className="inp" type="number" value={doc.cash} onChange={e => setCash(+e.target.value)} autoFocus />
          </div>
          <button className="rvbtn go empty-go" onClick={() => setStartedBlank(true)}>
            Start from scratch
          </button>
          <div className="empty-or"><span>or</span></div>
          <div className="empty-acts">
            {/* HOSTED MODE NO LONGER OFFERS THE DEMO HERE. The landing screen owns that door, and
                offering it again to somebody who has already signed up meant bouncing an authenticated
                user into unauthenticated demo mode via a hash change and a page reload — nothing was
                lost, but it is a strange thing to do to someone who just gave you an email address.
                In LOCAL mode there is no landing screen and no account, so this stays the way in. */}
            {!syncConfigured() && (
              <button className="addbtn ghost" onClick={() => setDoc(demoDoc())}>Explore the demo company</button>
            )}
            <label className="addbtn ghost" style={{ cursor: "pointer" }}>Import a model
              <input type="file" accept="application/json,.json" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
            </label>
          </div>
          <p className="empty-foot">{syncConfigured()
            ? "Saved to your account as you go, and available on any device you sign in to. You can export it as JSON at any time."
            : "Your model lives in this browser and in whatever JSON you export. No account, no server, no network."}</p>
        </div>
      </div>
    </StartCtx.Provider>
    </TabPrefsProvider>
  );

  return (
    <TabPrefsProvider value={tabPrefs}>
    <StartCtx.Provider value={startCtx}>
    <div className="rw">
      <UnpaidBar onOpenAccount={onOpenAccount} />
      {onSetup && isEmpty && <SetupBar onSetup={onSetup} onImport={doImport} />}
      <div className="shell">
        {/* NAV RAIL */}
        <aside className="rail">
          <div className="brand">
            <span className="mark"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><path d="M3 17 9 9l4 3 8-9" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
            <div><b>Waterline</b><span>runway control</span></div>
          </div>
          {SHOWN_NAV.map(([k, label, icon]) => (
            <button key={k} className={"nav" + (view === k ? " on" : "")} onClick={() => setView(k)}>{icon}{label}</button>
          ))}
          <div className="railfoot">
            <input className="docname" value={doc.name} onChange={e => setDoc(d => ({ ...d, name: e.target.value }))}
              aria-label="Model name" placeholder={companyName || "Untitled model"} />
            <div className="railmeta">Projection start · {monthLong(startY, startM)}<br />{HORIZON}-month horizon</div>
            {/* EXPORT AND IMPORT ARE BOTH WITHHELD IN DEMO MODE, for different reasons.
                Import is the dangerous one: it drops a REAL model into a store that wipes itself, so a
                  person restoring their own JSON here would lose it to the twelve-hour reset. That is a
                  data-loss path, not a product decision.
                Export contradicts this app's own doctrine ("your only backup", said everywhere else) and
                  the contradiction is deliberate: a demo is disposable by construction, so there is
                  nothing here that wants backing up, and the honest replacement for "download it" is
                  "keep it" — which is the button below. Note this is a SIGNAL, not enforcement; the JSON
                  is a devtools panel away, and it is not pretending otherwise. */}
            <div className="docacts">
              {demo ? (
                <>
                  <button className="addbtn" onClick={() => onKeepDemo(doc)}
                    title="Create an account and carry this model into it">Keep this model</button>
                  <div className="docacts-fine">Create an account and this becomes your real model.</div>
                </>
              ) : (
                <>
                  <button className="addbtn ghost" onClick={doExport} title="Download this model as JSON — your only backup">Export</button>
                  <label className="addbtn ghost" title="Replace this model with a JSON file">Import
                    <input type="file" accept="application/json,.json" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
                  </label>
                </>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="main">
          <div className="topbar">
            <div>
              <span className="eyebrow">Startup runway</span>
              {demo ? <DemoPill onLeave={onLeaveDemo} onKeep={() => onKeepDemo(doc)} /> : <><SyncPill /><SessionPill onOpenAccount={onOpenAccount} /></>}
              <h1 className="h1">{view === "dash" ? "Runway projection" : view === "flow" ? "Cash-flow lines" : view === "pay" ? "Payroll" : view === "proj" ? "Projects" : view === "sales" ? "Sales & purchase orders" : view === "inv" ? "Investment & fundraising" : view === "hist" ? "Spend history & burn" : "Critical dates"}</h1>
              <p className="sub">{isDefaultName(doc.name) ? (companyName || "Untitled model") : doc.name} · projecting from {monthLong(startY, startM)} · cash on hand {moneyFull(model.cashOnHand)}</p>
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

          <ViewBoundary key={view + ":dash"} label="Dashboard" onLeave={() => setView("dash")}>
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
                  <div className="accent" style={{ background: nextMs && nextMs.pass ? "var(--signal)" : "var(--caution)" }} />
                  <div className="lab">Next milestone</div>
                  <div className="big" style={{ fontSize: 19, marginTop: 13 }}>{nextMs ? nextMs.label : "—"}</div>
                  <div className="meta" style={{ color: nextMs && nextMs.pass ? "var(--signal-ink)" : "var(--caution)" }}>
                    {nextMs ? `${money(nextMs.bal)} projected ${nextMs.pass ? "✓" : "✗"}` : ""}
                  </div>
                </div>
              </div>

              {/* insight callout */}
              <div className="callout">
                {zero
                  ? <>On your <b>committed + expected</b> plan you run dry <b className="num">{dateLong(zero.date)}</b>
                     {(() => { const seed = msWithBal.find(m => /seed/i.test(m.label)); return seed
                       ? <> — {seed.pass ? <>clearing</> : <>falling short of</>} <b>{seed.label}</b> ({dateShort(seed.date)}) by <span className="num">{money(Math.abs(seed.bal))}</span>.</>
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

          </ViewBoundary>
          <ViewBoundary key={view} label={NAV.find(n => n[0] === view)?.[1] || view} onLeave={() => setView("dash")}>
          {view === "flow" && <CashFlow saas={saas} onGoSubs={() => {
            // ONE navigate call. setView(...) then setTab(...) races: setTab reads `route.view` from
            // state that the first call has not committed yet, so the tab lands on the OLD view.
            navigate({ view: "sales", tab: "subs" });
          }} routeTab={routeTab} setRouteTab={setTab} lines={lines} setLines={setLines} projWeeks={projWeeks} projectCount={projects.length} payrollMonthly={payrollNow} empCount={employees.length} baselineOpex={baselineOpex} employees={employees} fringePct={fringePct} projectLines={projectLines} />}
          {view === "pay" && <Payroll routeTab={routeTab} setRouteTab={setTab} baseDoc={doc} employees={employees} setEmployees={setEmployees} fringeConfig={fringeConfig} setFringe={setFringe} fringePct={fringePct} setFringePct={setFringePct} derivedBurn={derivedBurn} companyOpexNow={companyOpexNow} rProjects={rProjects} toggles={toggles} />}
          {view === "proj" && <Projects routeTab={routeTab} setRouteTab={setTab} projects={rProjects} setProjects={setProjects} hist={hist} codeMap={codeMap} customerMap={customerMap} projWeeks={projWeeks} employees={employees} pos={pos} />}
          {view === "sales" && <Sales saas={saas} setSaas={setSaas} routeTab={routeTab} setRouteTab={setTab} pos={pos} setPos={setPos} projects={projects} addPO={addPO} delPO={delPO} decideDev={decideDev} />}
          {view === "inv" && <Investment routeTab={routeTab} setRouteTab={setTab} rounds={rounds} setRounds={setRounds} zeroNoRaise={zeroNoRaise} rowsNoRaise={rowsNoRaise} rowsFin={rowsFin} rowsUp={rowsUp} zeroUp={zeroUp} toggles={toggles} setToggles={setToggles} />}
          {view === "hist" && <History journal={doc.journal} takeSnapshot={takeSnapshot} currentCurve={modelStarts} routeTab={routeTab} setRouteTab={setTab} hist={hist} setHist={setHist} codeMap={codeMap} setCodeMap={setCodeMap} customerMap={customerMap} revenueVariances={revenueVariances} importProfiles={importProfiles} setImportProfiles={setImportProfiles} setCustomerMap={setCustomerMap} projects={projects} flagOverrides={flagOverrides} setFlagOverrides={setFlagOverrides} method={method} setMethod={setMethod} applyBaseline={applyBaseline} setApplyBaseline={setApplyBaseline} itemizedOpex={itemizedOpex} baselineOpex={baselineOpex} cashActuals={cashActuals} setCashActuals={setCashActuals} modelStarts={modelStarts} startY={startY} startM={startM} setStartY={setStartY} setStartM={setStartM} cash={cash} setCash={setCash} projects={projects} anchorActuals={anchorActuals} setAnchorActuals={setAnchorActuals} />}
          {view === "scn" && <Scenarios baseDoc={doc} buildModel={buildModelFromDoc} scenarios={scenarios} setScenarios={setScenarios}
            // APPLYING A SCENARIO is the one action on that tab that edits the real model. The patched
            // document arrives already built, and goes through the ordinary setDoc path — so it saves,
            // journals and undoes exactly like any other edit, rather than needing its own write route.
            onApplyToPlan={(next) => setDoc(next)} />}
          {view === "ms" && <Milestones ms={msWithBal} setMilestones={setMilestones} />}
          </ViewBoundary>
        </main>
      </div>
    </div>
    </StartCtx.Provider>
    </TabPrefsProvider>
  );
}


/** A CRASH IN ONE VIEW MUST NOT TAKE THE APP WITH IT.
 *
 *  React unmounts the entire tree on an uncaught render error, so before this existed a single bad
 *  dereference anywhere produced a blank white page with no rail, no nav and no way back — you could
 *  not even reach another tab, because there was no longer a tab to click. That is the difference
 *  between "one screen is broken" and "the product is gone", and it is worth a class component.
 *
 *  Scoped to the VIEW AREA, deliberately: the rail and topbar stay mounted and usable, so the recovery
 *  is genuine navigation rather than a nicer-looking dead end. Keyed on the view so switching tabs
 *  remounts it — without that, one crash would leave the boundary stuck in its error state forever.
 *
 *  It does NOT swallow the error: componentDidCatch logs it, because a caught crash that leaves no
 *  trace is a bug that never gets fixed. */
class ViewBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    // Was console-only, which meant every crash in production went to a console nobody was reading.
    // The view name goes with it; the component stack does not, because it is long and can carry
    // rendered values in prop names.
    reportError(error, { kind: "view-crash", view: this.props.label });
    console.error("[runway] view crashed:", error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="view">
        <div className="crashcard" role="alert">
          <h2>{this.props.label} couldn't be drawn</h2>
          <p>Something in this screen hit an error while rendering. <b>Your model has not been changed</b>
            {" "}— this is a display fault, and everything else still works.</p>
          <p className="crash-detail">{String(this.state.error?.message || this.state.error)}</p>
          <div className="cf-actions">
            <button className="addbtn" onClick={this.props.onLeave}>Back to the dashboard</button>
            <button className="addbtn ghost" onClick={() => window.location.reload()}>Reload the app</button>
          </div>
        </div>
      </div>
    );
  }
}

const fmtLeft = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** Says, permanently and unmissably, what is happening to this model — and offers both ways out of it.
 *  A demo that looks identical to the real thing is how somebody spends twenty minutes building a model
 *  they are about to lose.
 *
 *  THE COPY CHANGED WITH THE BEHAVIOUR. This used to read "nothing is saved", which was already a
 *  little false (edits survived a refresh) and is now flatly false: edits ARE kept, in this browser,
 *  for twelve hours. Saying otherwise would train people to distrust the one label whose whole job is
 *  being trusted. What is true, and what it now says, is: kept here, not in an account, and going away
 *  at a time you can see. */
function DemoPill({ onLeave, onKeep }) {
  const [left, setLeft] = useState(() => demoRemainingMs());

  // Self-contained on purpose — no parent callback, so no dependency to declare and no memo to keep
  // stable. The expiry action needs nothing from App: mark, wipe, reload, and the initialiser reseeds.
  useEffect(() => {
    const id = setInterval(() => {
      const ms = demoRemainingMs();
      if (ms === null || ms <= 0) {
        // The window closed with the tab still open. Reset in place rather than leaving somebody
        // editing a document the next read will refuse to return.
        markDemoReset();
        clearDemo();
        window.location.reload();
        return;
      }
      setLeft(ms);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const soon = left !== null && left <= 60 * 60 * 1000;
  return (
    <span className={"demopill" + (soon ? " soon" : "")}>
      <i />Demo · {left === null ? "not saved to an account" : `resets in ${fmtLeft(left)}`}
      <button className="linkbtn" onClick={onKeep}>Keep this</button>
      <button className="linkbtn" onClick={onLeave}>Leave demo</button>
    </span>
  );
}

/** Whether your work is actually somewhere other than this browser tab. The app had no concept of
 *  unsaved state, which is survivable when writes are local and instant, and is not once they cross a
 *  network. Deliberately always visible rather than a toast: the question "is my work safe" should be
 *  answerable by looking, not by remembering whether something flashed. */
/** SAYS WHY SAVING STOPPED, at the top of the app where it cannot be missed.
 *
 *  Without this a refused save shows only a small "Couldn't save" pill, which reads as a bug — you
 *  retry, reload, and conclude the product is broken. It is not broken; it is asking to be paid, and
 *  that is a completely different sentence. This bar is the difference between a paywall and an
 *  outage, and its absence is why an unpaid company looked like a broken app for most of a day. */
function UnpaidBar({ onOpenAccount }) {
  const [s, setS] = useState(status());
  useEffect(() => subscribe(setS), []);
  if (s.state !== "unpaid") return null;
  return (
    <div className="unpaidbar" role="status">
      <span><b>Changes aren't being saved.</b> This company isn't covered by your plan. Your model is
        safe and you can still open and export it.</span>
      {onOpenAccount && <button className="linkbtn" onClick={onOpenAccount}>Choose a plan</button>}
    </div>
  );
}

/** THE EMPTY-MODEL PROMPT, in hosted mode, and it is a BAR rather than a SCREEN on purpose.
 *
 *  The screen it replaces rendered INSTEAD of the app, which made it a second front door: when the
 *  wizard failed to fire, somebody landed on a different-looking product asking for cash on hand, and
 *  nothing on it hinted that a setup flow existed at all — so a trigger bug looked like the intended
 *  design. A bar cannot do that. The app is behind it either way, the wizard is one click away, and if
 *  the trigger breaks again the failure is a missing bar rather than a wrong screen.
 *
 *  It also keeps the one thing the old screen was right about: an import is a legitimate way to start,
 *  and it must not be buried inside a wizard somebody has just declined. */
function SetupBar({ onSetup, onImport }) {
  return (
    <div className="setupbar" role="status">
      <span><b>This model is empty.</b> Answer a few questions to set your company up, or add people and
        costs directly — the projection appears as soon as there is something to project.</span>
      <button className="linkbtn" onClick={onSetup}>Set up your company</button>
      <label className="linkbtn" style={{ cursor: "pointer" }}>Import a model
        <input type="file" accept="application/json,.json" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
      </label>
    </div>
  );
}

function SyncPill() {
  const [s, setS] = useState(status());
  useEffect(() => subscribe(setS), []);
  // `unpaid` is deliberately absent: it has its own bar, and a small pill saying "Couldn't save"
  // beside it would restate a billing state as a fault.
  const label = { saved: "Saved", saving: "Saving\u2026", unsaved: "Unsaved changes", error: "Couldn't save",
                  conflict: "Changed elsewhere", stale: "Reload needed" }[s.state];
  if (!label) return null;
  const title = s.state === "error"
    ? `${String(s.error?.message || s.error || "Write failed")} \u2014 your work is still on screen; export it if this persists.`
    : s.at ? `Last change ${s.at.toLocaleTimeString()}` : undefined;
  return <span className={"syncpill " + s.state} title={title} data-sync={s.state}><i />{label}</span>;
}

// Skipping the wizard is "not now", not "never" — so it is remembered for the TAB and not the account.
// A schema field would make a transient UI choice permanent, and the account is genuinely still empty,
// so offering again on a later visit is help rather than nagging.
//
// SCOPED BY COMPANY, and that scoping is the whole of a reported bug. This was ONE global key, written
// on cancel and cleared NOWHERE — not on sign-out, not on a company switch. sessionStorage outlives a
// sign-out within a tab, so any tab in which the wizard had ever been dismissed suppressed it for every
// account opened in that tab afterwards, and a brand-new account landed on the old empty-model screen
// instead. It also explains the shape of the report — it worked when first tested and stopped later,
// because the flag accumulates. Keyed by company, declining for one cannot answer for another.
const SETUP_SKIP = "runway:setup-skipped";
const skipKey = (id) => `${SETUP_SKIP}:${id || "unknown"}`;
const setupSkipped = (id) => { try { return !!globalThis.sessionStorage?.getItem(skipKey(id)); } catch { return false; } };
const skipSetup = (id) => { try { globalThis.sessionStorage?.setItem(skipKey(id), "1"); } catch { /* nothing to remember */ } };

/** Which company a skip belongs to. `activeCompany()` is SYNCHRONOUS and already resolved by the time
 *  the document has been read, so this needs no await. NOTE it is a method on the auth ADAPTER: an
 *  earlier attempt at per-user scoping called `getSessionProvider()?.()`, which returns the session
 *  OBJECT rather than a function and crashed DocumentHost outright. Null in local and demo mode, where
 *  there is no account and no wizard either. */
const currentCompanyId = () => { try { return getAuthAdapter()?.activeCompany?.() || null; } catch { return null; } };

/** Names the app itself supplied, as opposed to one somebody typed. Only these may be overwritten by
 *  the company's name — `emptyDoc()` ships "Untitled", and a cleared input leaves "". */
const isDefaultName = (n) => !n || !String(n).trim() || String(n).trim() === "Untitled";

/** Owns the document: loads it once, saves it debounced, and never renders an empty company at
 *  someone whose company is not empty.
 *
 *  THE SAVE GUARD. `save()` runs only when the in-memory document descends from a SUCCESSFUL load.
 *  Without that rule, a failed read hands back an empty document and the debounced save writes it
 *  straight over the real one — which was a live bug, not a theoretical one, and is the exact failure
 *  a network makes routine (offline start, 500, expired session). "No document yet" and "couldn't
 *  read the document" must never take the same code path. */
function DocumentHost({ demo = false, onLeaveDemo, onKeepDemo }) {
  const [doc, setDoc] = useState(null);
  const [loadState, setLoadState] = useState(null);   // LOAD_OK | LOAD_STALE | LOAD_FAILED
  const [conflict, setConflict] = useState(false);
  const [strandedLocal, setStrandedLocal] = useState(null);
  const [promoting, setPromoting] = useState(null);   // a demo somebody asked to carry into this account
  const [wasReset, setWasReset] = useState(false);
  const [setup, setSetup] = useState(null);   // null | "model" (empty account) | "company" (new one)
  const [companyName, setCompanyName] = useState(null);
  // Read synchronously from localStorage: a preference fetched asynchronously makes the nav flicker
  // from "everything" to "your selection" on every single load.
  //
  // NOT keyed by user. An earlier version was, and it was wrong twice: `getSessionProvider()` returns
  // the session OBJECT rather than a function, so calling it crashed the whole host; and the scoping
  // was unnecessary anyway, because localStorage is already per browser profile and browser profiles
  // are how two people share a machine.
  const [tabPrefs, setTabPrefs] = useState(() => loadTabPrefs(globalThis.localStorage));
  const [seedName, setSeedName] = useState(false);    // this document started this session empty
  const [showAccount, setShowAccount] = useState(false);
  const [err, setErr] = useState(null);

  /** The account's name for the company being looked at. A model belongs to a company, so the company's
   *  name is the right default for the model's — nobody should have to type "Acme" twice. Best-effort:
   *  a name that fails to resolve is a missing default, not an error worth putting on screen. */
  const loadCompanyName = useCallback(async () => {
    const account = getAccountApi();
    const auth = getAuthAdapter();
    if (!account || !auth) return;
    try {
      const companies = await account.listCompanies();
      const id = auth.activeCompany?.() || null;
      const co = (companies || []).find(c => c.id === id) || (companies || [])[0] || null;
      setCompanyName(co?.name || null);
    } catch { /* no default available; the placeholder covers it */ }
  }, []);

  useEffect(() => { if (!demo) loadCompanyName(); }, [demo, loadCompanyName]);

  const applyTabPrefs = useCallback((next) => {
    setTabPrefs(next);
    saveTabPrefs(next, globalThis.localStorage);
  }, []);

  // The "your demo reset" notice is ONE-SHOT, and StrictMode runs effects twice on the same instance —
  // so the read-and-clear has to be guarded by something that survives between those two runs. A ref
  // does; without it the second pass finds the flag already taken and clears the notice it just set.
  const noticeTaken = React.useRef(false);
  useEffect(() => {
    if (noticeTaken.current) return;
    noticeTaken.current = true;
    if (takeDemoReset()) setWasReset(true);
  }, []);

  useEffect(() => {
    let alive = true;
    load().then(async r => {
      if (!alive) return;
      setLoadState(r.state); setDoc(r.doc); if (r.error) setErr(r.error);
      // Only a document that started EMPTY may take the company's name. An existing model with a name
      // of "Untitled" is a name somebody left alone, not an unfilled blank, and rewriting it on load
      // would be an unrequested write to real data.
      setSeedName(!!r.isNew);

      // Only when the ACCOUNT IS EMPTY. If the server already holds a document, offering to replace it
      // with whatever is in this browser is not a migration, it is a conflict — and a conflict does not
      // get a cheerful blue button.
      // A demo in progress still has nothing to migrate INTO — there is no account yet. The reverse
      // direction (a demo migrating into a new account) is handled below and only once signed in.
      if (demo) return;
      if (r.state !== LOAD_OK || !getSessionProvider()) return;

      // THE TWO OFFERS TO IMPORT SOMEBODY ELSE'S DOCUMENT STAY GATED ON `isNew`. Both propose putting
      // a whole model into this account, and if the server already holds one that is not a migration,
      // it is a conflict — and a conflict does not get a cheerful blue button.
      if (r.isNew) {
        // DELIBERATE REVERSAL, flagged rather than quietly edited. This path used to bail on demo mode
        // outright — "a demo has nothing to migrate, and nothing it touches is real" — and that was
        // correct while demo data was strictly disposable. It no longer is: somebody can now ask, from
        // inside the demo, to carry the model into an account they are about to create. The stash is
        // written at the moment of that request, so what arrives here is an explicit intent, not a
        // fictional company drifting into a real account by accident. Checked BEFORE the stranded-local
        // adoption because it is the more recent and more explicit of the two signals.
        const promo = pendingPromotion();
        if (alive && promo) { setPromoting(promo); return; }

        // NOTE the restructure: `adoptionDismissed()` used to `return` here, which would now swallow the
        // wizard for anybody who had ever declined an adoption. Three offers can claim an empty account
        // and they are checked in order of how explicit the signal is — an asked-for promotion, then a
        // model stranded in this browser, then the generic offer to set one up.
        if (!(await adoptionDismissed())) {
          const local = await peekLocal();
          if (alive && hasSubstance(local)) { setStrandedLocal(local); return; }
        }
      }

      // THE WIZARD IS GATED ON AN EMPTY MODEL, NOT ON `isNew`, and that difference IS the fix. `isNew`
      // is a fact about STORAGE — "the backend had no row" — which is one stray write away from being
      // false: a name seed, an entitlement probe, anything that calls save() on arrival. When it
      // flipped, the wizard silently did not fire and the old empty-model screen stood in for it, with
      // nothing anywhere to say why. "Is there anything in this model" is the question actually being
      // asked, it is answered from the document in hand rather than from storage metadata, and it
      // survives a save. `hasSubstance` is the SAME predicate the adoption dialog and the name seed
      // read, so there is one definition of an empty document in this file rather than three.
      if (alive && !hasSubstance(r.doc) && !setupSkipped(currentCompanyId())) setSetup("model");
    }).catch(e => { if (alive) { setLoadState(LOAD_FAILED); setErr(e); setDoc(emptyDoc()); } });
    return () => { alive = false; };
    // `demo` is a prop that is constant for the life of this component (entering or leaving demo mode
    // reloads the page), so declaring it cannot cause a re-load — but declaring it is still right:
    // the effect reads it, and an undeclared read is how three stale-memo bugs got in.
  }, [demo]);

  useEffect(() => {
    if (!doc || loadState !== LOAD_OK) return;   // ← the guard: never save what we didn't successfully load
    save(doc);   // storage owns the cadence: debounce, coalescing, no-op skipping, retry
  }, [doc, loadState]);

  // SEEDING THE MODEL'S NAME FROM THE COMPANY'S. Gated on `hasSubstance` and that is the load-bearing
  // part: a brand-new account must not get a document written to it merely by signing in, or it stops
  // being "new" and the adoption/promotion offers vanish with it. Waiting for substance means the seed
  // rides along with a write the user's own action already caused, rather than causing one. Fires at
  // most once per loaded document, and never over a name somebody chose.
  useEffect(() => {
    if (!seedName || demo || !doc || loadState !== LOAD_OK || !companyName) return;
    if (!hasSubstance(doc)) return;
    setSeedName(false);
    setDoc(d => (isDefaultName(d.name) ? { ...d, name: companyName } : d));
  }, [seedName, demo, doc, loadState, companyName]);

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

  if (setup) return (
    <Setup
      mode={setup}
      initialName={setup === "company" ? "" : (companyName || "")}
      onCancel={() => { skipSetup(currentCompanyId()); setSetup(null); }}
      onImport={(file) => {
        const r = new FileReader();
        r.onload = () => {
          try { setDoc(fromJSON(String(r.result))); skipSetup(currentCompanyId()); setSetup(null); }
          catch (e) { alert("That file isn't a Runway document: " + e.message); }
        };
        r.readAsText(file);
      }}
      onDone={async (built, typedName) => {
        if (setup === "company") {
          // CREATE THE COMPANY FROM WHAT THE WIZARD COLLECTED, rather than before it ran. Nothing has
          // been written until this moment, so backing out of the wizard leaves no orphan company —
          // which the old "name box first, then create, then wizard" order could not avoid.
          try {
            const id = await getAccountApi().createCompany(typedName || "New company");
            const r = await switchCompany(getAuthAdapter(), id);   // flushes the outgoing model first
            if (r?.state === LOAD_OK) { setLoadState(r.state); setStrandedLocal(null); setPromoting(null); }
            setSeedName(false);          // the wizard already named it; nothing left to seed
            setDoc(built || r?.doc || null);
            loadCompanyName();
          } catch (e) {
            setErr(e?.message || "Could not create the company.");
            return;                      // stay in the wizard so the answers aren't lost
          }
        } else if (built) {
          // An all-skipped wizard hands back null and writes NOTHING, so the account stays as new as
          // it was found and can be offered the wizard again. Only a document with something in it is
          // set — and the ordinary save effect persists it, so there is one write path, not two.
          setDoc(built);
        }
        skipSetup(currentCompanyId());
        setSetup(null);
      }}
    />
  );

  if (showAccount) return (
    <Account
      doc={doc}
      onClose={() => setShowAccount(false)}
      // Adding a company opens the WIZARD, not a name box. Nothing is created until it finishes.
      onNewCompany={() => { setShowAccount(false); setSetup("company"); }}
      tabPrefs={tabPrefs}
      onTabPrefs={applyTabPrefs}
      onSwitched={(r) => {
        // switchCompany() already flushed and reset the write buffer; adopt whatever it loaded
        if (r?.state === LOAD_OK) { setDoc(r.doc); setLoadState(r.state); setSeedName(!!r.isNew); }
        // Switching to a company with an empty model offers the SAME wizard, deliberately — the second
        // company deserves the same start as the first, and "just a name box" was how the old flow
        // dumped people into an empty model. Emptiness rather than `isNew` for the reason given at the
        // load effect, and the skip flag is honoured because `switchCompany` has already pointed
        // `currentCompanyId()` at the company being switched TO: declining for one company must not
        // answer for another, and re-asking on every switch would be nagging.
        setSetup(!hasSubstance(r?.doc) && !setupSkipped(currentCompanyId()) ? "model" : null);
        setStrandedLocal(null);   // a freshly created company is `isNew` by definition; offering to
        setPromoting(null);       // fill it with a stale browser model would be actively wrong
        setShowAccount(false);
        loadCompanyName();        // a different company answers to a different name
      }}
    />
  );

  return <>
    <RunwayApp doc={doc} setDoc={setDoc} demo={demo} onLeaveDemo={onLeaveDemo} onKeepDemo={onKeepDemo}
               companyName={companyName}
               // The prompt exists exactly where the wizard does, so it is keyed on the SAME signal the
               // wizard trigger and the auth gate use: a registered session provider. `enableHostedSync`
               // only registers one when the config is complete, so the provider IS hosted mode. In demo
               // mode the model is never empty, and in local mode the screen above is still right.
               onSetup={!demo && getSessionProvider() ? () => setSetup("model") : null}
               onOpenAccount={demo ? null : () => setShowAccount(true)} />
    {demo && wasReset && (
      <div className="cf-backdrop" role="dialog" aria-modal="true" aria-label="Demo reset">
        <div className="cf-card">
          <h2>The demo reset</h2>
          <p>A demo is kept in this browser for twelve hours and then cleared, so what you were looking
            at has been replaced with a fresh sample company. Nothing was sent anywhere, and nothing of
            yours was touched.</p>
          <div className="cf-actions">
            <button className="addbtn" onClick={() => setWasReset(false)}>Carry on</button>
          </div>
          <div className="cf-fine">To keep a model past the window, create an account — the demo can be
            carried into it.</div>
        </div>
      </div>
    )}
    {promoting && (
      <PromoteDemoDialog
        demoDoc={promoting}
        onPromote={async () => {
          setDoc(promoting);      // adopt it locally...
          save(promoting);        // ...and push it to the account
          await flush();
          clearPromotion();
          setPromoting(null);
        }}
        onStartClean={() => { clearPromotion(); setPromoting(null); }}
      />
    )}
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

export { RunwayApp, ViewBoundary, demoDoc, toJSON, fromJSON };

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
  // DEMO MODE BYPASSES AUTH ENTIRELY. The whole point is showing the app to somebody who has not signed
  // up, so requiring an account first would defeat it. Survives a refresh within the tab, dies with it.
  const [demo, setDemo] = useState(() => {
    const hashed = typeof window !== "undefined" && window.location.hash.startsWith("#demo");
    // EXPIRY IS CHECKED BEFORE ACTIVATION, because activateDemoBackend reseeds over a closed window and
    // would erase the one fact needed to explain what happened. An expired envelope can only exist if
    // this browser entered a demo and never left it properly ("Leave demo" wipes), so the right move is
    // a fresh demo plus an explanation rather than a silent bounce to the sign-in screen — the hash is
    // NOT a reliable signal here, since routing rewrites it to #pay/#proj the moment anyone clicks.
    const expired = demoExpired();
    if (expired) { markDemoReset(); clearDemo(); }
    const wanted = hashed || demoInProgress() || expired;
    // Installed HERE rather than in an effect: DocumentHost calls load() as soon as it mounts, and an
    // effect runs after that — so the first read would go to the real backend and fail, showing
    // "Couldn't open your model" at somebody you were trying to sell to. A useState initialiser runs
    // during render, before any child exists.
    if (wanted) activateDemoBackend(demoDoc());
    return wanted;
  });

  const enterDemo = () => {
    activateDemoBackend(demoDoc());
    window.location.hash = "#demo";
    setDemo(true);
  };
  // ENV SAYS HOSTED BUT NOTHING REGISTERED. That combination is a misconfiguration, never a mode: it
  // means enableHostedSync() was not called (most often because the bootstrap in src/main.jsx is
  // commented out), and the app has silently fallen back to local-first — handing out access with no
  // sign-in and writing to this browser instead of the account. Falling back QUIETLY is the dangerous
  // part: everything looks like it works, and nothing is where the user thinks it is.
  const misconfigured = syncConfigured() && !session;
  // undefined = still checking (the SDK reads a stored session asynchronously); null = signed out.
  const [user, setUser] = useState(gated ? undefined : null);
  // null = the landing fork; "create" / "signin" = which side of it they picked.
  const [entry, setEntry] = useState(null);
  // Arriving from a reset link LOOKS like an ordinary sign-in — Supabase hands you a session. Sending
  // that person to the dashboard is a dead end: they came to change their password and there is now
  // nothing on screen that lets them. The PASSWORD_RECOVERY event is the only thing that distinguishes it.
  const [recovering, setRecovering] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);

  useEffect(() => {
    if (!gated) return;
    let alive = true;
    session.current().then(s => { if (alive) setUser(s); }).catch(() => { if (alive) setUser(null); });
    const off = session.onChange((s, event) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setUser(s);
    });
    return () => { alive = false; off(); };
  }, [gated, session]);

  // KEEP THIS MODEL. Stash first, then wipe, then go to the sign-in screen so they can create the
  // account this is destined for. The stash is what survives the round trip — including the email
  // confirmation that may well open a different tab — and it is claimed on the far side by the first
  // empty account that loads.
  const keepDemo = (d) => {
    stashPromotion(d);
    clearDemo();
    window.location.hash = "";
    window.location.reload();
  };

  if (demo) return <DocumentHost demo onKeepDemo={keepDemo}
    onLeaveDemo={() => { clearDemo(); window.location.hash = ""; window.location.reload(); }} />;

  if (misconfigured) return (
    <div className="rw"><div className="splash" style={{ maxWidth: 560, textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>Sync is configured but never started</h2>
      <p>This build has Supabase settings, so it should be asking you to sign in — but nothing registered
        a session provider, which means <code>enableHostedSync()</code> was never called.</p>
      <p>Almost always this is the bootstrap block in <code>src/main.jsx</code> being commented out.
        Uncomment it, rebuild, and reload.</p>
      <p><b>Nothing has been lost.</b> The app is refusing to open rather than quietly running against
        this browser's storage, which would put your work somewhere other than your account.</p>
      <button className="addbtn" onClick={() => window.location.reload()}>Reload</button>
    </div></div>
  );

  if (gated && recovering) return (
    <SetPassword
      mode="reset"
      email={user?.user?.email || ""}
      busy={pwBusy}
      error={pwError}
      onSubmit={async (pw) => {
        setPwError(null); setPwBusy(true);
        const r = await session.updatePassword(pw);
        setPwBusy(false);
        if (r.ok) setRecovering(false);          // the recovery session becomes an ordinary one
        else setPwError(r.message);
      }}
    />
  );
  if (gated && user === undefined) {
    return <div className="rw"><div className="splash">Checking your session\u2026</div></div>;
  }
  if (gated && user === null) {
    // The landing screen is the DEFAULT, and SignIn is reached through it. Rendering the form first
    // and hanging the demo off the bottom of it was the old arrangement, and it asked people to
    // authenticate to a product they had not yet decided they wanted.
    if (entry === null) return (
      <Landing onDemo={enterDemo} onCreate={() => setEntry("create")} onSignIn={() => setEntry("signin")} />
    );
    return <SignIn session={session} onDemo={enterDemo} onBack={() => setEntry(null)}
                   initialMode={entry === "signin" ? "signin" : "create"} />;
  }
  return <DocumentHost />;
}

/** Who you are signed in as, and the way out. Reads the registered provider directly rather than being
 *  threaded through the app, and renders nothing at all in local mode. */
function SessionPill({ onOpenAccount }) {
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
      {email && (onOpenAccount
        ? <button className="linkbtn sessionpill-who" title={email} onClick={onOpenAccount}>{email}</button>
        : <span className="sessionpill-who" title={email}>{email}</span>)}
      <button className="linkbtn" onClick={async () => {
        // flush first: signing out with unsaved work in the buffer would drop it silently
        await flush();
        await session.signOut();
      }}>Sign out</button>
    </span>
  );
}
