// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useState } from "react";
import { money, moneyFull } from "../engine/money";
import { TIERS, lineSpan } from "../engine/projection";
import { BINDING, FLEX, poBeyondHorizon, poDeposit, poDevNeeded, poNeedsReview, poPaidMonth, targetStatus, targetText } from "../engine/sales";
import { HORIZON, monthLabel, uid } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { Projects } from "./Projects";
import { MOPTS, statusChipOf } from "./chrome/bits";
import { I } from "./chrome/icons";
import { POModal } from "./chrome/modals";

export function Sales({ pos, setPos, projects, addPO, delPO, decideDev }) {
  const { START_Y, START_M } = useStart();
  const [tab, setTab] = useState("summary");
  const [adding, setAdding] = useState(false);
  const up = (id, patch) => setPos(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));

  const cycleConf = (p) => up(p.id, { confidence: TIERS[(TIERS.indexOf(p.confidence) + 1) % TIERS.length] });
  const upT = (pid, tid, patch) => up(pid, { targets: (pos.find(p => p.id === pid).targets || []).map(t => t.id === tid ? { ...t, ...patch } : t) });
  const delT = (pid, tid) => up(pid, { targets: (pos.find(p => p.id === pid).targets || []).filter(t => t.id !== tid) });
  const addT = (pid) => up(pid, { targets: [...(pos.find(p => p.id === pid).targets || []), { id: uid(), metric: "New target", dir: "above", target: 0, units: "", flex: "showstopper", current: null }] });

  const projOf = (p) => projects.find(x => x.id === p.projectId);
  const booked = pos.filter(p => p.confidence === "committed");
  const bookedValue = booked.reduce((a, p) => a + (p.amount || 0), 0);
  const pipeline = pos.filter(p => p.confidence !== "committed").reduce((a, p) => a + (p.amount || 0), 0);
  const deposits = pos.reduce((a, p) => a + poDeposit(p), 0);
  const allTargets = pos.flatMap(p => (p.targets || []).map(t => ({ ...t, po: p })));
  const atRisk = allTargets.filter(t => targetStatus(t) === "missed");
  const unfulfilled = pos.filter(p => !projOf(p));
  const devPOs = pos.filter(poDevNeeded);
  const reviews = pos.filter(poNeedsReview);
  const beyond = pos.filter(poBeyondHorizon);
  const beyondCash = beyond.reduce((a, p) => a + ((p.amount || 0) - poDeposit(p)), 0);

  const statusChip = statusChipOf;
  const poMeta = (p) => <>{monthLabel(START_Y, START_M, p.deliveryMonth)} · net {p.termsDays} · paid {monthLabel(START_Y, START_M, poPaidMonth(p))}</>;

  const TABS = [["summary", "Summary", pos.length], ["orders", "Orders", pos.length], ["targets", "Targets", allTargets.length]];
  return (
    <>
      <div className="subtabs">
        {TABS.map(([k, label, n]) => (
          <button key={k} className={"subtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}<span className="cnt">{n}</span></button>
        ))}
      </div>

      {tab === "summary" && (<>
        <div className="stats">
          <div className="stat"><div className="accent" style={{ background: "var(--signal)" }} /><div className="lab">Booked</div><div className="big">{money(bookedValue)}</div><div className="meta">{booked.length} signed order{booked.length !== 1 ? "s" : ""}</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--caution)" }} /><div className="lab">Pipeline</div><div className="big">{money(pipeline)}</div><div className="meta">quoted, not yet signed</div></div>
          <div className="stat"><div className="lab">Deposits</div><div className="big">{money(deposits)}</div><div className="meta">cash up front on booking</div></div>
          <div className="stat hero"><div className="lab">Targets at risk</div><div className="big" style={{ color: atRisk.length ? "var(--caution)" : "#fff" }}>{atRisk.length}</div><div className="meta">of {allTargets.length} committed</div></div>
        </div>

        {unfulfilled.length > 0 && (
          <div className="callout" style={{ borderLeftColor: "var(--danger)", background: "rgba(188,59,42,.05)" }}>
            <b>{unfulfilled.length} order{unfulfilled.length !== 1 ? "s" : ""}</b> ({unfulfilled.map(p => p.po).join(", ")}) {unfulfilled.length !== 1 ? "have" : "has"} no fulfillment project — the revenue is in your runway but <b>the cost of delivering it isn't</b>. That flatters the projection.
          </div>
        )}
        {beyond.length > 0 && (
          <div className="callout" style={{ borderLeftColor: "var(--caution)", background: "rgba(201,130,27,.05)" }}>
            <b>{beyond.length} order{beyond.length !== 1 ? "s" : ""}</b> ({beyond.map(p => p.po).join(", ")}) {beyond.length !== 1 ? "are" : "is"} paid after the {HORIZON}-month horizon — <b className="num">{moneyFull(beyondCash)}</b> of booked revenue that lands past the end of this projection and is <b>not counted</b>. It isn’t lost; it’s later than the model runs. {beyond.map(p => `${p.po} pays ${monthLabel(START_Y, START_M, poPaidMonth(p))}`).join("; ")}.
          </div>
        )}
        {reviews.length > 0 && (
          <div className="callout" style={{ borderLeftColor: "var(--caution)", background: "rgba(201,130,27,.05)" }}>
            <b>{reviews.length} order{reviews.length !== 1 ? "s" : ""}</b> ({reviews.map(p => p.po).join(", ")}) {reviews.length !== 1 ? "are" : "is"} awaiting a target review, so {reviews.length !== 1 ? "their" : "its"} fulfillment project{reviews.length !== 1 ? "s sit" : " sits"} in <b>Projects → Proposals</b> with the scope unsettled. Decide under <b>Orders</b> and {reviews.length !== 1 ? "they move" : "it moves"} to approved.
          </div>
        )}

        <div className="panel">
          <div className="panel-h">
            <div><h3>Order book</h3><p>What you've sold, when it ships, and when the money actually arrives. Edit under <b>Orders</b>.</p></div>
            <span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>read-only</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Customer</th><th>PO</th><th style={{ textAlign: "right" }}>Value</th><th>Delivery · terms</th><th>Confidence</th><th>Fulfillment</th></tr></thead>
            <tbody>
              {pos.map(p => {
                const pr = projOf(p);
                return (
                  <React.Fragment key={p.id}>
                    <tr className="rorow">
                      <td style={{ fontWeight: 500 }}>{p.customer}</td>
                      <td className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{p.po}</td>
                      <td className="amt num" style={{ fontWeight: 600 }}>{moneyFull(p.amount)}</td>
                      <td className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{poMeta(p)}</td>
                      <td><span className={"conf " + p.confidence} style={{ cursor: "default" }}>{p.confidence}</span></td>
                      <td style={{ fontSize: 12 }}>{pr
                        ? <span style={{ color: "var(--signal-ink)" }}>{pr.name}</span>
                        : <span style={{ color: "var(--danger)" }}>not modeled</span>}{poDevNeeded(p) && <span className="devchip on" style={{ marginLeft: 6 }}>dev</span>}</td>
                    </tr>
                    {(p.targets || []).map(t => (
                      <tr className="emprow-sub" key={t.id}>
                        <td colSpan={6}>
                          <div className="subchange ro">
                            <span className="branch">└</span>{statusChip(targetStatus(t))}
                            <span className="subdesc">{t.metric} — <b>{t.target}</b></span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {pos.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      {tab === "orders" && (<>
        <div className="callout" style={{ borderLeftColor: "var(--signal)" }}>
          A deposit lands the month the order is booked; the balance lands on delivery plus payment terms. Confidence drives the Dashboard tiers, so a quote can be modeled without pretending it's signed. Turn on <b>Dev</b> where you have to build something new before you can ship.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
          <button className="addbtn ghost" onClick={() => setAdding(true)}>{I.plus} Purchase order</button>
        </div>
        <div className="panel">
          <table className="tbl">
            <thead><tr><th>Customer</th><th>PO #</th><th style={{ textAlign: "right" }}>Value</th><th>Booked</th><th>Deliver</th><th style={{ textAlign: "right" }}>Terms</th><th style={{ textAlign: "right" }}>Deposit</th><th>Confidence</th><th>Dev</th><th></th></tr></thead>
            <tbody>
              {pos.map(p => {
                const pr = projOf(p);
                const dev = poDevNeeded(p), review = poNeedsReview(p);
                const gaps = (p.targets || []).filter(t => targetStatus(t) === "missed" && BINDING.includes(t.flex || "showstopper"));
                const devSpend = (pr?.lines || []).filter(l => l.phase === "development").reduce((a, l) => a + lineSpan(l), 0);
                return (
                  <React.Fragment key={p.id}>
                  <tr>
                    <td><input className="inp" style={{ width: 140, textAlign: "left" }} value={p.customer} onChange={e => up(p.id, { customer: e.target.value })} /></td>
                    <td><input className="inp" style={{ width: 105, textAlign: "left" }} value={p.po} onChange={e => up(p.id, { po: e.target.value })} /></td>
                    <td className="amt"><input className="inp" type="number" value={p.amount} onChange={e => up(p.id, { amount: +e.target.value })} /></td>
                    <td><select className="sel" value={p.bookedMonth} onChange={e => up(p.id, { bookedMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></td>
                    <td><select className="sel" value={p.deliveryMonth} onChange={e => up(p.id, { deliveryMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></td>
                    <td className="amt"><input className="inp sm" type="number" value={p.termsDays} onChange={e => up(p.id, { termsDays: +e.target.value })} /></td>
                    <td className="amt"><input className="inp sm" type="number" value={Math.round((p.depositPct || 0) * 100)} onChange={e => up(p.id, { depositPct: Math.max(0, Math.min(100, +e.target.value)) / 100 })} /><span style={{ fontSize: 11, color: "var(--muted-2)", marginLeft: 3 }}>%</span></td>
                    <td><button className={"conf " + p.confidence} onClick={() => cycleConf(p)} title="Click to change confidence">{p.confidence}</button></td>
                    <td><span className={"devchip" + (dev ? " on" : "")} style={{ cursor: "default" }} title={dev ? (p.devDecision === "kickoff" ? "Kicked off by review" : "Auto-set: a target is at risk") : (p.devDecision === "circumvent" ? "Circumvented by review" : "No target gap")}>{dev ? "needed" : p.devDecision === "circumvent" ? "circumvented" : "none"}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {poBeyondHorizon(p) && <span className="devchip on" title={`Paid ${monthLabel(START_Y, START_M, poPaidMonth(p))} — past the ${HORIZON}-month horizon, so this revenue is not in the projection`}>past horizon</span>}
                      {pr
                        ? <span className="chip" style={{ background: "rgba(16,135,107,.12)", color: "var(--signal-ink)" }}>fulfillment ✓</span>
                        : <span className="chip" style={{ background: "rgba(188,59,42,.1)", color: "var(--danger)" }}>none</span>}
                      <button className="iconbtn" onClick={() => delPO(p.id)} aria-label="Delete order">{I.trash}</button>
                    </td>
                  </tr>
                  {review && (
                    <tr className="emprow-sub">
                      <td colSpan={10}>
                        <div className="review">
                          <span className="rvflag">Target review</span>
                          <span className="rvbody">
                            {gaps.map(t => <b key={t.id}>{t.metric} — {t.current}{t.units ? " " + t.units : ""} vs {targetText(t)}</b>).reduce((a, x, i) => i ? [...a, ", ", x] : [x], [])} {gaps.length > 1 ? "are" : "is"} off target, so development is on by default — adding <b className="num">{moneyFull(devSpend)}</b> of prototype and outside-test spend to <b>{pr ? pr.name : "the fulfillment project"}</b>.
                          </span>
                          <div style={{ flex: 1 }} />
                          <button className="rvbtn go" onClick={() => decideDev(p, "kickoff")}>Kick off dev</button>
                          <button className="rvbtn no" onClick={() => decideDev(p, "circumvent")}>Circumvent</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {p.devDecision && (
                    <tr className="emprow-sub">
                      <td colSpan={10}>
                        <div className="review decided">
                          <span className="rvflag done">{p.devDecision === "kickoff" ? "Dev kicked off" : "Gap circumvented"}</span>
                          <span className="rvbody">{p.devDecision === "kickoff"
                            ? <>Development is funded in <b>{pr ? pr.name : "the fulfillment project"}</b> — <b className="num">{moneyFull(devSpend)}</b> of prototype and outside-test spend.</>
                            : <>No development spend. The target gap is being closed another way — if that's wrong, the runway is flattered by whatever it would have cost.</>}</span>
                          <div style={{ flex: 1 }} />
                          <button className="rvbtn" onClick={() => decideDev(p, null)}>Re-open review</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {pos.length === 0 && <tr><td colSpan={10} style={{ color: "var(--muted-2)", textAlign: "center", padding: 18 }}>No orders yet — add one to book revenue.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      {tab === "targets" && (<>
        <div className="stats">
          <div className="stat"><div className="lab">Committed targets</div><div className="big">{allTargets.length}</div><div className="meta">across {pos.length} order{pos.length !== 1 ? "s" : ""}</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--caution)" }} /><div className="lab">At risk or missed</div><div className="big" style={{ color: atRisk.length ? "var(--caution)" : undefined }}>{atRisk.length}</div><div className="meta">need attention</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">Needing development</div><div className="big">{devPOs.length}</div><div className="meta">order{devPOs.length !== 1 ? "s" : ""} not shippable today</div></div>
        </div>
        <div className="callout" style={{ borderLeftColor: atRisk.length ? "var(--caution)" : "var(--signal)" }}>
          These are the specs you're contractually on the hook for. A missed target is a delivery slip, and a delivery slip moves the balance payment — which is why they belong next to the runway rather than in a spec doc.
        </div>
        {pos.map(p => (
          <div className="panel" key={p.id} style={{ marginBottom: 16 }}>
            <div className="panel-h">
              <div><h3>{p.customer} <span style={{ fontFamily: "var(--fm)", fontSize: 12, color: "var(--muted-2)", fontWeight: 400 }}>{p.po}</span></h3><p>Deliver {poMeta(p)}</p></div>
              <button className="addbtn ghost" onClick={() => addT(p.id)}>{I.plus} Target</button>
            </div>
            <table className="tbl">
              <thead><tr><th>Metric</th><th>Must be</th><th style={{ textAlign: "right" }}>Target</th><th>Units</th><th>Flexibility</th><th style={{ textAlign: "right" }}>Current</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(p.targets || []).map(t => {
                  const st = targetStatus(t), binds = BINDING.includes(t.flex || "showstopper");
                  return (
                    <tr key={t.id}>
                      <td><input className="inp" style={{ width: 170, textAlign: "left" }} value={t.metric} onChange={e => upT(p.id, t.id, { metric: e.target.value })} /></td>
                      <td><select className="sel" value={t.dir || "above"} onChange={e => upT(p.id, t.id, { dir: e.target.value })}><option value="above">At or above</option><option value="below">At or below</option></select></td>
                      <td className="amt"><input className="inp sm" type="number" step="any" value={t.target ?? ""} onChange={e => upT(p.id, t.id, { target: e.target.value === "" ? null : +e.target.value })} /></td>
                      <td><input className="inp" style={{ width: 110, textAlign: "left" }} value={t.units || ""} placeholder="kW, %, s…" onChange={e => upT(p.id, t.id, { units: e.target.value })} /></td>
                      <td><select className="sel" value={t.flex || "showstopper"} onChange={e => upT(p.id, t.id, { flex: e.target.value })}>{FLEX.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                      <td className="amt"><input className="inp sm" type="number" step="any" placeholder="untested" value={t.current ?? ""} onChange={e => upT(p.id, t.id, { current: e.target.value === "" ? null : +e.target.value })} /></td>
                      <td>{statusChip(st)}{st === "missed" && !binds && <span className="devchip" style={{ marginLeft: 5 }}>won’t block</span>}</td>
                      <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delT(p.id, t.id)} aria-label="Delete target">{I.trash}</button></td>
                    </tr>
                  );
                })}
                {(p.targets || []).length === 0 && <tr><td colSpan={8} style={{ color: "var(--muted-2)", textAlign: "center", padding: 16 }}>No performance targets recorded for this order.</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </>)}

      {adding && <POModal onClose={() => setAdding(false)} onSave={addPO} />}
    </>
  );
}
