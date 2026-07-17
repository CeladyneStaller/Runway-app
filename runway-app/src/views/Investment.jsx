// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React, { useState } from "react";
import { GOAL_KINDS, GOAL_STATUS, INST_KINDS, INST_KIND_LABEL, INST_STATUS, STATUS_LABEL, accrued, compileInstrument, convOwnership, convertsAt, covenantBreach, dilution, instConf, instLabel, isApprox, postMoney, royaltyVerdict } from "../engine/capital";
import { money, moneyFull } from "../engine/money";
import { lineSpan } from "../engine/projection";
import { HORIZON, dateShort, monthLabel, uid } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { MOPTS } from "./chrome/bits";
import { I } from "./chrome/icons";

export function Investment({ rounds, setRounds, zeroNoRaise, rowsNoRaise, rowsFin, rowsUp, zeroUp, toggles, setToggles }) {
  const { START_Y, START_M } = useStart();
  const [tab, setTab] = useState("summary");
  const up = (id, patch) => setRounds(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const del = (id) => setRounds(rs => rs.filter(r => r.id !== id));
  const add = (kind) => setRounds(rs => [...rs, kind === "debt"
    ? { id: uid(), kind, name: "New facility", status: "planning", amount: 1000000, closeMonth: 3, rateAPR: 12, termMonths: 36, ioMonths: 12, feesPct: 0.01, finalPct: 0.05, covenantCash: 0, confAuto: true, goals: [] }
    : kind === "equity"
    ? { id: uid(), kind, name: "New round", status: "planning", amount: 5000000, committedAmount: 0, preMoney: 20000000, closeMonth: 6, startMonth: 0, useOfFunds: "", leadName: "", confAuto: true, goals: [] }
    : { id: uid(), kind, name: kind === "safe" ? "New SAFE" : "New note", status: "planning", amount: 500000, closeMonth: 2, capType: "post", cap: 15000000, discount: 0.2, interestPct: kind === "note" ? 8 : 0, maturityMonths: 24, atMaturity: "repay", confAuto: true, goals: [] }]);
  const upG = (rid, gid, patch) => up(rid, { goals: (rounds.find(r => r.id === rid).goals || []).map(g => g.id === gid ? { ...g, ...patch } : g) });
  const delG = (rid, gid) => up(rid, { goals: (rounds.find(r => r.id === rid).goals || []).filter(g => g.id !== gid) });
  const addG = (rid) => up(rid, { goals: [...(rounds.find(r => r.id === rid).goals || []), { id: uid(), kind: "technical", label: "New goal", dueMonth: 4, status: "not-started" }] });

  const sorted = [...rounds].sort((a, b) => (a.closeMonth ?? 0) - (b.closeMonth ?? 0));
  const equity = sorted.filter(r => r.kind === "equity" && r.status !== "closed");
  const converting = sorted.filter(r => (r.kind === "safe" || r.kind === "note"));
  const debts = sorted.filter(r => r.kind === "debt" && r.status !== "closed");
  const allGoals = equity.flatMap(r => (r.goals || []).map(g => ({ ...g, round: r })));
  const slipping = allGoals.filter(g => g.status === "at-risk" || g.status === "not-started");
  const lateGoals = equity.flatMap(r => (r.goals || []).filter(g => (g.dueMonth ?? 0) > (r.closeMonth ?? 0)).map(g => ({ ...g, round: r })));
  const breaches = debts.map(d => ({ d, b: covenantBreach(d, rowsFin) })).filter(x => x.b);
  // Financing ON while every instrument sits behind a tier you've switched off is the worst kind of
  // control: one that appears to do nothing. Say so rather than let them think it's broken.
  const openInst = rounds.filter(r => r.status !== "closed");
  const gated = openInst.filter(r => !toggles[instConf(r)]);

  const gapOf = (r) => (zeroNoRaise?.t ?? Infinity) - (r.closeMonth ?? 0);
  const runwayAtStart = (r) => (zeroNoRaise?.t ?? Infinity) - (r.startMonth ?? 0);
  const chip = (st) => { const [lab, col, bg] = GOAL_STATUS[st] || GOAL_STATUS["not-started"]; return <span className="schip" style={{ background: bg, color: col }}>{lab}</span>; };

  const TABS = [["summary", "Summary", rounds.length], ["stack", "Capital stack", rounds.length], ["goals", "Goals", allGoals.length]];
  return (
    <>
      <div className="subtabs">
        {TABS.map(([k, label, n]) => (
          <button key={k} className={"subtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}<span className="cnt">{n}</span></button>
        ))}
      </div>

      <div className="callout" style={{ borderLeftColor: toggles.financing ? "var(--signal)" : "var(--line)", marginBottom: 14 }}>
        <b>Financing is its own switch.</b> {toggles.financing
          ? (gated.length > 0 && gated.length === openInst.length
            ? <>Financing is on, but every instrument here sits at a tier you have switched off, so none of it reaches the runway — {gated.map(r => `${r.name} is ${instConf(r)}`).join("; ")}. Turn that tier on, or move the instrument's status.</>
            : <>Financing is in the runway right now — draws, repayments and all.{gated.length > 0 && <> {gated.length} instrument{gated.length !== 1 ? "s are" : " is"} still held back by tier: {gated.map(r => r.name).join(", ")}.</>} Turn it off to see what the business does without the balance sheet.</>)
          : <>None of this is in the runway. A raise answers a different question from a customer order, so it does not ride the confidence tiers — switch it on and the balance sheet joins the projection.</>}
        <button className="rvbtn go" style={{ marginLeft: 10 }} onClick={() => setToggles(t => ({ ...t, financing: !t.financing }))}>{toggles.financing ? "Exclude financing" : "Include financing"}</button>
      </div>

      {tab === "summary" && (<>
        {breaches.map(({ d, b }) => (
          <div className="callout" key={d.id} style={{ borderLeftColor: "var(--danger)", background: "rgba(188,59,42,.06)", marginBottom: 12 }}>
            <b>{d.name} breaches its covenant in {monthLabel(START_Y, START_M, b.month)}.</b> The facility requires <b className="num">{moneyFull(b.floor)}</b> of minimum cash; you are projected to hold <b className="num">{moneyFull(b.cash)}</b>. At that point the lender can call the loan — <b className="num">{moneyFull(d.amount)}</b> due at once, against <b className="num">{moneyFull(b.cash)}</b> in the bank. Venture debt does not kill you with interest; it kills you with this.
          </div>
        ))}
        {equity.map(r => {
          const gap = gapOf(r), dead = gap < 0, start = runwayAtStart(r), thin = start < 9;
          const conv = converting.filter(x => convertsAt(x, rounds)?.id === r.id);
          const convOwn = conv.reduce((a, x) => a + convOwnership(x, r), 0);
          const newOwn = dilution(r);
          return (
            <React.Fragment key={r.id}>
              <div className="stats">
                <div className="stat"><div className="accent" style={{ background: "var(--ink-2)" }} /><div className="lab">{r.name} target</div><div className="big">{money(r.amount)}</div><div className="meta">{instLabel(r)} · {instConf(r)}</div></div>
                <div className="stat"><div className="lab">Post-money</div><div className="big">{money(postMoney(r))}</div><div className="meta">{(newOwn * 100).toFixed(1)}% for the new money</div></div>
                <div className="stat"><div className="accent" style={{ background: thin ? "var(--caution)" : "var(--signal)" }} /><div className="lab">Runway when you start</div><div className="big" style={{ color: thin ? "var(--caution)" : undefined }}>{start === Infinity ? "—" : `${start.toFixed(1)} mo`}</div><div className="meta">at {monthLabel(START_Y, START_M, r.startMonth)}</div></div>
                <div className="stat hero"><div className="lab">Margin at close</div><div className="big" style={{ color: dead ? "var(--danger)" : "var(--signal-2)" }}>{gap === Infinity ? "—" : `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)} mo`}</div><div className="meta">vs {monthLabel(START_Y, START_M, r.closeMonth)} close</div></div>
              </div>

              {dead ? (
                <div className="callout" style={{ borderLeftColor: "var(--danger)", background: "rgba(188,59,42,.06)" }}>
                  <b>You run out of cash {Math.abs(gap).toFixed(1)} months before this round closes.</b> Zero is <b className="num">{zeroNoRaise ? dateShort(zeroNoRaise.date) : "beyond the horizon"}</b>; the close is <b>{monthLabel(START_Y, START_M, r.closeMonth)}</b>. The raise cannot save a company that is already dead when the wire lands — so this is a bridge, a cut, or an earlier close, not a fundraising plan.
                </div>
              ) : (
                <div className="callout" style={{ borderLeftColor: gap < 3 ? "var(--caution)" : "var(--signal)" }}>
                  Without this round you hit zero on <b className="num">{zeroNoRaise ? dateShort(zeroNoRaise.date) : "beyond the horizon"}</b> — <b>{gap.toFixed(1)} months</b> after the {monthLabel(START_Y, START_M, r.closeMonth)} close.{gap < 3 && <> That is a thin cushion: a month of diligence slip and you are negotiating from the floor.</>}
                </div>
              )}
              {thin && start !== Infinity && (
                <div className="callout" style={{ borderLeftColor: "var(--caution)", marginTop: 12 }}>
                  You start raising with <b>{start.toFixed(1)} months</b> of runway. Under nine and the process itself becomes the leverage — theirs.
                </div>
              )}
              {lateGoals.filter(g => g.round.id === r.id).length > 0 && (
                <div className="callout" style={{ borderLeftColor: "var(--caution)", marginTop: 12 }}>
                  <b>{lateGoals.filter(g => g.round.id === r.id).length} goal{lateGoals.filter(g => g.round.id === r.id).length !== 1 ? "s" : ""}</b> land{lateGoals.filter(g => g.round.id === r.id).length !== 1 ? "" : "s"} after the close. Whatever they prove, they cannot price this round — they are the next one’s story.
                </div>
              )}

              <div className="panel" style={{ marginTop: 16 }}>
                <div className="panel-h">
                  <div><h3>What {r.name} costs</h3><p>Ownership only — no share counts, no option pool, no claim on your founder percentage.</p></div>
                  <span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>read-only</span>
                </div>
                <div style={{ padding: 16 }}>
                  <div className="reconcile">
                    {conv.map(x => (
                      <div className="rec-row" key={x.id}>
                        <span>{x.name} converts here{isApprox(x) && <span className="devchip on" style={{ marginLeft: 6 }}>approx</span>}</span>
                        <b className="num">{(convOwnership(x, r) * 100).toFixed(1)}%</b>
                      </div>
                    ))}
                    <div className="rec-row"><span>New money · {moneyFull(r.amount)} on a {money(r.preMoney)} pre</span><b className="num">{(newOwn * 100).toFixed(1)}%</b></div>
                    <div className="rec-row rec-total"><span>= Sold at this round</span><b className="num">{((convOwn + newOwn) * 100).toFixed(1)}%</b></div>
                  </div>
                  {conv.length > 0 && (
                    <div className="mnote" style={{ marginTop: 12 }}>
                      {conv.map(x => {
                        const own = convOwnership(x, r), same = (x.amount / (postMoney(r))) ;
                        return <div key={x.id}>{x.name}: <b className="num">{moneyFull(x.amount)}</b> at a {money(x.cap)} {x.capType === "post" ? "post" : "pre"}-money cap costs <b className="num">{(own * 100).toFixed(1)}%</b> — the same money in this round would cost <b className="num">{(same * 100).toFixed(1)}%</b>. A bridge is cheap cash and expensive equity.</div>;
                      })}
                      {conv.some(isApprox) && <div style={{ marginTop: 6, color: "var(--muted-2)" }}>Pre-money caps are approximated: each SAFE’s price depends on the others converting at the same instant, and that circularity is not solved here.</div>}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {equity.length === 0 && <div className="emptytab">No priced round on the timeline. Add one under <b>Capital stack</b>.</div>}
      </>)}

      {tab === "stack" && (<>
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-h">
            <div><h3>Capital stack</h3><p>Sorted by close. A SAFE or note converts at the first priced round that closes after it — order is load-bearing. A closed instrument’s money is already in cash on hand, so it is not drawn again; its obligations still are.</p></div>
            <div style={{ display: "flex", gap: 6 }}>
              {INST_KINDS.map(([k, l]) => <button key={k} className="addbtn ghost" onClick={() => add(k)}>{I.plus} {l}</button>)}
            </div>
          </div>
          <table className="tbl">
            <thead><tr><th>Instrument</th><th>Kind</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th><th>Close</th><th>Tier</th><th></th></tr></thead>
            <tbody>
              {sorted.map(r => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td><input className="inp" style={{ width: 140, textAlign: "left" }} value={r.name} onChange={e => up(r.id, { name: e.target.value })} /></td>
                    <td><span className="devchip">{INST_KIND_LABEL[r.kind]}</span></td>
                    <td><select className="sel" value={r.status} onChange={e => up(r.id, { status: e.target.value })}>{INST_STATUS.map(k => <option key={k} value={k}>{(STATUS_LABEL[r.kind] || STATUS_LABEL.equity)[k]}</option>)}</select></td>
                    <td className="amt"><input className="inp" type="number" value={r.amount} onChange={e => up(r.id, { amount: +e.target.value })} /></td>
                    <td><select className="sel" value={r.closeMonth} onChange={e => up(r.id, { closeMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></td>
                    <td><button className={"conf " + instConf(r)} title={r.confAuto === false ? "Manual override — click to return to the status default" : "Set by status — click to pin"} onClick={() => up(r.id, r.confAuto === false ? { confAuto: true } : { confAuto: false, confidence: instConf(r) })}>{instConf(r)}{r.confAuto === false ? " ·pinned" : ""}</button></td>
                    <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => del(r.id)} aria-label="Delete">{I.trash}</button></td>
                  </tr>
                  <tr className="jsub"><td colSpan={7}>
                    <div className="jline">
                      {r.kind === "equity" && <>
                        <div className="jfield"><label>Pre-money</label><input className="jinp" type="number" value={r.preMoney} onChange={e => up(r.id, { preMoney: +e.target.value })} /></div>
                        <div className="jfield"><label>Circled / committed</label><input className="jinp" type="number" value={r.committedAmount || 0} onChange={e => up(r.id, { committedAmount: +e.target.value })} /></div>
                        <div className="jfield"><label>Start raising</label><select className="jinp" value={r.startMonth ?? 0} onChange={e => up(r.id, { startMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></div>
                        <div className="jfield" style={{ flex: 2 }}><label>Use of funds</label><input className="jinp" value={r.useOfFunds || ""} onChange={e => up(r.id, { useOfFunds: e.target.value })} /></div>
                      </>}
                      {(r.kind === "safe" || r.kind === "note") && <>
                        <div className="jfield"><label>Cap</label><input className="jinp" type="number" value={r.cap || 0} onChange={e => up(r.id, { cap: +e.target.value })} /></div>
                        <div className="jfield"><label>Cap type</label><select className="jinp" value={r.capType || "post"} onChange={e => up(r.id, { capType: e.target.value })}><option value="post">Post-money (exact)</option><option value="pre">Pre-money (approx)</option></select></div>
                        <div className="jfield"><label>Discount %</label><input className="jinp" type="number" value={Math.round((r.discount || 0) * 100)} onChange={e => up(r.id, { discount: (+e.target.value || 0) / 100 })} /></div>
                        {r.kind === "note" && r.atMaturity === "royalty" && <>
                          <div className="jfield"><label>Fires at revenue</label><input className="jinp" type="number" value={r.triggerAmount || 0} onChange={e => up(r.id, { triggerAmount: +e.target.value })} /></div>
                          <div className="jfield"><label>Royalty %</label><input className="jinp" type="number" value={Math.round((r.royaltyPct || 0) * 100)} onChange={e => up(r.id, { royaltyPct: (+e.target.value || 0) / 100 })} /></div>
                          <div className="jfield"><label>Royalty on</label><select className="jinp" value={r.royaltyBase || "profit"} onChange={e => up(r.id, { royaltyBase: e.target.value })}><option value="profit">Profit</option><option value="revenue">Revenue</option></select></div>
                          <div className="jfield"><label>Cap (x paid in)</label><input className="jinp" type="number" value={r.capMultiple || 5} onChange={e => up(r.id, { capMultiple: +e.target.value })} /></div>
                        </>}
                        {r.kind === "note" && <>
                          <div className="jfield"><label>Interest %/yr</label><input className="jinp" type="number" value={r.interestPct || 0} onChange={e => up(r.id, { interestPct: +e.target.value })} /></div>
                          <div className="jfield"><label>Matures (mo)</label><input className="jinp" type="number" value={r.maturityMonths || 24} onChange={e => up(r.id, { maturityMonths: +e.target.value })} /></div>
                          <div className="jfield"><label>At maturity</label><select className="jinp" value={r.atMaturity || "repay"} onChange={e => up(r.id, { atMaturity: e.target.value })}><option value="repay">Repay</option><option value="convert">Convert</option><option value="royalty">Royalty until cap</option></select></div>
                        </>}
                      </>}
                      {r.kind === "debt" && <>
                        <div className="jfield"><label>Repay by</label><select className="jinp" value={r.repayMode || "rate"} onChange={e => up(r.id, { repayMode: e.target.value })}><option value="rate">Interest rate</option><option value="multiple">Fixed multiple</option></select></div>
                        {r.repayMode === "multiple"
                          ? <div className="jfield"><label>Multiple (x)</label><input className="jinp" type="number" step="0.1" value={r.repayMultiple || 1.5} onChange={e => up(r.id, { repayMultiple: +e.target.value })} /></div>
                          : <div className="jfield"><label>APR %</label><input className="jinp" type="number" value={r.rateAPR || 0} onChange={e => up(r.id, { rateAPR: +e.target.value })} /></div>}
                        <div className="jfield"><label>Term (mo)</label><input className="jinp" type="number" value={r.termMonths || 36} onChange={e => up(r.id, { termMonths: +e.target.value })} /></div>
                        <div className="jfield"><label>Interest-only (mo)</label><input className="jinp" type="number" value={r.ioMonths || 0} onChange={e => up(r.id, { ioMonths: +e.target.value })} /></div>
                        <div className="jfield"><label>Fee %</label><input className="jinp" type="number" value={Math.round((r.feesPct || 0) * 100)} onChange={e => up(r.id, { feesPct: (+e.target.value || 0) / 100 })} /></div>
                        <div className="jfield"><label>Final payment %</label><input className="jinp" type="number" value={Math.round((r.finalPct || 0) * 100)} onChange={e => up(r.id, { finalPct: (+e.target.value || 0) / 100 })} /></div>
                        <div className="jfield"><label>Min-cash covenant</label><input className="jinp" type="number" value={r.covenantCash || 0} onChange={e => up(r.id, { covenantCash: +e.target.value })} /></div>
                      </>}
                    </div>
                  </td></tr>
                  {r.kind === "note" && r.atMaturity === "royalty" && (() => {
                    const v = royaltyVerdict(r, rowsUp); if (!v) return null;
                    return (
                      <tr className="emprow-sub"><td colSpan={7}>
                        <div className="review">
                          <span className={"rvflag" + (v.fires === null ? " done" : "")}>{v.fires === null ? "Beyond the horizon" : "Fires in horizon"}</span>
                          <span className="rvbody">
                            {v.fires === null
                              ? <>Repayment is a {Math.round((r.royaltyPct || 0) * 100)}% royalty on {r.royaltyBase || "profit"} once cumulative revenue passes <b className="num">{moneyFull(v.trig)}</b>, running until <b className="num">{moneyFull(v.cap)}</b> — {r.capMultiple || 5}× what you took — has been paid. At its most optimistic this projection reaches <b className="num">{moneyFull(v.cum)}</b> over {HORIZON} months, so the trigger never fires here. <b>The obligation is real and it is not in this picture.</b></>
                              : <>Cumulative revenue passes <b className="num">{moneyFull(v.trig)}</b> in <b>{monthLabel(START_Y, START_M, v.fires)}</b> at your most optimistic, after which a {Math.round((r.royaltyPct || 0) * 100)}% royalty runs until <b className="num">{moneyFull(v.cap)}</b> is paid.</>}
                            {!v.knowable && <> The royalty is on <b>profit</b>, which this app does not model — <span style={{ color: "var(--muted-2)" }}>net is cash flow: equipment is expensed on purchase, nothing depreciates, and loan principal counts as a cost. The schedule needs real books, not this.</span></>}
                          </span>
                        </div>
                      </td></tr>
                    );
                  })()}
                  {r.kind === "note" && r.atMaturity !== "convert" && r.atMaturity !== "royalty" && (() => {
                    const conv = convertsAt(r, rounds), mat = (r.closeMonth ?? 0) + (r.maturityMonths || 24);
                    const cliff = (!conv || (conv.closeMonth ?? 0) > mat) && r.status !== "closed";
                    if (!cliff && !r.assumeExtended) return null;
                    return (
                      <tr className="emprow-sub"><td colSpan={7}>
                        <div className={"review" + (r.assumeExtended ? " decided" : "")}>
                          <span className={"rvflag" + (r.assumeExtended ? " done" : "")}>{r.assumeExtended ? "Extension assumed" : "Maturity cliff"}</span>
                          <span className="rvbody">{r.assumeExtended
                            ? <>The repayment is off the runway because you are assuming the holders extend. If they don’t, <b className="num">{moneyFull((r.amount || 0) + accrued(r, mat))}</b> is due in {monthLabel(START_Y, START_M, mat)}.</>
                            : <>No priced round closes before this note matures in <b>{monthLabel(START_Y, START_M, mat)}</b>, so it is modelled as what the document says: <b className="num">{moneyFull((r.amount || 0) + accrued(r, mat))}</b> of cash out, principal plus accrued interest. Most notes get extended — but extension is a favour, not a term.</>}</span>
                          <div style={{ flex: 1 }} />
                          <button className={"rvbtn" + (r.assumeExtended ? "" : " go")} onClick={() => up(r.id, { assumeExtended: !r.assumeExtended })}>{r.assumeExtended ? "Model the repayment" : "Assume extension"}</button>
                        </div>
                      </td></tr>
                    );
                  })()}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {debts.map(d => {
          const L = compileInstrument(d, rounds), out = L.filter(l => l.kind === "cost"), inn = L.find(l => l.kind === "revenue");
          const totalOut = out.reduce((a, l) => a + lineSpan(l), 0), b = covenantBreach(d, rowsFin);
          const beyond = out.filter(l => (l.end ?? l.start) > HORIZON);
          return (
            <div className="panel" key={d.id} style={{ marginBottom: 16 }}>
              <div className="panel-h"><div><h3>{d.name}</h3><p>{d.rateAPR}% APR · {d.ioMonths} months interest-only · {d.termMonths}-month term</p></div>
                <span className={"conf " + instConf(d)} style={{ cursor: "default" }}>{instConf(d)}</span></div>
              <div style={{ padding: 16 }}>
                <div className="gnet" style={{ width: "100%" }}>
                  <span>Drawn<b className="num">{moneyFull(inn ? inn.amount : 0)}</b></span>
                  <span>Repaid<b className="num" style={{ color: "var(--danger)" }}>{moneyFull(totalOut)}</b></span>
                  <span>Cost of capital<b className="num" style={{ color: "var(--caution)" }}>{moneyFull(totalOut - (inn ? inn.amount : 0))}</b></span>
                  {d.covenantCash > 0 && <span>Min-cash covenant<b className="num" style={{ color: b ? "var(--danger)" : "var(--signal-ink)" }}>{moneyFull(d.covenantCash)}</b></span>}
                </div>
                <table className="tbl compact" style={{ marginTop: 12 }}>
                  <thead><tr><th>Flow</th><th>Timing</th><th style={{ textAlign: "right" }}>Amount</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
                  <tbody>
                    {L.map((l, i) => (
                      <tr key={i}>
                        <td>{l.label.replace(d.name + " · ", "")}</td>
                        <td className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{l.cadence === "onetime" ? monthLabel(START_Y, START_M, l.start) : `${monthLabel(START_Y, START_M, l.start)} → ${monthLabel(START_Y, START_M, l.end)}`}</td>
                        <td className="amt num" style={{ color: l.kind === "revenue" ? "var(--signal-ink)" : "var(--danger)" }}>{l.kind === "revenue" ? "+" : "−"}{moneyFull(l.amount)}</td>
                        <td className="amt num" style={{ color: "var(--muted)" }}>{moneyFull(lineSpan(l))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {beyond.length > 0 && (
                  <div className="mnote" style={{ marginTop: 12 }}>
                    Part of this schedule runs past the {HORIZON}-month horizon, so the runway only sees the payments up to {monthLabel(START_Y, START_M, HORIZON)}. The facility is a <b className="num">{moneyFull(totalOut)}</b> obligation; this projection can only show you the front of it.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </>)}

      {tab === "goals" && (<>
        <div className="stats">
          <div className="stat"><div className="lab">Round goals</div><div className="big">{allGoals.length}</div><div className="meta">across {equity.length} priced round{equity.length !== 1 ? "s" : ""}</div></div>
          <div className="stat"><div className="accent" style={{ background: "var(--caution)" }} /><div className="lab">Not yet safe</div><div className="big" style={{ color: slipping.length ? "var(--caution)" : undefined }}>{slipping.length}</div><div className="meta">at risk or not started</div></div>
          <div className="stat hero"><div className="lab">Land after close</div><div className="big" style={{ color: lateGoals.length ? "var(--danger)" : "#fff" }}>{lateGoals.length}</div><div className="meta">can't price this round</div></div>
        </div>
        <div className="callout" style={{ borderLeftColor: "var(--signal)" }}>
          These are the proofs the valuation rests on. A goal is only worth something if it lands <b>before</b> the close — an investor prices what you've shown them, not what you're about to show them.
        </div>
        {equity.map(r => (
          <div className="panel" key={r.id} style={{ marginBottom: 16 }}>
            <div className="panel-h">
              <div><h3>{r.name} <span style={{ fontFamily: "var(--fm)", fontSize: 12, color: "var(--muted-2)", fontWeight: 400 }}>{money(r.amount)} · closes {monthLabel(START_Y, START_M, r.closeMonth)}</span></h3><p>{r.useOfFunds}</p></div>
              <button className="addbtn ghost" onClick={() => addG(r.id)}>{I.plus} Goal</button>
            </div>
            <table className="tbl">
              <thead><tr><th>Goal</th><th>Kind</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(r.goals || []).map(g => {
                  const late = (g.dueMonth ?? 0) > (r.closeMonth ?? 0);
                  return (
                    <tr key={g.id}>
                      <td><input className="inp" style={{ width: 300, textAlign: "left" }} value={g.label} onChange={e => upG(r.id, g.id, { label: e.target.value })} /></td>
                      <td><select className="sel" value={g.kind} onChange={e => upG(r.id, g.id, { kind: e.target.value })}>{GOAL_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                      <td><div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <select className="sel" value={g.dueMonth} onChange={e => upG(r.id, g.id, { dueMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select>
                        {late && <span className="devchip on">after close</span>}
                      </div></td>
                      <td><select className="sel" value={g.status} onChange={e => upG(r.id, g.id, { status: e.target.value })}>{Object.keys(GOAL_STATUS).map(k => <option key={k} value={k}>{GOAL_STATUS[k][0]}</option>)}</select></td>
                      <td style={{ textAlign: "right" }}><button className="iconbtn" onClick={() => delG(r.id, g.id)} aria-label="Delete goal">{I.trash}</button></td>
                    </tr>
                  );
                })}
                {(r.goals || []).length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted-2)", textAlign: "center", padding: 16 }}>No goals yet — what has to be true for this round to price?</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </>)}
    </>
  );
}

/* ============================================================
   PROJECTS VIEW — internal cost centers + external grants
   Internal projects draw internal funds; grants bring external
   funding (milestone- or budget-period / SF-424A-based).
   ============================================================ */
