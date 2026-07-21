// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { createContext, useContext, useEffect, useState } from "react";
import { MS_STATUS, TIMING_LABEL, computeGrant, isMsBilled, msPaid, msTier } from "../engine/grant";
import { tripCost } from "../engine/history";
import { money, moneyFull } from "../engine/money";
import { HRS_YR, empHourlyAt, empTitleAt } from "../engine/payroll";
import { buildProjection, lineSpan } from "../engine/projection";
import { blankGrant, blankInternal, compileProject } from "../engine/projects";
import { projectSummary } from "../engine/summary";
import { ProjectChart } from "./chrome/ProjectChart";
import { CostSharePanel } from "./chrome/CostSharePanel";
import { codedActuals, effectiveActuals } from "../engine/coding";
import { PHASES, laborLine, poDevNeeded } from "../engine/sales";
import { HORIZON, clampM, monthLabel, nMon, uid } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { Sales } from "./Sales";
import { MOPTS, StageBar, TypeSeg, revOf, timingLabel } from "./chrome/bits";
import { I } from "./chrome/icons";
import { GrantIOModal } from "./chrome/modals";

const ActualsCtx = createContext({ setProjects: () => {}, hist: [], codeMap: {}, customerMap: {} });
const useProjectsSetter = () => useContext(ActualsCtx).setProjects;
const useActualsCtx = () => useContext(ActualsCtx);

export function Projects({ projects, setProjects, projWeeks, employees, pos = [], hist = [], codeMap = {}, customerMap = {} }) {
  const [tab, setTab] = useState("all");
  const [collapsed, setCollapsed] = useState(() => new Set());   // UI state — which cards are folded
  // A sub-tab with more than one project opens collapsed, so you scan headers instead of a wall of
  // cards. Fires ONCE per tab (tracked in autoDone) — otherwise expanding a card would re-fold it on
  // the next render. Expanding, collapsing, and switching tabs all behave normally after.
  const [autoDone, setAutoDone] = useState(() => new Set());
  const toggle = (id) => setCollapsed(c => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShownCollapsed = (list) => list.length > 0 && list.every(p => collapsed.has(p.id));
  const setMany = (list, on) => setCollapsed(c => { const n = new Set(c); list.forEach(p => on ? n.add(p.id) : n.delete(p.id)); return n; });
  const setP = (id, patch) => setProjects(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
  const setGrant = (id, patch) => setProjects(ps => ps.map(p => p.id === id ? { ...p, grant: { ...p.grant, ...patch } } : p));
  const delP = (id) => setProjects(ps => ps.filter(p => p.id !== id));
  const addInternal = () => setProjects(ps => [...ps, { id: uid(), type: "internal", stage: "awarded", name: "New project", ...blankInternal() }]);
  const addGrant = () => setProjects(ps => [...ps, { id: uid(), type: "grant", stage: "awarded", name: "New grant", grant: blankGrant() }]);
  const addProposal = () => { setProjects(ps => [...ps, { id: uid(), type: "grant", stage: "prospective", include: false, decisionMonth: 3, name: "New proposal", grant: blankGrant() }]); setTab("proposals"); };
  // switching a proposal's type keeps both structures, so flipping back and forth never loses work
  const setType = (id, type) => setProjects(ps => ps.map(p => {
    if (p.id !== id) return p;
    const n = { ...p, type };
    if (type === "grant" && !n.grant) n.grant = blankGrant();
    if (type === "internal" && !n.lines) Object.assign(n, blankInternal());
    return n;
  }));

  const isProp = (p) => p.stage === "prospective";
  const internals = projects.filter(p => p.type === "internal" && !isProp(p));
  const fulfils = projects.filter(p => p.type === "fulfillment" && !isProp(p));
  const grants = projects.filter(p => p.type === "grant" && !isProp(p));
  const proposals = projects.filter(isProp);

  const internalDraw = internals.reduce((a, p) => a + compileProject(p).reduce((s, l) => s + lineSpan(l), 0), 0);
  const grantFunding = grants.reduce((a, p) => a + revOf(p), 0);
  const grantCostShare = grants.reduce((a, p) => a + (computeGrant(p.grant).grand.costShare || 0), 0);
  const prospectFunding = proposals.reduce((a, p) => a + revOf(p), 0);
  const prospectDraw = proposals.filter(p => p.type === "internal").reduce((a, p) => a + (p.lines || []).reduce((s, l) => s + lineSpan(l), 0), 0);
  const nIncluded = proposals.filter(p => p.include).length;

  const shown = tab === "all" ? projects : tab === "internal" ? internals : tab === "grants" ? grants : tab === "fulfil" ? fulfils : proposals;
  useEffect(() => {
    if (autoDone.has(tab)) return;
    setAutoDone(a => new Set(a).add(tab));
    if (shown.length > 1) setCollapsed(c => { const n = new Set(c); shown.forEach(p => n.add(p.id)); return n; });
  }, [tab, shown, autoDone]);
  const TABS = [["all", "All", projects.length], ["internal", "Internal", internals.length], ["grants", "Grants", grants.length], ["fulfil", "Fulfillment", fulfils.length], ["proposals", "Proposals", proposals.length]];
  const empty = { fulfil: ["No fulfillment projects yet.", "Create one from a purchase order in the Sales tab to model the cost of shipping it."],
    internal: ["No internal projects yet.", "Work funded from your own cash — R&D pushes, tooling, buildouts."],
    grants: ["No awarded grants yet.", "Won an award? Mark a proposal awarded and it lands here."],
    proposals: ["No proposals in flight.", "Submitted something? Track it here and model the win before you hear back."],
    all: ["Nothing here yet.", "Add an internal project, a grant, or a proposal to get started."] }[tab];

  const actualsCtx = { setProjects, hist, codeMap, customerMap };
  const maps = { codeMap, customerMap };
  return (
    <ActualsCtx.Provider value={actualsCtx}>
    <>
      <div className="subtabs">
        {TABS.map(([k, label, n]) => (
          <button key={k} className={"subtab" + (k === "proposals" ? " prop" : "") + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
            {label}<span className="cnt">{n}</span>
          </button>
        ))}
      </div>

      {tab === "all" && (
        <div className="stats">
          <div className="stat"><div className="lab">Initiatives</div><div className="big">{projects.length}</div><div className="meta">{internals.length} internal · {grants.length} grant{grants.length !== 1 ? "s" : ""}{proposals.length ? ` · ${proposals.length} proposal${proposals.length !== 1 ? "s" : ""}` : ""}</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Internal cash draw</div><div className="big">{money(internalDraw)}</div><div className="meta">from your own funds</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--signal)" }} /><div className="lab">Grant funding inbound</div><div className="big">{money(grantFunding)}</div><div className="meta">awarded, net of cost-share</div></div>
          <div className="stat hero"><div className="lab">Runway impact</div><div className="big">−{projWeeks} wks</div><div className="meta">active initiatives, net</div></div>
        </div>
      )}
      {tab === "internal" && (
        <div className="stats">
          <div className="stat"><div className="lab">Internal projects</div><div className="big">{internals.length}</div><div className="meta">funded from your own cash</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Internal cash draw</div><div className="big">{money(internalDraw)}</div><div className="meta">total across the horizon</div></div>
        </div>
      )}
      {tab === "grants" && (
        <div className="stats">
          <div className="stat"><div className="lab">Awarded grants</div><div className="big">{grants.length}</div><div className="meta">under contract</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--signal)" }} /><div className="lab">Funding inbound</div><div className="big">{money(grantFunding)}</div><div className="meta">across the horizon</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--danger)" }} /><div className="lab">Cost-share owed</div><div className="big">{money(grantCostShare)}</div><div className="meta">your non-federal match</div></div>
        </div>
      )}
      {tab === "proposals" && (
        <div className="stats">
          <div className="stat"><div className="accent" style={{ background: "var(--caution)" }} /><div className="lab">In flight</div><div className="big">{proposals.length}</div><div className="meta">{nIncluded} modeled in the runway</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--signal)" }} /><div className="lab">Funding at stake</div><div className="big">{money(prospectFunding)}</div><div className="meta">if every grant proposal lands</div></div>
          {prospectDraw > 0 && <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Internal spend at stake</div><div className="big">{money(prospectDraw)}</div><div className="meta">if approved, drawn from cash</div></div>}
        </div>
      )}

      {tab === "all" && (
        <div className="callout" style={{ borderLeftColor: "var(--caution)" }}>
          Internal projects draw on your cash; grants bring external funding, but their <b>cost-share</b> (<b className="num">{money(grantCostShare)}</b>) and reimbursement lag still hit runway. Net effect across active initiatives: about <b className="num">−{projWeeks} weeks</b>.
        </div>
      )}
      {(tab === "all" || tab === "proposals") && proposals.length > 0 && (
        <div className="callout" style={{ borderLeftColor: "var(--caution)", background: "rgba(201,130,27,.06)" }}>
          <b>{proposals.length} proposal{proposals.length !== 1 ? "s" : ""}</b> awaiting a decision{prospectFunding > 0 ? <> — worth <b className="num" style={{ color: "var(--signal-ink)" }}>{money(prospectFunding)}</b> if the grants land</> : null}. {nIncluded > 0 ? <><b>{nIncluded}</b> currently modeled in the runway — the rest stay out until you toggle them in.</> : <>None are in the runway yet; toggle one in to model the win.</>} Mark one <b>awarded</b> and it moves to {proposals.some(p => p.type === "internal") ? <>Grants or Internal</> : <>Grants</>}.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 14 }}>
        {(tab === "all" || tab === "internal") && <button className="addbtn ghost" onClick={addInternal}>{I.plus} Internal project</button>}
        {(tab === "all" || tab === "proposals") && <button className="addbtn ghost" onClick={addProposal}>{I.plus} Proposal</button>}
        {(tab === "all" || tab === "grants") && <button className="addbtn ghost" onClick={addGrant}>{I.plus} Grant</button>}
      </div>

      {shown.length > 1 && (
        <div className="collapsebar">
          <button className="linkbtn" onClick={() => setMany(shown, !allShownCollapsed(shown))}>
            {allShownCollapsed(shown) ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}
      {shown.map(p => collapsed.has(p.id)
        ? <CollapsedProject key={p.id} p={p} pos={pos} hist={hist} codeMap={codeMap} customerMap={customerMap} onExpand={() => toggle(p.id)} />
        : <div className="projwrap" key={p.id}>
            <button className="projfold" onClick={() => toggle(p.id)} title="Collapse">{I.chevUp || "−"}</button>
            {p.type === "fulfillment"
              ? <FulfillmentCard p={p} po={pos.find(x => x.id === p.poId)} setP={setP} setPById={setP} delP={delP} employees={employees} />
              : p.type === "grant"
              ? <GrantCard p={p} setP={setP} setGrant={setGrant} setType={setType} delP={delP} employees={employees} />
              : <InternalCard p={p} setProjects={setProjects} setP={setP} setType={setType} delP={delP} />}
          </div>)}
      {shown.length === 0 && (
        <div className="emptytab"><b>{empty[0]}</b><span>{empty[1]}</span></div>
      )}
    </>
    </ActualsCtx.Provider>
  );
}

