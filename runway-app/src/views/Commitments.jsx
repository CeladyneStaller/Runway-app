// What you have signed for and not yet paid.
//
// UNLIKE EVERY OTHER TAB, this one is not populated by using the product normally — so the empty state
// has to explain the concept, and the "ready to promote" panel has to exist. A tab you fill by hand is
// a tab nobody fills.
import React, { useMemo, useState } from "react";
import { money } from "../engine/money";
import { dateShort } from "../engine/time";
import { commitmentPressure, promotable, promote, addManual, removeCommitment, markPaid }
  from "../engine/commitments";

const SUBS = [["all", "All"], ["uncovered", "Uncovered"], ["paid", "Paid"]];

export function Commitments({ doc, setDoc, rows, canWrite = true }) {
  const [sub, setSub] = useState("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", signedMonth: 0, payMonth: 1, amount: 0 });

  const p = useMemo(() => commitmentPressure(doc, rows), [doc, rows]);
  const ready = useMemo(() => promotable(doc), [doc]);
  const paid = (doc?.commitments || []).filter(c => c.status === "paid");

  // WHAT SIGNING THIS WOULD DO, computed before it is saved. The sentence the product could not say
  // before: it does not change your runway, and commits you to money you do not have.
  const preview = useMemo(() => {
    if (!adding || !(draft.amount > 0)) return null;
    const next = addManual(doc, draft);
    try { return commitmentPressure(next, rows); } catch { return null; }
  }, [adding, draft, doc, rows]);

  const shown = (p?.rows || []).filter(r =>
    sub === "all" ? true : sub === "uncovered" ? !r.covered : false);

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="accent" style={{ background: "var(--commit)" }} />
          <div className="lab">Committed, unpaid</div>
          <div className="big">{p ? money(p.unpaid) : money(0)}</div>
          <div className="meta">{(p?.rows || []).length} obligation{(p?.rows || []).length === 1 ? "" : "s"}</div>
        </div>
        <div className="stat">
          <div className="accent" style={{ background: "var(--caution)" }} />
          <div className="lab">Covered runway</div>
          <div className="big">
            {/* Endless is an ANSWER, not a blank. The cash outlasting every obligation is the opposite
                of a problem and must not render as "no data". */}
            {!p ? "—" : p.coveredEndless ? "beyond" : `${p.coveredMonths.toFixed(1)} mo`}
          </div>
          <div className="meta">{p?.coveredAt ? `runs short ${dateShort(p.coveredAt)}` : "every obligation covered"}</div>
        </div>
        <div className="stat">
          <div className="accent" style={{ background: "var(--danger)" }} />
          <div className="lab">Uncovered</div>
          <div className="big" style={p?.uncovered ? { color: "var(--danger)" } : null}>
            {money(p?.uncovered || 0)}
          </div>
          <div className="meta">signed, no cash behind it</div>
        </div>
        <div className="stat hero">
          <div className="lab">Next payable</div>
          <div className="big" style={{ fontSize: 15 }}>
            {p?.nextDue ? dateShort(p.nextDue.dueAt) : "—"}
          </div>
          <div className="meta">
            {p?.nextDue ? `${money(p.nextDue.amount)} · ${p.nextDue.label}` : "nothing outstanding"}
          </div>
        </div>
      </div>

      {p?.uncovered > 0 && (
        <div className="alert bad">
          <span><b>{money(p.uncovered)} has no cash behind it.</b> Signed, and the money is not there
            on the day it is due.</span>
          <button className="linkbtn" onClick={() => setSub("uncovered")}>Show</button>
        </div>
      )}
      {p?.overdue > 0 && (
        <div className="alert warn">
          <span><b>{p.overdue} past their payment date</b> and not marked paid — usually a stale record
            rather than missing money.</span>
        </div>
      )}

      {!p && ready.length === 0 && (
        <section className="panel">
          <div className="cmt-empty">
            <h3>Nothing signed yet</h3>
            <p>
              A commitment is something you have agreed to pay and have not paid — a signed purchase
              order, a deposit, a cost-share obligation. Recording them shows how long your cash lasts
              if you honour all of them.
            </p>
            {canWrite && <button className="addbtn" onClick={() => setAdding(true)}>Add one</button>}
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className="panel">
          <div className="panel-h">
            <div>
              <h3>{sub === "uncovered" ? "Uncovered" : "Unpaid"}</h3>
              <p>Sorted by payment date. Cover counts everything payable before it, not just this one.</p>
            </div>
            {canWrite && <button className="addbtn ghost" onClick={() => setAdding(true)}>Add</button>}
          </div>
          <div className="subs">
            {SUBS.map(([k, l]) => (
              <button key={k} className={"subpill" + (sub === k ? " on" : "")}
                      onClick={() => setSub(k)}>{l}</button>
            ))}
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Commitment</th><th>Signed</th><th>Payable</th>
                <th style={{ textAlign: "right" }}>Amount</th><th>Cover</th><th /></tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id}>
                  <td>
                    <b>{r.label}</b>
                    <div className="meta"><span className="src">{r.source}</span></div>
                  </td>
                  <td className="meta">month {r.signedMonth}</td>
                  <td>{dateShort(r.dueAt)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--fm)" }}>{money(r.amount)}</td>
                  <td>
                    {r.covered
                      ? <span className="chip ok">covered · {money(r.spare)} spare</span>
                      : <span className="chip bad">
                          short {money(Math.abs(r.spare ?? 0))}
                          {r.daysPast ? ` · ${r.daysPast} d past` : ""}
                        </span>}
                  </td>
                  <td>
                    {canWrite && (
                      <>
                        <button className="linkbtn" onClick={() => setDoc(d => markPaid(d, r.id))}>
                          Mark paid
                        </button>
                        <button className="linkbtn" onClick={() => setDoc(d => removeCommitment(d, r.id))}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {adding && (
        <section className="panel">
          <div className="panel-h">
            <div><h3>Add a commitment</h3>
              <p>Two dates and an amount. The consequence updates as you type.</p></div>
          </div>
          <div className="members-form">
            <input className="inp" placeholder="What" value={draft.label}
                   onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
            <input className="inp" type="number" placeholder="Signed (month)" value={draft.signedMonth}
                   onChange={e => setDraft(d => ({ ...d, signedMonth: Number(e.target.value) || 0 }))} />
            <input className="inp" type="number" placeholder="Payable (month)" value={draft.payMonth}
                   onChange={e => setDraft(d => ({ ...d, payMonth: Number(e.target.value) || 0 }))} />
            <input className="inp" type="number" placeholder="Amount" value={draft.amount || ""}
                   onChange={e => setDraft(d => ({ ...d, amount: Number(e.target.value) || 0 }))} />
            <button className="addbtn" disabled={!draft.label || !(draft.amount > 0)}
                    onClick={() => { setDoc(d => addManual(d, draft)); setAdding(false);
                                     setDraft({ label: "", signedMonth: 0, payMonth: 1, amount: 0 }); }}>
              Add
            </button>
            <button className="linkbtn" onClick={() => setAdding(false)}>Cancel</button>
          </div>

          {preview && (
            <p className="acct-row-s">
              {/* BOTH SENTENCES AT ONCE. The first is why the model stays quiet today; the second is why
                  this tab exists. */}
              This does not change your runway. Covered runway becomes{" "}
              <b>{preview.coveredEndless ? "beyond the horizon" : `${preview.coveredMonths.toFixed(1)} months`}</b>
              {preview.uncovered > 0 && <> and commits you to <b>{money(preview.uncovered)}</b> you do not have</>}.
            </p>
          )}
        </section>
      )}

      {ready.length > 0 && canWrite && (
        <section className="panel">
          <div className="panel-h">
            <div>
              <h3>Ready to promote</h3>
              <p>
                Planned costs you have not marked as signed. Promoting one changes no cash — the spend
                was already in the plan — it starts counting the obligation.
              </p>
            </div>
          </div>
          <table className="tbl">
            <thead><tr><th>Planned cost</th><th>Due</th>
              <th style={{ textAlign: "right" }}>Amount</th><th /></tr></thead>
            <tbody>
              {ready.map(r => (
                <tr key={r.lineId}>
                  <td>{r.label}</td>
                  <td className="meta">month {r.payMonth}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--fm)" }}>{money(r.amount)}</td>
                  <td>
                    <button className="linkbtn" onClick={() => setDoc(d => promote(d, r.lineId))}>
                      Mark signed
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {paid.length > 0 && sub === "paid" && (
        <section className="panel">
          <div className="panel-h"><div><h3>Paid</h3>
            <p>The obligation is discharged; the money still left, and is in the plan.</p></div></div>
          <table className="tbl">
            <thead><tr><th>Commitment</th><th style={{ textAlign: "right" }}>Amount</th><th>Ledger</th></tr></thead>
            <tbody>
              {paid.map(c => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--fm)" }}>{money(c.amount)}</td>
                  <td>
                    {/* SAID, NOT HIDDEN. No ledger line means the model says paid and the books do not —
                        a missing import, or a payment that never went out. Silence lets the two records
                        drift apart unnoticed. */}
                    {c.paidRef?.ref
                      ? <span className="chip ok">matched · {c.paidRef.ref}</span>
                      : <span className="chip warn">no ledger line found</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
