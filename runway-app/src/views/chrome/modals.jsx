// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useState } from "react";
import { TIMING_LABEL, grantPaymentsAt } from "../../engine/grant";
import { moneyFull } from "../../engine/money";
import { BINDING, FLEX, poBeyondHorizon, poPaidMonth, targetStatus } from "../../engine/sales";
import { HORIZON, monthLabel, monthLong, uid } from "../../engine/time";
import { useStart } from "../../state/StartCtx";
import { Payroll } from "../Payroll";
import { MField, MOPTS, statusChipOf } from "./bits";
import { I } from "./icons";

/* ---- record actuals for a month (cash, revenue, grants-in, derived spend) ---- */
export function CashActualModal({ editMonth, defaultMonth, initial, projects, modelStarts, prevCashOf, onClose, onSave }) {
  const { START_Y, START_M } = useStart();
  const [month, setMonth] = useState(defaultMonth);
  const [cashV, setCashV] = useState(initial?.cash ?? Math.round(modelStarts[defaultMonth] ?? 0));
  const [revenue, setRevenue] = useState(initial?.revenue ?? 0);
  const [additional, setAdditional] = useState(initial?.additional ?? 0);
  const [grants, setGrants] = useState(initial?.grants ?? {});

  const payments = grantPaymentsAt(projects, month);
  const grantsTotal = payments.reduce((a, p) => a + (Number(grants[p.id]) || 0), 0);
  const prevCash = prevCashOf(month);
  const spend = (revenue || 0) + grantsTotal + (additional || 0) + (prevCash - (cashV || 0));
  const monthOpts = Array.from({ length: HORIZON + 1 }, (_, i) => <option key={i} value={i}>{monthLabel(START_Y, START_M, i)}</option>);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(540px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div><div className="modal-title">{editMonth != null ? "Edit actuals" : "Record actuals"}</div><div className="modal-sub">{monthLong(START_Y, START_M, month)}</div></div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <MField label="Month"><select className="sel" value={month} onChange={e => setMonth(+e.target.value)}>{monthOpts}</select></MField>
          <MField label="Actual cash on hand">
            <input className="inp" type="number" style={{ width: 150 }} value={cashV} onChange={e => setCashV(+e.target.value)} />
            <span className="fieldnote">prior month {moneyFull(prevCash)}</span>
          </MField>

          <div className="modal-sec">Income</div>
          <MField label="Revenue"><input className="inp" type="number" style={{ width: 150 }} value={revenue} onChange={e => setRevenue(+e.target.value)} /></MField>

          <div className="mfield">
            <label className="mlabel">Grant payments expected this month</label>
            <div className="gpays">
              {payments.length === 0 && <div className="fieldnote" style={{ padding: "2px 0" }}>No grant payments expected in {monthLabel(START_Y, START_M, month)}.</div>}
              {payments.map(p => {
                const received = grants[p.id] != null;
                const varc = (Number(grants[p.id]) || 0) - p.amount;
                return (
                  <div className="gpay" key={p.id}>
                    <div className="gp-top">
                      <span className="gp-name">{p.grant}</span>
                      <span className="gp-exp">expected {moneyFull(p.amount)}</span>
                      <button className={"recv " + (received ? "on" : "")} onClick={() => setGrants(g => { const n = { ...g }; if (received) delete n[p.id]; else n[p.id] = p.amount; return n; })}>{received ? "✓ Received" : "Pending"}</button>
                    </div>
                    {received && (
                      <div className="gp-bot">
                        <span className="gp-lbl">received</span>
                        <input className="inp gp-in" type="number" value={grants[p.id]} onChange={e => setGrants(g => ({ ...g, [p.id]: +e.target.value }))} />
                        {Math.abs(varc) > 0.5
                          ? <span className="gp-var" style={{ color: varc >= 0 ? "var(--signal-ink)" : "var(--danger)" }}>{varc >= 0 ? "+" : "−"}{moneyFull(Math.abs(varc))} vs expected</span>
                          : <span className="gp-var ok">✓ matches expected</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              {payments.length > 0 && <div className="gp-total">Grants received<b className="num">{moneyFull(grantsTotal)}</b></div>}
            </div>
          </div>

          <MField label="Additional income"><input className="inp" type="number" style={{ width: 150 }} value={additional} onChange={e => setAdditional(+e.target.value)} /></MField>

          <div className="spendcalc">
            <div className="sc-row"><span>Spend (calculated)</span><b className="num">{moneyFull(spend)}</b></div>
            <div className="sc-hint">revenue + grants + additional − cash change ({moneyFull(prevCash)} → {moneyFull(cashV || 0)})</div>
          </div>
        </div>
        <div className="modal-foot">
          <span />
          <div style={{ display: "flex", gap: 10 }}>
            <button className="addbtn ghost" onClick={onClose}>Cancel</button>
            <button className="addbtn" onClick={() => { onSave(month, { cash: cashV, revenue, additional, grants }); onClose(); }}>{editMonth != null ? "Save" : "Add month"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- new purchase order: order terms + the targets you're signing up to, in one place ---- */
export function POModal({ onClose, onSave }) {
  const { START_Y, START_M } = useStart();
  const [po, setPo] = useState({ customer: "", po: "", amount: 50000, confidence: "committed",
    bookedMonth: 0, deliveryMonth: 4, termsDays: 30, depositPct: 0 });
  const [targets, setTargets] = useState([{ id: uid(), metric: "", dir: "above", target: null, units: "", flex: "showstopper", current: null }]);
  const set = (patch) => setPo(p => ({ ...p, ...patch }));
  const upT = (id, patch) => setTargets(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));
  const delT = (id) => setTargets(ts => ts.filter(t => t.id !== id));
  const addT = () => setTargets(ts => [...ts, { id: uid(), metric: "", dir: "above", target: null, units: "", flex: "showstopper", current: null }]);

  const clean = targets.filter(t => t.metric.trim());
  const draft = { ...po, targets: clean };
  const binding = clean.filter(t => targetStatus(t) === "missed" && BINDING.includes(t.flex));
  const ok = po.customer.trim() && po.po.trim() && (+po.amount || 0) > 0;
  const dep = Math.round((+po.amount || 0) * (po.depositPct || 0));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(920px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div><div className="modal-title">New purchase order</div>
            <div className="modal-sub">Booking this creates its fulfillment project too — the cost of delivering it lands in the runway from the start.</div></div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="mgrid">
            <label className="fl">Customer<input className="inp" style={{ width: "100%", textAlign: "left" }} value={po.customer} placeholder="Northwind Energy" onChange={e => set({ customer: e.target.value })} /></label>
            <label className="fl">PO number<input className="inp" style={{ width: "100%", textAlign: "left" }} value={po.po} placeholder="PO-2026-0000" onChange={e => set({ po: e.target.value })} /></label>
            <label className="fl">Order value<input className="inp" type="number" value={po.amount} onChange={e => set({ amount: +e.target.value })} /></label>
            <label className="fl">Confidence<select className="sel" value={po.confidence} onChange={e => set({ confidence: e.target.value })}><option value="committed">Committed — signed</option><option value="expected">Expected</option><option value="speculative">Speculative — quoted</option></select></label>
            <label className="fl">Booked<select className="sel" value={po.bookedMonth} onChange={e => set({ bookedMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></label>
            <label className="fl">Delivery<select className="sel" value={po.deliveryMonth} onChange={e => set({ deliveryMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></label>
            <label className="fl">Terms (days)<input className="inp sm" type="number" value={po.termsDays} onChange={e => set({ termsDays: +e.target.value })} /></label>
            <label className="fl">Deposit %<input className="inp sm" type="number" value={Math.round((po.depositPct || 0) * 100)} onChange={e => set({ depositPct: Math.max(0, Math.min(100, +e.target.value)) / 100 })} /></label>
          </div>
          <div className="mnote">
            {dep > 0 ? <><b className="num">{moneyFull(dep)}</b> lands on booking, <b className="num">{moneyFull((+po.amount || 0) - dep)}</b> at </> : <>Full <b className="num">{moneyFull(+po.amount || 0)}</b> lands at </>}
            <b>{monthLabel(START_Y, START_M, poPaidMonth(draft))}</b> — delivery plus {po.termsDays} days.
            {poBeyondHorizon(draft) && <> That is past the {HORIZON}-month horizon, so the balance will <b>not appear</b> in the projection — the order is real, the model just doesn’t run that far.</>}
          </div>

          <div className="fieldlab" style={{ margin: "20px 0 8px" }}>Performance targets <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--muted-2)", fontWeight: 400 }}>· status is measured from the current value, not asserted</span></div>
          <table className="tbl compact">
            <thead><tr><th>Metric</th><th>Must be</th><th style={{ textAlign: "right" }}>Target</th><th>Units</th><th>Flexibility</th><th style={{ textAlign: "right" }}>Current</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {targets.map(t => (
                <tr key={t.id}>
                  <td><input className="inp" style={{ width: 150, textAlign: "left" }} value={t.metric} placeholder="Conversion efficiency" onChange={e => upT(t.id, { metric: e.target.value })} /></td>
                  <td><select className="sel" value={t.dir} onChange={e => upT(t.id, { dir: e.target.value })}><option value="above">At or above</option><option value="below">At or below</option></select></td>
                  <td className="amt"><input className="inp sm" type="number" step="any" value={t.target ?? ""} onChange={e => upT(t.id, { target: e.target.value === "" ? null : +e.target.value })} /></td>
                  <td><input className="inp" style={{ width: 92, textAlign: "left" }} value={t.units} placeholder="%" onChange={e => upT(t.id, { units: e.target.value })} /></td>
                  <td><select className="sel" value={t.flex} onChange={e => upT(t.id, { flex: e.target.value })}>{FLEX.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td className="amt"><input className="inp sm" type="number" step="any" placeholder="untested" value={t.current ?? ""} onChange={e => upT(t.id, { current: e.target.value === "" ? null : +e.target.value })} /></td>
                  <td>{t.metric.trim() ? statusChipOf(targetStatus(t)) : <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>}</td>
                  <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delT(t.id)} aria-label="Remove target">{I.trash}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="addbtn ghost" style={{ marginTop: 10 }} onClick={addT}>{I.plus} Target</button>

          <div className={"mnote" + (binding.length ? " warn" : "")} style={{ marginTop: 16 }}>
            {binding.length
              ? <>{binding.length} binding target{binding.length !== 1 ? "s" : ""} already missed — development will be switched on and this order will open flagged for review.</>
              : <>No binding target is missed, so no development spend. Fill in current values as you measure them; the moment a showstopper or soft target falls short, this order flags itself for review.</>}
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--fb)" }}>{clean.length} target{clean.length !== 1 ? "s" : ""} recorded</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="addbtn ghost" onClick={onClose}>Cancel</button>
            <button className="addbtn ghost" style={!ok ? { opacity: .4, pointerEvents: "none" } : null} onClick={() => { if (ok) { onSave(draft); onClose(); } }}>Book order</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- grant wrapper (external funding) ---- */
export function GrantIOModal({ p, g, R, setGrant, onClose }) {
  const [billing, setBilling] = useState(g.reimburseTiming || "arrears");
  const [msg, setMsg] = useState(null);
  // SheetJS and the SF-424A parser load on first use, not on page load. They are over half the
  // bundle and are needed only when someone actually touches a workbook.
  const sheets = () => Promise.all([import("xlsx"), import("../../engine/sf424a")]);
  const readWb = (file, cb) => sheets().then(([XLSX]) => { const reader = new FileReader(); reader.onload = (e) => { try { cb(XLSX.read(e.target.result, { type: "array" })); } catch (err) { setMsg({ ok: false, text: String(err.message || err) }); } }; reader.readAsArrayBuffer(file); });
  const onBudget = (e) => { const f = e.target.files[0]; if (!f) return; readWb(f, async (wb) => {
    const { importWorkbook } = await import("../../engine/sf424a");
    const { periods, categories, costSharePct, funder, reimburseTiming } = importWorkbook(wb);
    if (!periods.length) { setMsg({ ok: false, text: "No SF-424A budget tabs found in that workbook." }); return; }
    const nItems = Object.values(categories).reduce((a, c) => a + (Array.isArray(c) ? c.length : (c.rates ? c.rates.length : 0)), 0);
    // prefer terms recovered from the workbook (present when it came from our own export); otherwise the
    // UI billing selector. funder only set if the sheet carried it.
    const patch = { reimburseTiming: reimburseTiming || billing, periods, categories, costSharePct };
    if (funder) patch.funder = funder;
    setGrant(p.id, patch);
    setMsg({ ok: true, text: `Imported ${periods.length} budget period${periods.length !== 1 ? "s" : ""} and ${nItems} line item${nItems !== 1 ? "s" : ""} from the SF-424A tabs, reimbursed ${TIMING_LABEL[billing].toLowerCase()}.` });
  }); e.target.value = ""; };
  const onSchedule = (e) => { const f = e.target.files[0]; if (!f) return; readWb(f, async (wb) => {
    const [XLSX, { parseScheduleAoa }] = await sheets();
    const ms = parseScheduleAoa(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }));
    if (!ms.length) { setMsg({ ok: false, text: "No milestones found in that file." }); return; }
    setGrant(p.id, { milestones: ms, reimburseTiming: "milestone" });
    setMsg({ ok: true, text: `Imported ${ms.length} milestone${ms.length !== 1 ? "s" : ""}.` });
  }); e.target.value = ""; };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(580px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div><div className="modal-title">SF-424A · import / export</div><div className="modal-sub">{p.name} · {g.funder}</div></div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="modal-sec">Export</div>
          <div className="ioRow">
            <div><b>SF-424A budget justification</b><span>One tab per object-class category (Personnel, Fringe, Travel, Equipment, Supplies, Contractual, Construction, Other, Indirect) plus the Section B summary — line detail and justification text included.</span></div>
            <button className="addbtn ghost" onClick={async () => (await import("../../engine/sf424a")).exportBudget(p, g, R)}>{I.download} Budget .xlsx</button>
          </div>
          <div className="ioRow">
            <div><b>Milestone / award schedule</b><span>A separate file — payment on each milestone.</span></div>
            <button className="addbtn ghost" onClick={async () => (await import("../../engine/sf424a")).exportSchedule(p, g)}>{I.download} Schedule .xlsx</button>
          </div>

          <div className="modal-sec">Import</div>
          <div className="mfield">
            <label className="mlabel">Reimbursement — set here, on import</label>
            <select className="sel" value={billing} onChange={e => setBilling(e.target.value)} style={{ maxWidth: 260 }}>
              {["arrears", "monthly", "advance", "milestone"].map(k => <option key={k} value={k}>{TIMING_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="ioRow">
            <div><b>Import SF-424A budget</b><span>Detects the category tabs, reads every line item and its justification, and bills the result as {billing === "milestone" ? "milestone" : "budget-period"}. Works on a real DOE template (up to 3 budget periods).</span></div>
            <label className="addbtn ghost filebtn">{I.upload} Choose file<input type="file" accept=".xlsx,.xls" onChange={onBudget} style={{ display: "none" }} /></label>
          </div>
          {billing === "milestone" && (
            <div className="ioRow">
              <div><b>Import milestone schedule</b><span>Required for milestone billing — the award / payment schedule.</span></div>
              <label className="addbtn ghost filebtn">{I.upload} Choose file<input type="file" accept=".xlsx,.xls" onChange={onSchedule} style={{ display: "none" }} /></label>
            </div>
          )}
          {msg && <div className="callout" style={{ margin: "14px 0 0", borderLeftColor: msg.ok ? "var(--signal)" : "var(--danger)" }}>{msg.text}</div>}
        </div>
        <div className="modal-foot"><span /><button className="addbtn" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

export function PayrollActionModal({ emp, action, editId, initial, onClose, onSaveRaise, onSavePromo, onSaveTerminate }) {
  const { START_Y, START_M } = useStart();
  const editing = !!editId;
  const defMonth = Math.min(HORIZON, (emp.start || 0) + 6);
  const [month, setMonth] = useState(initial?.month ?? (action === "terminate" ? (emp.end ?? defMonth) : defMonth));
  const [mode, setMode] = useState(initial?.mode ?? "pct");
  const [value, setValue] = useState(initial != null && initial.value != null ? initial.value : (action === "raise" ? 5 : 0));
  const [repeat, setRepeat] = useState(!!(initial && initial.everyMonths > 0));
  const [everyMonths, setEveryMonths] = useState(initial && initial.everyMonths > 0 ? initial.everyMonths : 12);
  const [title, setTitle] = useState(action === "promote" ? (initial?.title ?? "") : (emp.title || ""));
  const heads = { raise: editing ? "Edit raise" : "Schedule a raise", promote: editing ? "Edit promotion" : "Schedule a promotion", terminate: editing ? "Edit end date" : "Set end date" };
  const monthOpts = Array.from({ length: HORIZON + 1 }, (_, i) => <option key={i} value={i}>{monthLabel(START_Y, START_M, i)}</option>);
  const save = () => {
    if (action === "raise") onSaveRaise({ month, mode, value: +value || 0, everyMonths: repeat ? (+everyMonths || 12) : 0 });
    else if (action === "promote") onSavePromo({ month, title: title || "Untitled" });
    else onSaveTerminate(month);
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(520px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div><div className="modal-title">{heads[action]}</div><div className="modal-sub">{emp.name}{emp.title ? " · " + emp.title : ""}</div></div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {action === "raise" && <>
            <MField label="Type">
              <div className="seg"><button className={mode === "pct" ? "on" : ""} onClick={() => setMode("pct")}>Increase %</button><button className={mode === "set" ? "on" : ""} onClick={() => setMode("set")}>Set to</button></div>
            </MField>
            <MField label={mode === "pct" ? "Percent increase" : "New " + (emp.basis === "annual" ? "annual salary" : "monthly cost")}>
              <input className="inp" type="number" style={{ width: 130 }} value={value} onChange={e => setValue(e.target.value)} />
              {mode === "pct" ? <span style={{ color: "var(--muted-2)" }}>%</span> : <span style={{ color: "var(--muted-2)", fontSize: 12 }}>{emp.basis === "annual" ? "/yr" : "/mo"}</span>}
            </MField>
            <MField label="First effective"><select className="sel" value={month} onChange={e => setMonth(+e.target.value)}>{monthOpts}</select></MField>
            <MField label="Schedule">
              <div className="seg"><button className={!repeat ? "on" : ""} onClick={() => setRepeat(false)}>One-time</button><button className={repeat ? "on" : ""} onClick={() => setRepeat(true)}>Repeat</button></div>
              {repeat && <span style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--muted)", fontSize: 13 }}>every <input className="inp sm" type="number" value={everyMonths} onChange={e => setEveryMonths(e.target.value)} /> months</span>}
            </MField>
          </>}
          {action === "promote" && <>
            <MField label="New job title"><input className="inp" style={{ width: 240, textAlign: "left" }} value={title} placeholder="e.g. Staff Engineer" onChange={e => setTitle(e.target.value)} /></MField>
            <MField label="Effective"><select className="sel" value={month} onChange={e => setMonth(+e.target.value)}>{monthOpts}</select></MField>
          </>}
          {action === "terminate" && <>
            <MField label="End date — last month on payroll"><select className="sel" value={month} onChange={e => setMonth(+e.target.value)}>{monthOpts}</select></MField>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)" }}>Payroll for {emp.name} stops after this month. Remove the termination line later to undo.</div>
          </>}
        </div>
        <div className="modal-foot">
          <span />
          <div style={{ display: "flex", gap: 10 }}>
            <button className="addbtn ghost" onClick={onClose}>Cancel</button>
            <button className="addbtn" onClick={save}>{editing ? "Save changes" : action === "terminate" ? "Set end date" : "Schedule"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