/* ---- internal project (draws internal funds) ---- */
export function InternalCard({ p, setProjects, setP: setPById, setType, delP }) {
  const { START_Y, START_M } = useStart();
  const setP = (patch) => setProjects(ps => ps.map(x => x.id === p.id ? { ...x, ...patch } : x));
  const prospective = p.stage === "prospective";
  const updLine = (lid, patch) => setProjects(ps => ps.map(x => x.id !== p.id ? x : { ...x, lines: x.lines.map(l => l.id === lid ? { ...l, ...patch } : l) }));
  const delLine = (lid) => setProjects(ps => ps.map(x => x.id !== p.id ? x : { ...x, lines: x.lines.filter(l => l.id !== lid) }));
  const addLine = () => setProjects(ps => ps.map(x => x.id !== p.id ? x : { ...x, lines: [...x.lines, { id: uid(), label: "New line", cadence: "onetime", kind: "cost", amount: 5000, start: x.start, growthPct: 0 }] }));

  const r = buildProjection({ cashOnHand: 0, horizon: HORIZON, lineItems: p.lines }, { committed: 1, expected: 1, speculative: 1 });
  const s = { total: r.reduce((a, x) => a + x.cost, 0), monthly: r.map(x => x.cost) };
  const over = s.total > p.budget;
  const trackMax = Math.max(s.total, p.budget, 1), spendW = (s.total / trackMax) * 100, budgetX = (p.budget / trackMax) * 100;
  const win = []; for (let m = p.start; m <= Math.min(p.end, HORIZON); m++) win.push(m);
  const maxM = Math.max(1, ...win.map(m => s.monthly[m] || 0));

  return (
    <div className={"pcard" + (prospective ? " prospect" : "")}>
      <div className="pcard-h">
        <span className={"gbadge" + (prospective ? " prospect" : "")} style={prospective ? null : { background: "var(--line-2)", color: "var(--muted)", borderColor: "var(--line)" }}>{prospective ? "PROPOSAL" : "INTERNAL"}</span>
        <input className="inp" style={{ width: 190, textAlign: "left", fontWeight: 600, fontSize: 14 }} value={p.name} onChange={e => setP({ name: e.target.value })} />
        <span className={"chip " + (over ? "bad" : "ok")}>{over ? "over budget" : "on budget"}</span>
        <div style={{ flex: 1 }} />
        <TypeSeg p={p} setType={setType} />
        <label className="fieldlab">Budget<input className="inp" type="number" value={p.budget} onChange={e => setP({ budget: +e.target.value })} /></label>
        <button className="iconbtn" onClick={() => delP(p.id)} aria-label="Delete project">{I.trash}</button>
      </div>
      <div style={{ padding: "18px 18px 0" }}><StageBar p={p} setP={setPById} /></div>
      <div style={{ padding: 18 }}>
        <div className="prow">
          <div className="pcol">
            <div className="fieldlab" style={{ marginBottom: 4 }}>Timeline</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select className="sel" value={p.start} onChange={e => setP({ start: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
              <span style={{ color: "var(--muted-2)" }}>→</span>
              <select className="sel" value={p.end} onChange={e => setP({ end: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
            </div>
            <div className="pmini">
              {win.map(m => (
                <div key={m} className="pbwrap" title={monthLabel(START_Y, START_M, m) + ": " + money(s.monthly[m] || 0)}>
                  <div className="pb" style={{ height: `${((s.monthly[m] || 0) / maxM) * 40}px` }} />
                  <span>{monthLabel(START_Y, START_M, m).split(" ")[0]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="pcol">
            <div className="fieldlab" style={{ marginBottom: 10 }}>Budget vs projected spend</div>
            <div className="budgetbar">
              {over ? (<><div className="fill" style={{ width: budgetX + "%", background: "var(--caution)" }} /><div className="overseg" style={{ left: budgetX + "%", right: 0 }} /></>)
                    : (<div className="fill" style={{ width: Math.max(2, spendW) + "%", background: "var(--signal)" }} />)}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <span className="num" style={{ fontSize: 14, fontWeight: 500, color: over ? "var(--danger)" : "var(--signal-ink)" }}>{moneyFull(s.total)}</span>
              <span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>of {moneyFull(p.budget)} budget</span>
            </div>
            <div className="num" style={{ fontSize: 12, marginTop: 6, color: over ? "var(--danger)" : "var(--muted)" }}>
              {over ? `${money(s.total - p.budget)} over budget` : `${money(p.budget - s.total)} headroom`}
            </div>
          </div>
        </div>
        <table className="tbl" style={{ marginTop: 18 }}>
          <thead><tr><th>Cost line</th><th>Cadence</th><th style={{ textAlign: "right" }}>Amount</th><th>Timing</th><th style={{ textAlign: "right" }}>Growth</th><th></th></tr></thead>
          <tbody>
            {p.lines.map(l => (
              <tr key={l.id}>
                <td><input className="inp" style={{ width: 150, textAlign: "left" }} value={l.label} onChange={e => updLine(l.id, { label: e.target.value })} /></td>
                <td><select className="sel" value={l.cadence} onChange={e => updLine(l.id, { cadence: e.target.value, end: e.target.value === "onetime" ? undefined : p.end })}><option value="recurring">Recurring</option><option value="onetime">One-time</option></select></td>
                <td className="amt"><input className="inp" type="number" value={l.amount} onChange={e => updLine(l.id, { amount: +e.target.value })} /></td>
                <td className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{timingLabel(l, START_Y, START_M)}</td>
                <td className="amt">{l.cadence === "recurring" ? <><input className="inp sm" type="number" value={l.growthPct || 0} onChange={e => updLine(l.id, { growthPct: +e.target.value })} /><span style={{ fontSize: 11, color: "var(--muted-2)", marginLeft: 4 }}>%</span></> : <span style={{ color: "var(--muted-2)" }}>—</span>}</td>
                <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delLine(l.id)} aria-label="Delete line">{I.trash}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="addbtn ghost" style={{ marginTop: 12 }} onClick={addLine}>{I.plus} Add cost line</button>
      </div>
      {!prospective && <CostShareWrap p={p} />}
      {!prospective && <ProjectChartWrap p={p} />}
      {!prospective && <ActualsOverride p={p} />}

    </div>
  );
}

export function GrantCard({ p, setP, setGrant, setType, delP, employees = [] }) {
  const g = p.grant, R = computeGrant(g);
  const prospective = p.stage === "prospective";
  const [io, setIo] = useState(false);
  const grantCost = R.lines.filter(l => l.kind === "cost").reduce((a, l) => a + lineSpan(l), 0);
  const grantPay = R.lines.filter(l => l.kind === "revenue").reduce((a, l) => a + lineSpan(l), 0);
  const ms = isMsBilled(g);
  return (
    <div className={"pcard" + (prospective ? " prospect" : "")}>
      <div className="pcard-h">
        <span className={"gbadge" + (prospective ? " prospect" : "")}>{prospective ? "PROPOSAL" : "GRANT"}</span>
        <input className="inp" style={{ width: 170, textAlign: "left", fontWeight: 600, fontSize: 14 }} value={p.name} onChange={e => setP(p.id, { name: e.target.value })} />
        <input className="inp" style={{ width: 110, textAlign: "left", fontSize: 12, color: "var(--muted)" }} value={g.funder} onChange={e => setGrant(p.id, { funder: e.target.value })} />
        <div style={{ flex: 1 }} />
        <TypeSeg p={p} setType={setType} />
        <button className="iobtn" onClick={() => setIo(true)} title="Import / export SF-424A">{I.swap} SF-424A</button>
        <button className="iconbtn" onClick={() => delP(p.id)} aria-label="Delete grant">{I.trash}</button>
      </div>
      {io && <GrantIOModal p={p} g={g} R={R} setGrant={setGrant} onClose={() => setIo(false)} />}
      <div style={{ padding: 18 }}>
        <StageBar p={p} setP={setP} />
        <div className="gfund">
          <button className={"gtoggle " + (g.assumeFunded ? "on" : "")} onClick={() => setGrant(p.id, { assumeFunded: !g.assumeFunded })}>
            <span className="dot" />{g.assumeFunded ? "Assuming funded — federal share nets out of cash" : "Timing-aware — reimbursement lag draws down cash"}
          </button>
          <div className="gnet">
            <span>New cash out<b className="num">{moneyFull(grantCost)}</b></span>
            {R.grand.allocated > 0.5 && <span>Already in payroll/opex<b className="num" style={{ color: "var(--muted)" }}>{moneyFull(R.grand.allocated)}</b></span>}
            <span>Funding in<b className="num" style={{ color: "var(--signal-ink)" }}>{moneyFull(grantPay)}</b></span>
            <span>Cost-share<b className="num" style={{ color: "var(--danger)" }}>{moneyFull(R.grand.costShare || 0)}</b></span>
          </div>
        </div>
        <div className="gctrls">
          <label className="fl">Cost-share %<input className="inp" type="number" value={Math.round((g.costSharePct || 0) * 100)} onChange={e => setGrant(p.id, { costSharePct: (+e.target.value) / 100 })} /></label>
          <label className="fl">Cost-share type<select className="sel" value={g.costShareType} onChange={e => setGrant(p.id, { costShareType: e.target.value })}><option value="cash">Cash (draws runway)</option><option value="inkind">In-kind (non-cash)</option></select></label>
          <label className="fl">Reimbursement<select className="sel" value={g.reimburseTiming || "arrears"} onChange={e => setGrant(p.id, { reimburseTiming: e.target.value })}>
            {["arrears", "monthly", "advance", "milestone"].map(k => <option key={k} value={k}>{TIMING_LABEL[k]}</option>)}
          </select></label>
          {<label className="fl" style={g.assumeFunded ? { opacity: .45, pointerEvents: "none" } : null}>Lag (months)<input className="inp sm" type="number" value={g.reimburseLagMonths || 0} onChange={e => setGrant(p.id, { reimburseLagMonths: +e.target.value })} /></label>}
        </div>
        {ms && <MilestoneTable p={p} g={g} setGrant={setGrant} />}
        <GrantBudget p={p} g={g} R={R} setGrant={setGrant} employees={employees} />
      </div>

      {!prospective && <CostShareWrap p={p} />}
      {!prospective && <ProjectChartWrap p={p} />}
      {!prospective && <ActualsOverride p={p} />}
    </div>
  );
}

/* ---- milestone award schedule (shown when reimbursement is "On milestone delivery") ---- */
export function MilestoneTable({ p, g, setGrant }) {
  const { START_Y, START_M } = useStart();
  const upM = (id, patch) => setGrant(p.id, { milestones: (g.milestones || []).map(m => m.id === id ? { ...m, ...patch } : m) });
  const delM = (id) => setGrant(p.id, { milestones: (g.milestones || []).filter(m => m.id !== id) });
  const addM = () => setGrant(p.id, { milestones: [...(g.milestones || []), { id: uid(), label: "New milestone", month: 6, payment: 25000 }] });
  const totalPay = (g.milestones || []).reduce((a, m) => a + (m.payment || 0), 0);
  // The schedule is hand-entered; the budget is computed. Nothing forces them to agree, and billing
  // against a share you haven't budgeted shouldn't be discoverable only at audit.
  const federal = computeGrant(g).grand.federal;
  const collected = (g.milestones || []).filter(msPaid).reduce((a, m) => a + (m.payment || 0), 0);
  const gap = totalPay - federal, off = Math.abs(gap) > 1 && (g.milestones || []).length > 0;
  // True up on the last milestone — which is how a final invoice actually settles.
  const balance = () => {
    const list = g.milestones || []; if (!list.length) return;
    const last = list[list.length - 1];
    setGrant(p.id, { milestones: list.map(m => m.id === last.id ? { ...m, payment: Math.round((m.payment || 0) - gap) } : m) });
  };

  return (
    <>
      <div className="fieldlab" style={{ marginBottom: 8 }}>Milestone / award schedule <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--muted-2)", fontWeight: 400 }}>· reimbursed in arrears on delivery — the month below is the month you’re paid</span></div>
      <div className="pgrid">
        <table className="tbl"><thead><tr><th>Milestone</th><th>Delivered</th><th style={{ textAlign: "right" }}>Payment</th><th>Status</th><th>Cash lands</th><th></th></tr></thead>
          <tbody>
            {(g.milestones || []).map(m => (
              <tr key={m.id}>
                <td><input className="inp" style={{ width: 150, textAlign: "left" }} value={m.label} onChange={e => upM(m.id, { label: e.target.value })} /></td>
                <td><select className="sel" value={m.month} onChange={e => upM(m.id, { month: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></td>
                <td className="amt"><input className="inp" type="number" value={m.payment} onChange={e => upM(m.id, { payment: +e.target.value })} /></td>
                <td><select className="sel" value={m.status || "planned"} onChange={e => upM(m.id, { status: e.target.value })}>{MS_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td>{msPaid(m)
                  ? <span className="schip" style={{ background: "var(--line-2)", color: "var(--muted-2)" }}>in cash already</span>
                  : <><span className="num" style={{ fontSize: 12 }}>{monthLabel(START_Y, START_M, (m.month || 0) + (g.reimburseLagMonths || 0))}</span>
                      <span className={"conf " + msTier(m)} style={{ marginLeft: 6, cursor: "default" }}>{msTier(m)}</span></>}</td>
                <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delM(m.id)} aria-label="Delete milestone">{I.trash}</button></td>
              </tr>
            ))}
            {(g.milestones || []).length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted-2)", textAlign: "center", padding: 16 }}>No milestones yet — add the award schedule or import it.</td></tr>}
            {(g.milestones || []).length > 0 && <tr className="totrow"><td>Total scheduled</td><td /><td className="amt num" style={off ? { color: "var(--caution)" } : null}>{moneyFull(totalPay)}</td><td colSpan={3} /></tr>}
            {(g.milestones || []).length > 0 && <tr className="totrow"><td style={{ fontWeight: 400, color: "var(--muted)" }}>Federal share of the budget</td><td /><td className="amt num" style={{ fontWeight: 400, color: "var(--muted)" }}>{moneyFull(federal)}</td><td colSpan={3} /></tr>}
            {collected > 0.5 && <tr className="totrow"><td style={{ fontWeight: 400, color: "var(--muted)" }}>Already collected</td><td /><td className="amt num" style={{ fontWeight: 400, color: "var(--muted)" }}>{moneyFull(collected)}</td><td colSpan={3} style={{ fontFamily: "var(--fb)", fontSize: 11.5, color: "var(--muted-2)", fontWeight: 400 }}>in cash on hand — not projected again</td></tr>}
          </tbody>
        </table>
      </div>
      {off && (
        <div className="review" style={{ marginTop: 10 }}>
          <span className="rvflag">Schedule ≠ budget</span>
          <span className="rvbody">This schedule bills <b className="num">{moneyFull(totalPay)}</b> against a federal share of <b className="num">{moneyFull(federal)}</b> — {gap > 0 ? <>you are claiming <b className="num">{moneyFull(gap)}</b> more than the budget supports.</> : <>you are leaving <b className="num">{moneyFull(-gap)}</b> of your award unclaimed.</>} Arrears billing derives payments from the budget and cannot drift; a milestone schedule is typed by hand and can.</span>
          <div style={{ flex: 1 }} />
          <button className="rvbtn go" onClick={balance}>Balance last milestone</button>
        </div>
      )}
      <button className="addbtn ghost" style={{ marginTop: 10, marginBottom: 16 }} onClick={addM}>{I.plus} Add milestone</button>
    </>
  );
}

/* ---- PO fulfillment: the cost of actually shipping a purchase order ---- */
export function FulfillmentCard({ p, po, setP, setPById, delP, employees = [] }) {
  const { START_Y, START_M } = useStart();
  const prospective = p.stage === "prospective";
  const upL = (id, patch) => setPById(p.id, { lines: (p.lines || []).map(l => l.id === id ? { ...l, ...patch } : l) });
  const delL = (id) => setPById(p.id, { lines: (p.lines || []).filter(l => l.id !== id) });
  const addL = (phase) => setPById(p.id, { lines: [...(p.lines || []), { id: uid(), label: "New cost", phase, cadence: "onetime", kind: "cost", amount: 5000, start: clampM(po?.deliveryMonth ?? 4) }] });
  const addLabor = (phase) => setPById(p.id, { lines: [...(p.lines || []), laborLine("New labour", phase, 0, 0, clampM(po?.bookedMonth ?? 0), clampM(po?.deliveryMonth ?? 4))] });

  const cost = (p.lines || []).reduce((a, l) => a + lineSpan(l), 0);           // all-in, labour included
  const laborCost = (p.lines || []).filter(l => l.isLabor).reduce((a, l) => a + lineSpan(l), 0);
  const cashCost = cost - laborCost;                                            // what actually leaves the bank
  const value = po?.amount || 0;
  const margin = value - cost, marginPct = value > 0 ? (margin / value) * 100 : 0;
  const del = po?.deliveryMonth ?? null;
  const late = del == null ? [] : (p.lines || []).filter(l => (l.end != null ? l.end : l.start) > del);
  const timing = (l) => l.cadence === "onetime"
    ? monthLabel(START_Y, START_M, l.start)
    : `${monthLabel(START_Y, START_M, l.start)} → ${l.end == null ? "ongoing" : monthLabel(START_Y, START_M, l.end)}`;

  // How much of someone's working time this line actually consumes.
  const loadNote = (l) => {
    const e = employees.find(x => x.id === l.employeeId);
    if (!e) return "unassigned — no one is committed to this yet";
    const months = Math.max(1, (l.end ?? l.start ?? 0) - (l.start ?? 0) + 1);
    const load = Math.round(((l.hours || 0) / ((HRS_YR / 12) * months)) * 100);
    return `${e.name} · ${l.hours || 0} h over ${months} mo · ${load}% of their time · loaded cost, already in payroll`;
  };

  return (
    <div className={"pcard" + (prospective ? " prospect" : "")}>
      <div className="pcard-h">
        <span className="gbadge" style={{ background: "rgba(34,69,79,.1)", color: "var(--ink-2)" }}>FULFILLMENT</span>
        <input className="inp" style={{ width: 220, textAlign: "left", fontWeight: 600, fontSize: 14 }} value={p.name} onChange={e => setPById(p.id, { name: e.target.value })} />
        <div style={{ flex: 1 }} />
        <button className="iconbtn" onClick={() => delP(p.id)} aria-label="Delete fulfillment project">{I.trash}</button>
      </div>
      <div style={{ padding: 18 }}>
        {prospective && (
          <div className="review" style={{ marginBottom: 12 }}>
            <span className="rvflag">Under review</span>
            <span className="rvbody">Scope isn’t committed until the target gap is settled. Kick off or circumvent the development in <b>Sales → Orders</b> — this project becomes approved with whatever scope you choose.</span>
          </div>
        )}
        {po ? (
          <div className="polink">
            <span className="polabel">Fulfilling</span>
            <b className="num">{po.po}</b><span className="posep">·</span><span>{po.customer}</span>
            <span className="posep">·</span><b className="num">{moneyFull(value)}</b>
            <span className="posep">·</span><span>deliver {monthLabel(START_Y, START_M, po.deliveryMonth)}</span>
            {po && poDevNeeded(po) && <span className="devchip on" style={{ marginLeft: 6 }}>development needed</span>}
          </div>
        ) : (
          <div className="polink" style={{ borderLeftColor: "var(--danger)" }}><span style={{ color: "var(--danger)" }}>Order not found — it may have been deleted in Sales. This project's costs still count.</span></div>
        )}

        <div className="gfund" style={{ marginTop: 12 }}>
          <div className="gnet" style={{ width: "100%" }}>
            <span>Order value<b className="num">{moneyFull(value)}</b></span>
            <span>Cost to fulfil<b className="num" style={{ color: "var(--danger)" }}>{moneyFull(cost)}</b></span>
            <span>New cash out<b className="num">{moneyFull(cashCost)}</b></span>
            {laborCost > 0.5 && <span>Team time (in payroll)<b className="num" style={{ color: "var(--muted)" }}>{moneyFull(laborCost)}</b></span>}
            <span>Gross margin<b className="num" style={{ color: margin >= 0 ? "var(--signal-ink)" : "var(--danger)" }}>{moneyFull(margin)}</b><i style={{ fontStyle: "normal", fontSize: 10, color: "var(--muted-2)", marginLeft: 5 }}>{value > 0 ? `${marginPct.toFixed(0)}%` : ""}</i></span>
          </div>
        </div>

        {late.length > 0 && (
          <div className="callout" style={{ margin: "12px 0 0", borderLeftColor: "var(--caution)" }}>
            <b>{late.length} cost line{late.length !== 1 ? "s" : ""}</b> land after the {monthLabel(START_Y, START_M, del)} delivery date. Either the schedule slips or the spend is mis-timed — both change when the balance payment arrives.
          </div>
        )}

        <div className="pgrid" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead><tr><th>Line</th><th>Cadence / who</th><th style={{ textAlign: "right" }}>Amount / hours</th><th>Timing</th><th></th></tr></thead>
            <tbody>
              {PHASES.map(([ph, label]) => {
                const rows = (p.lines || []).filter(l => (l.phase || "production") === ph);
                if (!rows.length) return null;
                return (
                  <React.Fragment key={ph}>
                    <tr className="grouprow"><td colSpan={5}>{label}</td></tr>
                    {rows.map(l => l.isLabor ? (
                      <React.Fragment key={l.id}>
                        <tr className="laborrow">
                          <td><input className="inp" style={{ width: 170, textAlign: "left" }} value={l.label} onChange={e => upL(l.id, { label: e.target.value })} /></td>
                          <td><select className="sel" value={l.employeeId || ""} onChange={e => upL(l.id, { employeeId: e.target.value || null })}>
                            <option value="">— unassigned</option>
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select></td>
                          <td className="amt"><input className="inp sm" type="number" value={l.hours || 0} onChange={e => upL(l.id, { hours: +e.target.value })} /><span style={{ fontSize: 11, color: "var(--muted-2)", marginLeft: 3 }}>h</span></td>
                          <td><div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                            <select className="sel" value={l.start} onChange={e => upL(l.id, { start: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
                            <span style={{ color: "var(--muted-2)", fontSize: 11 }}>→</span>
                            <select className="sel" value={l.end ?? l.start} onChange={e => upL(l.id, { end: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
                          </div></td>
                          <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delL(l.id)} aria-label="Delete line">{I.trash}</button></td>
                        </tr>
                        <tr className="emprow-sub"><td colSpan={5}>
                          <div className="laborsub">
                            <span className="branch">└</span>
                            <span className="devchip">labour</span>
                            <span>{loadNote(l)}</span>
                            <div style={{ flex: 1 }} />
                            <b className="num" style={{ color: "var(--muted)" }}>{moneyFull(lineSpan(l))}</b>
                            <span style={{ fontSize: 10.5, color: "var(--muted-2)" }}>salary + burden · counted in margin, not in cash</span>
                          </div>
                        </td></tr>
                      </React.Fragment>
                    ) : (
                      <tr key={l.id}>
                        <td><input className="inp" style={{ width: 170, textAlign: "left" }} value={l.label} onChange={e => upL(l.id, { label: e.target.value })} /></td>
                        <td><select className="sel" value={l.cadence} onChange={e => upL(l.id, { cadence: e.target.value, end: e.target.value === "onetime" ? undefined : clampM(l.start + 1) })}>
                          <option value="onetime">One-time</option><option value="recurring">Recurring</option>
                        </select></td>
                        <td className="amt"><input className="inp" type="number" value={l.amount} onChange={e => upL(l.id, { amount: +e.target.value })} /></td>
                        <td><div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <select className="sel" value={l.start} onChange={e => upL(l.id, { start: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
                          {l.cadence === "recurring" && <><span style={{ color: "var(--muted-2)", fontSize: 11 }}>→</span>
                            <select className="sel" value={l.end ?? l.start} onChange={e => upL(l.id, { end: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></>}
                        </div></td>
                        <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delL(l.id)} aria-label="Delete line">{I.trash}</button></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {(p.lines || []).length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted-2)", textAlign: "center", padding: 16 }}>No fulfillment costs yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {PHASES.map(([ph, label]) => <button key={ph} className="addbtn ghost" onClick={() => addL(ph)}>{I.plus} {label}</button>)}
          <button className="addbtn ghost" onClick={() => addLabor("development")}>{I.plus} Labour</button>
        </div>
      </div>

      {!prospective && <CostShareWrap p={p} />}
      {!prospective && <ProjectChartWrap p={p} />}
      {!prospective && <ActualsOverride p={p} />}
    </div>
  );
}

/* ---- shared SF-424A Section B budget editor (used by every grant) ---- */
export function GrantBudget({ p, g, R, setGrant, employees = [] }) {
  const { START_Y, START_M } = useStart();
  const P = g.periods, n = P.length, C = g.categories;
  const [catOpen, setCatOpen] = useState(false);
  const [tab, setTab] = useState("personnel");
  const setCat = (key, val) => setGrant(p.id, { categories: { ...C, [key]: val } });
  const pad = (arr, def) => { arr = arr ? arr.slice() : []; while (arr.length < n) arr.push(def()); return arr; };

  // budget-period ops (keep every byPeriod array in sync)
  const mapPeriods = (fn) => {
    const nc = { ...C };
    nc.personnel = C.personnel.map(l => ({ ...l, byPeriod: fn(l.byPeriod, () => ({ hrs: 0, rate: 0 })) }));
    nc.fringe = { ...C.fringe, byPeriod: fn(C.fringe.byPeriod, () => 0) };
    nc.other = C.other.map(l => ({ ...l, byPeriod: fn(l.byPeriod, () => 0) }));
    nc.contractual = C.contractual.map(l => ({ ...l, byPeriod: fn(l.byPeriod, () => 0) }));
    nc.construction = C.construction.map(l => ({ ...l, byPeriod: fn(l.byPeriod, () => 0) }));
    nc.indirect = { ...C.indirect, rates: C.indirect.rates.map(r => ({ ...r, byPeriod: fn(r.byPeriod, () => 0) })) };
    return nc;
  };
  const addPeriod = () => { const last = P[n - 1]; const start = last ? Math.min(HORIZON, last.end + 1) : 0;
    setGrant(p.id, { periods: [...P, { id: uid(), start, end: Math.min(HORIZON, start + 5) }], categories: mapPeriods((a, def) => [...(a || []), def()]) }); };
  const delPeriod = (idx) => { if (n <= 1) return; setGrant(p.id, { periods: P.filter((_, i) => i !== idx), categories: mapPeriods(a => (a || []).filter((_, i) => i !== idx)) }); };
  const setPeriod = (idx, patch) => setGrant(p.id, { periods: P.map((pp, i) => i === idx ? { ...pp, ...patch } : pp) });

  // per-category editors
  const persField = (id, patch) => setCat("personnel", C.personnel.map(l => l.id === id ? { ...l, ...patch } : l));
  // reconcile what the grant bills against what the person actually costs / can actually work
  const isAuto = (l) => !!l.employeeId && l.rateAuto !== false;
  const payrollNote = (l) => {
    if (!l.employeeId) return "not in payroll — draws new cash";
    const e = employees.find(x => x.id === l.employeeId);
    if (!e) return "employee not found — relink";
    const hrs = (l.byPeriod || []).reduce((a, b) => a + (b?.hrs || 0), 0);
    const months = P.reduce((a, pp) => a + nMon(pp), 0);
    const capacity = (HRS_YR / 12) * months;
    const load = capacity > 0 ? Math.round((hrs / capacity) * 100) : 0;
    const bits = [isAuto(l) ? "rate auto from payroll" : "manual rate override", `${load}% of their time`];
    if (!isAuto(l)) {
      const payRate = empHourlyAt(e, P[0]?.start ?? 0), billed = l.byPeriod?.[0]?.rate || 0;
      if (payRate && Math.abs(billed - payRate) / payRate > 0.01) bits.push(`payroll says $${Math.round(payRate)}/hr`);
    }
    if (load > 100) bits.push("over-allocated");
    return bits.join(" · ");
  };
  const persEdit = (id, i, patch) => setCat("personnel", C.personnel.map(l => l.id !== id ? l : { ...l, byPeriod: pad(l.byPeriod, () => ({ hrs: 0, rate: 0 })).map((b, j) => j === i ? { ...b, ...patch } : b) }));
  // typing over an auto-derived rate turns it into a manual override
  const persRate = (id, i, v) => setCat("personnel", C.personnel.map(l => l.id !== id ? l : { ...l, rateAuto: false, byPeriod: pad(l.byPeriod, () => ({ hrs: 0, rate: 0 })).map((b, j) => j === i ? { ...b, rate: v } : b) }));
  const addPers = () => setCat("personnel", [...C.personnel, { id: uid(), role: "New position", byPeriod: Array.from({ length: n }, () => ({ hrs: 0, rate: 0 })) }]);
  const delPers = (id) => setCat("personnel", C.personnel.filter(l => l.id !== id));
  const fringeEdit = (i, val) => setCat("fringe", { ...C.fringe, byPeriod: pad(C.fringe.byPeriod, () => 0).map((b, j) => j === i ? val : b) });
  const tripEdit = (id, patch) => setCat("travel", C.travel.map(t => t.id === id ? { ...t, ...patch } : t));
  const addTrip = () => setCat("travel", [...C.travel, { id: uid(), purpose: "Trip", days: 1, travelers: 1, lodging: 200, flight: 400, vehicle: 0, perDiem: 74, period: 0 }]);
  const delTrip = (id) => setCat("travel", C.travel.filter(t => t.id !== id));
  const qtyEdit = (key, id, patch) => setCat(key, C[key].map(x => x.id === id ? { ...x, ...patch } : x));
  const addQty = (key, label) => setCat(key, [...C[key], { id: uid(), item: label, qty: 1, unitCost: 1000, period: 0 }]);
  const delQty = (key, id) => setCat(key, C[key].filter(x => x.id !== id));
  const paEdit = (key, id, patch) => setCat(key, C[key].map(l => l.id === id ? { ...l, ...patch } : l));
  const paPeriod = (key, id, i, val) => setCat(key, C[key].map(l => l.id !== id ? l : { ...l, byPeriod: pad(l.byPeriod, () => 0).map((b, j) => j === i ? val : b) }));
  const addPA = (key, field, label) => setCat(key, [...C[key], { id: uid(), [field]: label, byPeriod: Array.from({ length: n }, () => 0) }]);
  const delPA = (key, id) => setCat(key, C[key].filter(l => l.id !== id));
  const rateEdit = (id, patch) => setCat("indirect", { ...C.indirect, rates: C.indirect.rates.map(r => r.id === id ? { ...r, ...patch } : r) });
  const ratePeriod = (id, i, val) => setCat("indirect", { ...C.indirect, rates: C.indirect.rates.map(r => r.id !== id ? r : { ...r, byPeriod: pad(r.byPeriod, () => 0).map((b, j) => j === i ? val : b) }) });
  const addRate = () => setCat("indirect", { ...C.indirect, rates: [...C.indirect.rates, { id: uid(), label: "Rate", byPeriod: Array.from({ length: n }, () => 0) }] });
  const delRate = (id) => setCat("indirect", { ...C.indirect, rates: C.indirect.rates.filter(r => r.id !== id) });

  const bpHead = (label) => <th className="bpcol" key={label}>{label}</th>;
  // full-width detail row holding a line item's free-text justification fields
  const jSubRow = (colSpan, fields) => (
    <tr className="jsub"><td colSpan={colSpan}>
      <div className="jline">{fields.map((f, i) => (
        <div className="jfield" key={i} style={f.wide ? { flex: 2.4 } : null}>
          <label>{f.label}</label>
          {f.options
            ? <select className="jinp" value={f.value || ""} onChange={f.onChange}>{f.options}</select>
            : <input className="jinp" value={f.value || ""} placeholder={f.ph || ""} onChange={f.onChange} />}
          {f.note ? <em className="jnote">{f.note}</em> : null}
        </div>
      ))}</div>
    </td></tr>
  );

  // ---- category editors (rendered inside the modal, one tab at a time) ----
  const renderPersonnel = () => (
    <>
      <div className="pgrid">
        <table className="tbl gtbl">
          <thead>
            <tr><th className="cat" rowSpan={2}>Position</th>{P.map((_, i) => <th key={i} colSpan={2} className="bpcol">BP{i + 1}</th>)}<th rowSpan={2} style={{ textAlign: "right" }}>Total</th><th rowSpan={2}></th></tr>
            <tr className="subhead">{P.map((_, i) => <React.Fragment key={i}><th className="bpcol">Hrs</th><th className="bpcol">$/hr</th></React.Fragment>)}</tr>
          </thead>
          <tbody>
            {C.personnel.map(l => { const tot = (l.byPeriod || []).reduce((a, b) => a + ((b?.hrs || 0) * (b?.rate || 0)), 0); return (
              <React.Fragment key={l.id}>
              <tr>
                <td><input className="inp" style={{ width: 150, textAlign: "left" }} value={l.role} onChange={e => persField(l.id, { role: e.target.value })} /></td>
                {P.map((_, i) => <React.Fragment key={i}>
                  <td className="amt"><input className="inp sm" type="number" value={l.byPeriod?.[i]?.hrs ?? 0} onChange={e => persEdit(l.id, i, { hrs: +e.target.value })} /></td>
                  <td className="amt"><input className={"inp sm" + (isAuto(l) ? " autoval" : "")} type="number" title={isAuto(l) ? "Auto from payroll — type to override" : undefined} value={l.byPeriod?.[i]?.rate ?? 0} onChange={e => persRate(l.id, i, +e.target.value)} /></td>
                </React.Fragment>)}
                <td className="amt num">{moneyFull(tot)}</td>
                <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delPers(l.id)}>{I.trash}</button></td>
              </tr>
              {jSubRow(n * 2 + 3, [
                { label: "Charged to", value: l.employeeId || "", onChange: e => persField(l.id, { employeeId: e.target.value || null, rateAuto: !!e.target.value }),
                  note: payrollNote(l), options: <>
                    <option value="">— not on payroll (sub / new hire)</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name} · {empTitleAt(e, P[0]?.start ?? 0)}</option>)}
                    {l.employeeId && !employees.some(e => e.id === l.employeeId) && <option value={l.employeeId}>(unknown — relink)</option>}
                  </> },
                { label: "Rate basis / source", value: l.basis, ph: "e.g. institutional salary schedule + 3% annual escalation", wide: true, onChange: e => persField(l.id, { basis: e.target.value }) },
              ])}
              </React.Fragment>); })}
            {C.personnel.length === 0 && <tr><td colSpan={2 + n * 2 + 1} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No positions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <button className="addbtn ghost" style={{ marginTop: 10 }} onClick={addPers}>{I.plus} Add position</button>
      <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 10 }}>Direct personnel compensation = hours × hourly rate per budget period. List by position title (subrecipient/contractor labor belongs under f. Contractual).</div>
    </>
  );
  const renderFringe = () => (
    <>
      <div className="pgrid">
        <table className="tbl gtbl"><thead><tr><th className="cat">Applied to personnel</th>{P.map((_, i) => bpHead("BP" + (i + 1) + " rate"))}<th style={{ textAlign: "right" }}>Total</th></tr></thead>
          <tbody>
            <tr><td style={{ color: "var(--muted)", fontSize: 12 }}>Fringe rate × personnel</td>{P.map((_, i) => <td key={i} className="amt"><input className="inp sm" type="number" step="0.01" value={C.fringe.byPeriod?.[i] ?? 0} onChange={e => fringeEdit(i, +e.target.value)} /></td>)}<td className="amt num">{moneyFull(R.grand.fringe)}</td></tr>
            <tr className="subhead"><td className="cat" style={{ textTransform: "none", letterSpacing: 0, color: "var(--muted)" }}>= Fringe $</td>{P.map((_, i) => <td key={i} className="amt num" style={{ color: "var(--muted)" }}>{moneyFull(R.per[i].fringe)}</td>)}<td></td></tr>
          </tbody></table>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 10 }}>Rate is a fraction (0.30 = 30%), applied to each period's total personnel. A federally approved rate agreement is required at award if reimbursement is requested.</div>
    </>
  );
  const renderTravel = () => (
    <>
      <div className="pgrid">
        <table className="tbl gtbl"><thead><tr><th className="cat">Purpose</th><th>BP</th><th className="bpcol">Days</th><th className="bpcol">Trav.</th><th className="bpcol">Lodging</th><th className="bpcol">Flight</th><th className="bpcol">Vehicle</th><th className="bpcol">Per diem</th><th style={{ textAlign: "right" }}>Trip cost</th><th></th></tr></thead>
          <tbody>
            {C.travel.map(t => (
              <React.Fragment key={t.id}>
              <tr>
                <td><input className="inp" style={{ width: 150, textAlign: "left" }} value={t.purpose} onChange={e => tripEdit(t.id, { purpose: e.target.value })} /></td>
                <td><select className="sel" value={t.period} onChange={e => tripEdit(t.id, { period: +e.target.value })}>{P.map((_, i) => <option key={i} value={i}>BP{i + 1}</option>)}</select></td>
                <td className="amt"><input className="inp sm" type="number" value={t.days} onChange={e => tripEdit(t.id, { days: +e.target.value })} /></td>
                <td className="amt"><input className="inp sm" type="number" value={t.travelers} onChange={e => tripEdit(t.id, { travelers: +e.target.value })} /></td>
                <td className="amt"><input className="inp sm" type="number" value={t.lodging} onChange={e => tripEdit(t.id, { lodging: +e.target.value })} /></td>
                <td className="amt"><input className="inp sm" type="number" value={t.flight} onChange={e => tripEdit(t.id, { flight: +e.target.value })} /></td>
                <td className="amt"><input className="inp sm" type="number" value={t.vehicle} onChange={e => tripEdit(t.id, { vehicle: +e.target.value })} /></td>
                <td className="amt"><input className="inp sm" type="number" value={t.perDiem} onChange={e => tripEdit(t.id, { perDiem: +e.target.value })} /></td>
                <td className="amt num">{moneyFull(tripCost(t))}</td>
                <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delTrip(t.id)}>{I.trash}</button></td>
              </tr>
              {jSubRow(10, [
                { label: "Depart from", value: t.departFrom, ph: "City, ST", onChange: e => tripEdit(t.id, { departFrom: e.target.value }) },
                { label: "Destination", value: t.destination, ph: "City, ST", onChange: e => tripEdit(t.id, { destination: e.target.value }) },
                { label: "Basis for estimating cost", value: t.basis, ph: "e.g. current GSA per-diem & airfare rates", wide: true, onChange: e => tripEdit(t.id, { basis: e.target.value }) },
              ])}
              </React.Fragment>))}
            {C.travel.length === 0 && <tr><td colSpan={10} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No trips yet.</td></tr>}
          </tbody></table>
      </div>
      <button className="addbtn ghost" style={{ marginTop: 10 }} onClick={addTrip}>{I.plus} Add trip</button>
      <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 10 }}>Trip cost = travelers × (flight + vehicle + days × (lodging + per diem)).</div>
    </>
  );
  const renderQty = (key, addLabel) => (
    <>
      <div className="pgrid">
        <table className="tbl gtbl"><thead><tr><th className="cat">Item</th><th>BP</th><th className="bpcol">Qty</th><th className="bpcol">Unit cost</th><th style={{ textAlign: "right" }}>Total</th><th></th></tr></thead>
          <tbody>
            {C[key].map(x => (
              <React.Fragment key={x.id}>
              <tr>
                <td><input className="inp" style={{ width: 170, textAlign: "left" }} value={x.item} onChange={e => qtyEdit(key, x.id, { item: e.target.value })} /></td>
                <td><select className="sel" value={x.period} onChange={e => qtyEdit(key, x.id, { period: +e.target.value })}>{P.map((_, i) => <option key={i} value={i}>BP{i + 1}</option>)}</select></td>
                <td className="amt"><input className="inp sm" type="number" value={x.qty} onChange={e => qtyEdit(key, x.id, { qty: +e.target.value })} /></td>
                <td className="amt"><input className="inp" type="number" value={x.unitCost} onChange={e => qtyEdit(key, x.id, { unitCost: +e.target.value })} /></td>
                <td className="amt num">{moneyFull((x.qty || 0) * (x.unitCost || 0))}</td>
                <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delQty(key, x.id)}>{I.trash}</button></td>
              </tr>
              {jSubRow(6, [
                { label: "Basis of cost", value: x.basis, ph: "e.g. vendor quote, catalog price, historical usage", onChange: e => qtyEdit(key, x.id, { basis: e.target.value }) },
                { label: "Justification of need", value: x.justification, ph: "how the project requires it", wide: true, onChange: e => qtyEdit(key, x.id, { justification: e.target.value }) },
              ])}
              </React.Fragment>))}
            {C[key].length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No items yet.</td></tr>}
          </tbody></table>
      </div>
      <button className="addbtn ghost" style={{ marginTop: 10 }} onClick={() => addQty(key, addLabel)}>{I.plus} Add item</button>
      {key === "equipment" && <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 10 }}>Equipment is generally tangible property with a useful life &gt; 1 year and a per-unit cost at or above the capitalization threshold (commonly $5,000).</div>}
    </>
  );
  const renderPA = (key, field, colLabel, note, jfields) => (
    <>
      <div className="pgrid">
        <table className="tbl gtbl"><thead><tr><th className="cat">{colLabel}</th>{P.map((_, i) => bpHead("BP" + (i + 1)))}<th style={{ textAlign: "right" }}>Total</th><th></th></tr></thead>
          <tbody>
            {C[key].map(l => { const tot = (l.byPeriod || []).reduce((a, b) => a + (b || 0), 0); return (
              <React.Fragment key={l.id}>
              <tr>
                <td><input className="inp" style={{ width: 200, textAlign: "left" }} value={l[field]} onChange={e => paEdit(key, l.id, { [field]: e.target.value })} /></td>
                {P.map((_, i) => <td key={i} className="amt"><input className="inp" type="number" value={l.byPeriod?.[i] ?? 0} onChange={e => paPeriod(key, l.id, i, +e.target.value)} /></td>)}
                <td className="amt num">{moneyFull(tot)}</td>
                <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delPA(key, l.id)}>{I.trash}</button></td>
              </tr>
              {jfields && jfields.length ? jSubRow(n + 3, jfields.map(jf => ({ label: jf.label, value: l[jf.k], ph: jf.ph, wide: jf.wide, onChange: e => paEdit(key, l.id, { [jf.k]: e.target.value }) }))) : null}
              </React.Fragment>); })}
            {C[key].length === 0 && <tr><td colSpan={n + 3} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>Nothing here yet.</td></tr>}
          </tbody></table>
      </div>
      <button className="addbtn ghost" style={{ marginTop: 10 }} onClick={() => addPA(key, field, "New line")}>{I.plus} Add line</button>
      {note && <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 10 }}>{note}</div>}
    </>
  );
  const renderIndirect = () => (
    <>
      <button className={"gtoggle " + (!C.indirect.incremental ? "on" : "")} style={{ marginBottom: 12 }}
        onClick={() => setCat("indirect", { ...C.indirect, incremental: !C.indirect.incremental })}>
        <span className="dot" />{!C.indirect.incremental
          ? "Recovers existing overhead — already in your operating costs, so it isn’t new cash"
          : "New overhead this grant adds — draws cash"}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted-2)", fontWeight: 600 }}>Applied to base</span>
        <select className="sel" value={C.indirect.base} onChange={e => setCat("indirect", { ...C.indirect, base: e.target.value })}>
          <option value="total_direct">Total direct costs</option>
          <option value="personnel_fringe">Personnel + fringe</option>
          <option value="mtdc">MTDC (direct − equipment)</option>
        </select>
      </div>
      <div className="pgrid">
        <table className="tbl gtbl"><thead><tr><th className="cat">Rate</th>{P.map((_, i) => bpHead("BP" + (i + 1)))}<th></th></tr></thead>
          <tbody>
            {C.indirect.rates.map(r => (
              <tr key={r.id}>
                <td><input className="inp" style={{ width: 170, textAlign: "left" }} value={r.label} onChange={e => rateEdit(r.id, { label: e.target.value })} /></td>
                {P.map((_, i) => <td key={i} className="amt"><input className="inp sm" type="number" step="0.01" value={r.byPeriod?.[i] ?? 0} onChange={e => ratePeriod(r.id, i, +e.target.value)} /></td>)}
                <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delRate(r.id)}>{I.trash}</button></td>
              </tr>))}
            {C.indirect.rates.length === 0 && <tr><td colSpan={n + 2} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No indirect rates yet.</td></tr>}
            <tr className="subhead"><td className="cat" style={{ textTransform: "none", letterSpacing: 0, color: "var(--muted)" }}>= Indirect $</td>{P.map((_, i) => <td key={i} className="amt num" style={{ color: "var(--muted)" }}>{moneyFull(R.per[i].indirect)}</td>)}<td></td></tr>
          </tbody></table>
      </div>
      <button className="addbtn ghost" style={{ marginTop: 10 }} onClick={addRate}>{I.plus} Add rate</button>
      <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 10 }}>Rates are fractions (0.45 = 45%), applied per period to the selected base. Don't average multiple rates into one — list each.</div>
    </>
  );

  const CATS = [
    { k: "personnel", t: "a. Personnel", tot: R.grand.personnel, render: renderPersonnel },
    { k: "fringe", t: "b. Fringe benefits", tot: R.grand.fringe, render: renderFringe },
    { k: "travel", t: "c. Travel", tot: R.grand.travel, render: renderTravel },
    { k: "equipment", t: "d. Equipment", tot: R.grand.equipment, render: () => renderQty("equipment", "Equipment item") },
    { k: "supplies", t: "e. Supplies", tot: R.grand.supplies, render: () => renderQty("supplies", "Supply item") },
    { k: "contractual", t: "f. Contractual", tot: R.grand.contractual, render: () => renderPA("contractual", "name", "Subrecipient / contractor", "All subrecipient, contractor, and FFRDC costs go here.", [{ label: "Purpose & basis of cost", k: "purpose", ph: "scope of work and how the cost was estimated", wide: true }]) },
    { k: "construction", t: "g. Construction", tot: R.grand.construction, render: () => renderPA("construction", "desc", "Description", null, [{ label: "Basis of cost", k: "basis", ph: "e.g. engineering estimate" }, { label: "Justification of need", k: "justification", ph: "why the project requires it", wide: true }]) },
    { k: "other", t: "h. Other", tot: R.grand.other, render: () => renderPA("other", "desc", "Description", "Other direct costs not captured above (e.g. publication, data management).", [{ label: "Basis of cost", k: "basis", ph: "how the cost was estimated" }, { label: "Justification of need", k: "justification", ph: "why the project requires it", wide: true }]) },
    { k: "indirect", t: "i. Indirect", tot: R.grand.indirect, render: renderIndirect },
  ];
  const catList = [["a. Personnel", "personnel"], ["b. Fringe benefits", "fringe"], ["c. Travel", "travel"], ["d. Equipment", "equipment"], ["e. Supplies", "supplies"], ["f. Contractual", "contractual"], ["g. Construction", "construction"], ["h. Other", "other"]];
  const active = CATS.find(c => c.k === tab) || CATS[0];

  return (
    <>
      <div className="fieldlab" style={{ marginBottom: 8 }}>Budget periods</div>
      <div className="periods">
        {P.map((pp, i) => {
          // The lag is only real if you can see it act. Arrears pays after the period closes, advance
          // at the start, monthly as each month is invoiced — all of them lag by the agency's cycle.
          const lag = g.reimburseLagMonths || 0, t = g.reimburseTiming || "arrears";
          const paysAt = t === "advance" ? pp.start + lag : t === "monthly" ? pp.start + lag : pp.end + lag;
          const when = t === "monthly" ? `cash monthly from ${monthLabel(START_Y, START_M, paysAt)}` : `cash ${monthLabel(START_Y, START_M, paysAt)}`;
          const why = `${TIMING_LABEL[t] || t}${lag ? ` · ${lag} month${lag !== 1 ? "s" : ""} after ${t === "advance" ? "the period opens" : t === "monthly" ? "each month is invoiced" : "the period closes"}` : " · no payment lag"}`;
          return (
            <div className="periodchip" key={pp.id}>
              <span className="pl">BP{i + 1}</span>
              <select className="sel" value={pp.start} onChange={e => setPeriod(i, { start: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
              <span style={{ color: "var(--muted-2)" }}>→</span>
              <select className="sel" value={pp.end} onChange={e => setPeriod(i, { end: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
              {!isMsBilled(g) && !g.assumeFunded && <span className="paysat" title={why}>{when}</span>}
              {n > 1 && <button className="iconbtn" onClick={() => delPeriod(i)} aria-label="Remove period">{I.trash}</button>}
            </div>
          );
        })}
        <button className="addbtn ghost" onClick={addPeriod}>{I.plus} Budget period</button>
      </div>

      {/* Section B rollup — click the header to edit categories */}
      <div className="sfwrap">
        <button className="sfcap sfcap-btn" onClick={() => setCatOpen(true)} title="Edit budget categories">
          <span>SF-424A · Section B — Budget Categories</span>
          <span className="sfcap-edit">{I.edit} Edit categories</span>
        </button>
        <div className="pgrid">
          <table className="sf"><thead><tr><th className="cat">Object class category</th>{P.map((_, i) => <th key={i}>BP{i + 1}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {catList.map(([label, key]) => (
                <tr key={key}><td className="cat">{label}</td>{P.map((_, i) => <td key={i}>{moneyFull(R.per[i][key])}</td>)}<td>{moneyFull(R.grand[key])}</td></tr>
              ))}
              <tr className="sub"><td className="cat">Total direct (a–h)</td>{P.map((_, i) => <td key={i}>{moneyFull(R.per[i].direct)}</td>)}<td>{moneyFull(R.grand.direct)}</td></tr>
              <tr><td className="cat">j. Indirect charges</td>{P.map((_, i) => <td key={i}>{moneyFull(R.per[i].indirect)}</td>)}<td>{moneyFull(R.grand.indirect)}</td></tr>
              <tr className="tot"><td className="cat">Total project cost</td>{P.map((_, i) => <td key={i}>{moneyFull(R.per[i].total)}</td>)}<td>{moneyFull(R.grand.total)}</td></tr>
              <tr className="fed"><td className="cat">Federal share (funder)</td>{P.map((_, i) => <td key={i}>{moneyFull(R.per[i].federal)}</td>)}<td>{moneyFull(R.grand.federal)}</td></tr>
              <tr className="cs"><td className="cat">Non-federal cost-share</td>{P.map((_, i) => <td key={i}>{moneyFull(R.per[i].costShare)}</td>)}<td>{moneyFull(R.grand.costShare)}</td></tr>
            </tbody></table>
        </div>
      </div>

      {catOpen && (
        <div className="modal-overlay" onClick={() => setCatOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <div className="modal-title">{p.name} — Budget categories</div>
                <div className="modal-sub">{g.funder} · SF-424A object-class detail · {n} budget period{n > 1 ? "s" : ""}</div>
              </div>
              <button className="modal-x" onClick={() => setCatOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-tabs">
              {CATS.map(c => (
                <button key={c.k} className={"mtab " + (tab === c.k ? "on" : "")} onClick={() => setTab(c.k)}>
                  {c.t}<span className="mtab-tot">{moneyFull(c.tot)}</span>
                </button>
              ))}
            </div>
            <div className="modal-body">{active.render()}</div>
            <div className="modal-foot">
              <span className="num" style={{ fontSize: 12.5, color: "var(--muted)" }}>Total direct <b style={{ color: "var(--ink)" }}>{moneyFull(R.grand.direct)}</b> · indirect <b style={{ color: "var(--ink)" }}>{moneyFull(R.grand.indirect)}</b> · total <b style={{ color: "var(--ink)" }}>{moneyFull(R.grand.total)}</b></span>
              <button className="addbtn" onClick={() => setCatOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---- (PeriodGrant removed: reimbursement controls now live in GrantCard, since
       "milestone" is just another reimbursement type rather than a separate model) ---- */



/* ---- per-project actuals override: redistribute coded spend WITHIN a project ----
   Coded spend is the source of truth. This lets you move it between months (a milestone that billed
   to a different period than it landed) without changing the total — and it shouts if you do change
   the total, because that's no longer redistribution. */
function ProjectChartWrap({ p }) {
  const { hist, codeMap, customerMap } = useActualsCtx();
  return <ProjectChart project={p} hist={hist} maps={{ codeMap, customerMap }} />;
}

function CostShareWrap({ p }) {
  const { hist, codeMap, customerMap } = useActualsCtx();
  return <CostSharePanel project={p} hist={hist} maps={{ codeMap, customerMap }} />;
}

function ActualsOverride({ p }) {
  const { START_Y, START_M } = useStart();
  const { setProjects, hist, codeMap, customerMap } = useActualsCtx();
  const maps = { codeMap, customerMap };
  const coded = codedActuals(p.id, hist, maps);
  const months = [...new Set([...Object.keys(coded), ...Object.keys(p.actualsOverride || {})].map(Number))].sort((a, b) => a - b);
  const eff = effectiveActuals(p, hist, maps);
  const setOv = (m, v) => setProjects(ps => ps.map(x => x.id === p.id ? { ...x, actualsOverride: { ...(x.actualsOverride || {}), [m]: v } } : x));
  const clearOv = (m) => setProjects(ps => ps.map(x => {
    if (x.id !== p.id) return x;
    const o = { ...(x.actualsOverride || {}) }; delete o[m];
    return { ...x, actualsOverride: Object.keys(o).length ? o : undefined };
  }));
  const clearAll = () => setProjects(ps => ps.map(x => x.id === p.id ? { ...x, actualsOverride: undefined } : x));

  const codedTotal = Object.values(coded).reduce((a, v) => a + v, 0);
  if (months.length === 0) return (
    <div className="ovnote">No coded spend for this project yet. Code ledger lines to it under <b>Spend history → Ledger</b> and it appears here, month by month.</div>
  );

  return (
    <div className="override">
      <div className="override-h">
        <div><b>Recorded spend</b><span>Coded from your ledger. Override a month to redistribute — the total should stay put.</span></div>
        {p.actualsOverride && <button className="linkbtn" onClick={clearAll}>Reset to coded</button>}
      </div>
      <table className="tbl compact">
        <thead><tr><th>Month</th><th style={{ textAlign: "right" }}>Coded</th><th style={{ textAlign: "right" }}>Recorded</th><th></th></tr></thead>
        <tbody>
          {months.map(m => {
            const c = coded[m] || 0;
            const ov = p.actualsOverride?.[m];
            const has = ov !== undefined;
            return (
              <tr key={m}>
                <td className="num" style={{ fontSize: 12 }}>{monthLabel(START_Y, START_M, m)}</td>
                <td className="amt num" style={{ color: "var(--muted)" }}>{moneyFull(c)}</td>
                <td className="amt">
                  <input className="inp" type="number" value={has ? ov : c}
                    style={has ? { borderColor: "var(--caution)" } : null}
                    onChange={e => setOv(m, +e.target.value)} />
                </td>
                <td style={{ textAlign: "right" }}>{has && <button className="iconbtn" onClick={() => clearOv(m)} title="Back to coded" aria-label="Reset month">{I.swap || "×"}</button>}</td>
              </tr>
            );
          })}
          <tr className="totrow">
            <td>Total</td>
            <td className="amt num" style={{ color: "var(--muted)" }}>{moneyFull(codedTotal)}</td>
            <td className="amt num" style={eff.flagged ? { color: "var(--caution)" } : null}>{moneyFull(eff.effTotal ?? codedTotal)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      {eff.flagged && (
        <div className="ovflag">
          Your override totals <b className="num">{moneyFull(eff.effTotal)}</b> against <b className="num">{moneyFull(codedTotal)}</b> coded — a difference of <b className="num">{moneyFull(Math.abs(eff.delta))}</b>. That's not redistribution, it's a changed total. Fine if you mean it (spend your books haven't coded yet), but the project now disagrees with the ledger.
        </div>
      )}
    </div>
  );
}

/* ---- collapsed header: type · name · who · a type-shaped financial line ---- */
const TYPE_TAG = {
  internal: ["Internal", "var(--ink-3)"],
  grant: ["Grant", "var(--signal-ink)"],
  fulfillment: ["PO fulfillment", "var(--ink-2)"],
  proposal: ["Proposal", "var(--caution)"],
};
const BUDGET_TAG = {
  over: ["over budget", "var(--danger)", "rgba(188,59,42,.1)"],
  "at-risk": ["at risk", "var(--caution)", "rgba(201,130,27,.1)"],
  "on-budget": ["on budget", "var(--signal-ink)", "rgba(16,135,107,.1)"],
  none: null,
};

function BudgetChip({ tag }) {
  const t = BUDGET_TAG[tag];
  if (!t) return null;
  return <span className="schip" style={{ color: t[1], background: t[2] }}>{t[0]}</span>;
}
const F = ({ label, children, accent }) => (
  <div className="csum-f"><span className="csum-l">{label}</span><span className="csum-v" style={accent ? { color: accent } : null}>{children}</span></div>
);

function CollapsedProject({ p, pos, hist, codeMap, customerMap, onExpand }) {
  const maps = { codeMap, customerMap };
  const { START_Y, START_M } = useStart();
  const s = projectSummary(p, pos, hist, maps);
  const [tlabel, tcolor] = TYPE_TAG[s.type] || TYPE_TAG.internal;
  const ml = (m) => monthLabel(START_Y, START_M, m);

  return (
    <div className="collapsed" onClick={onExpand} role="button" tabIndex={0}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && onExpand()}>
      <button className="projfold" title="Expand">{I.chevDown || "+"}</button>
      <div className="csum-head">
        <span className="ttag" style={{ background: tcolor }}>{tlabel}</span>
        <span className="csum-name">{s.name}</span>
        {s.who && <span className="csum-who">{s.who}</span>}
        <div style={{ flex: 1 }} />
        <BudgetChip tag={s.tag} />
        {s.actualsFlagged && <span className="schip" style={{ color: "var(--caution)", background: "rgba(201,130,27,.1)" }} title="A manual override changes this project's total spend, not just its distribution">override ≠ coded</span>}
      </div>

      <div className="csum-fin">
        {s.type === "internal" && <>
          <F label="Budget">{moneyFull(s.budget)}</F>
          <F label="Spend" accent={s.spent > s.budget ? "var(--danger)" : undefined}>{s.spent > 0 ? moneyFull(s.spent) : "—"}</F>
          <F label="Timeline">{ml(s.start)} → {ml(s.end)}</F>
        </>}

        {s.kind === "grant" && s.type === "grant" && <>
          <F label="Total budget">{moneyFull(s.total)}</F>
          <F label="Funder / cost-share">{money(s.federal)} / {money(s.costShare)}</F>
          <F label="Reimbursement">
            {s.isMilestone
              ? <>{s.milestonesDone}/{s.milestonesTotal} milestones{s.nextDue ? <> · next {ml(s.nextDue.month)}</> : ""}</>
              : (s.billing === "arrears" ? "In arrears" : s.billing === "advance" ? "Advance" : "Monthly")}
          </F>
          <F label="Cash in / cost to date">{s.cashIn > 0 ? money(s.cashIn) : "—"} / {s.costToDate > 0 ? money(s.costToDate) : "—"}</F>
        </>}

        {s.type === "fulfillment" && <>
          <F label="Order value">{moneyFull(s.orderValue)}</F>
          <F label="Cost to fulfil">{moneyFull(s.costToFulfil)}</F>
          <F label="Margin" accent={s.margin < 0 ? "var(--danger)" : "var(--signal-ink)"}>{moneyFull(s.margin)} · {(s.marginPct * 100).toFixed(0)}%</F>
          <F label="Cost to date">{s.costToDate > 0 ? moneyFull(s.costToDate) : "—"}</F>
        </>}

        {s.type === "proposal" && <>
          <F label="Type">{s.kind === "grant" ? "Grant" : "Internal"}</F>
          <F label="Total budget">{moneyFull(s.total)}</F>
          <F label="Funder / cost-share">{money(s.federal)} / {money(s.costShare)}</F>
          {s.isMilestone
            ? <F label="Reimbursement">{s.milestonesDone}/{s.milestonesTotal} milestones{s.nextDue ? <> · next {ml(s.nextDue.month)}</> : ""}</F>
            : <F label="Decision">{s.decisionMonth != null ? ml(s.decisionMonth) : "—"}</F>}
        </>}
      </div>
    </div>
  );
}
