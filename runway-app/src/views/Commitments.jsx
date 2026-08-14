// What you have signed for and not yet paid.
//
// UNLIKE EVERY OTHER TAB, this one is not populated by using the product normally — so the empty state
// has to explain the concept, and the "ready to promote" panel has to exist. A tab you fill by hand is
// a tab nobody fills.
import React, { useMemo, useState } from "react";
import { TabInsights } from "./chrome/TabInsights";
import { dateShort } from "../engine/time";
import { money } from "../engine/money";

import { INDEX_OF, commitmentPressure, promotable, promote, addManual, removeCommitment, markPaid, setKind }
  from "../engine/commitments";
import { payablesToCommitments } from "../engine/payables";

// "Unpayable" rather than "Uncovered": the filter shows payments the cash will not be there for, which
// is one of the two failures now, not the whole of it.
const SUBS = [["all", "All"], ["uncovered", "Unpayable"], ["paid", "Paid"]];

export function Commitments({ doc, setDoc, rows, canWrite = true, account, companyId }) {
  const [sub, setSub] = useState("all");
  const [adding, setAdding] = useState(false);
  const [imported, setImported] = useState(null);
  const [pulling, setPulling] = useState(false);
  const [draft, setDraft] = useState({
    label: "", signedMonth: 0, payMonth: 1, amount: 0, flavor: "payment",
  });

  // DEFAULTS TO INCLUDING DEBT, because a lender is owed whether or not you close. Excluding it answers
  // the other question worth asking: could everybody ELSE be made whole, and by when.
  // THE TOGGLES LIVE IN THE DOCUMENT. They were component state, so leaving the tab reset them — and a
  // setting that silently reverts is worse than no setting, because the next reading is wrong in a way
  // nobody notices. Both default to counting, so an absent value behaves as before.
  const withVentureDebt = doc?.settings?.exitCountsVentureDebt !== false;
  const withNoteDebt = doc?.settings?.exitCountsNoteDebt !== false;
  const setExit = (key, on) => setDoc(d => ({ ...d,
    settings: { ...(d.settings || {}), [key]: on } }));

  const p = useMemo(() => commitmentPressure(doc, rows, { withVentureDebt, withNoteDebt }),
                    [doc, rows, withVentureDebt, withNoteDebt]);
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
          <div className="meta">
            {(p?.rows || []).length} obligation{(p?.rows || []).length === 1 ? "" : "s"}
            {p?.costShareTotal > 0 && <> · {money(p.costShareTotal)} cost share separately</>}
          </div>
        </div>
        <div className="stat">
          <div className="accent" style={{ background: "var(--caution)" }} />
          {/* NOT "covered runway" ANY MORE. It is the last point at which you could stop trading and
              still pay everyone — a different question from when the bank hits zero, and the label has
              to say so or people will read the two numbers as rivals. */}
          <div className="lab">Clean exit until</div>
          <div className="big">
            {/* ZERO IS AN ANSWER AND "0.0 mo" IS NOT A SENTENCE. A company that already owes more than
                it holds cannot close cleanly today, and saying so plainly beats a number that looks
                like a rounding artefact. */}
            {/* MONTHS, PLAINLY. "not now" read as an error message rather than a number, and the
                sentence underneath already carries the date and the consequence. */}
            {/* SATURATION IS AN ANSWER, not a small number. Failing on the first month that is still a
                decision means there is no window left — printing "0.2 mo" invites somebody to think
                they have a fortnight. */}
            {/* FROM TODAY, not from the model's start. "1.9 mo" reads as "from now", and for a model
                started in January and opened in June the index is wrong by five months — in the
                reassuring direction. */}
            {!p ? "—" : p.coveredEndless ? "beyond"
              : `${(p.coveredFromNow ?? p.coveredMonths).toFixed(1)} mo`}
          </div>
          <div className="meta">
            {!p?.coveredAt ? "you can close and pay everyone"
              : p.alreadyPast
                ? "you could not pay everyone today"
                : `after ${dateShort(p.coveredAt)} you could not pay everyone`}
          </div>
        </div>
        <div className="stat">
          <div className="accent" style={{ background: "var(--danger)" }} />
          <div className="lab">Cannot be paid</div>
          <div className="big" style={p?.unpayable ? { color: "var(--danger)" } : null}>
            {money(p?.unpayable || 0)}
          </div>
          <div className="meta">falls due after the cash runs out</div>
        </div>
        {p?.unmatchable > 0 && (
          <div className="stat">
            <div className="accent" style={{ background: "var(--danger)" }} />
            {/* A SEPARATE FAILURE WITH A SEPARATE REMEDY. Money does not fix this — only NON-GRANT
                money does. A bank balance made entirely of drawdowns against an award cannot match
                that award, which is why this can be non-zero while the cash looks fine. */}
            <div className="lab">Cannot be matched</div>
            <div className="big" style={{ color: "var(--danger)" }}>{money(p.unmatchable)}</div>
            <div className="meta">cost share your non-grant income cannot cover</div>
          </div>
        )}
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

      {p?.coveredMonths != null && (
        <p className="acct-row-s meta cmt-assume">
          {/* THE ASSUMPTION, WHERE THE NUMBER IS. One company-wide notice period rather than one per
              person: a per-employee field would be empty in most models, and a closure figure computed
              from mostly-empty fields is worse than one computed from a stated assumption — provided
              the assumption is stated and can be argued with, which is what this is. */}
          Clean exit assumes{" "}
          <input className="inp inp-wk" type="number" min="0" max="52" disabled={!canWrite}
                 value={doc?.settings?.noticeWeeks ?? 4}
                 onChange={e => setDoc(d => ({ ...d,
                   settings: { ...(d.settings || {}), noticeWeeks: Math.max(0, Number(e.target.value) || 0) } }))} />
          {" "}weeks' notice for everyone, and that every debt below is settled.
        </p>
      )}

      {p?.unpayable > 0 && (
        <div className="alert bad">
          <span><b>{money(p.unpayable)} cannot be paid.</b> Signed, and the money is not there on the
            day it falls due.</span>
          <button className="linkbtn" onClick={() => setSub("uncovered")}>Show</button>
        </div>
      )}
      {p?.overdue > 0 && (
        <div className="alert warn">
          <span><b>{p.overdue} past their payment date</b> and not marked paid — usually a stale record
            rather than missing money.</span>
        </div>
      )}

      {/* ⚠️ THIS TAB NEVER MOUNTED THE INSIGHTS PANEL. Two commitments charts were registered,
          `chartsForTab("cmt")` returned both, and nothing rendered — because `TabInsights` sits on
          Projects, History and Sales and not here. **A chart in the registry and nowhere on screen is
          indistinguishable from one that was never written.**

          Registering a chart and mounting the panel are two steps, and only the first is visible in
          `charts.js` — which is why this looked finished. */}
      <TabInsights tab="cmt" subtab={sub} />


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
              <h3>{sub === "uncovered" ? "Cannot be paid" : "Withstanding payments"}</h3>
              <p>Sorted by payment date. Cover counts everything payable before it, not just this one.</p>
            </div>
            <span className="members-form" style={{ margin: 0 }}>
              {canWrite && account && companyId && (
                <button className="linkbtn" disabled={pulling} onClick={async () => {
                  setPulling(true);
                  try {
                    const r = await account.qboSync(companyId, { what: "payables" });
                    setImported(payablesToCommitments(r?.grid, {
                      startY: doc.startY, startM: doc.startM, existing: doc.commitments || [],
                    }));
                  } catch (e) {
                    setImported({ drafts: [], reason: e?.message || "Could not read unpaid bills.",
                                  note: "" });
                  }
                  setPulling(false);
                }}>{pulling ? "Reading…" : "Pull unpaid bills"}</button>
              )}
              {canWrite && <button className="addbtn ghost" onClick={() => setAdding(true)}>Add</button>}
            </span>
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
                    {/* THE ONE PER-COMMITMENT JUDGEMENT THE PRODUCT ASKS FOR. Everything else is
                        inferred; this cannot be, because the difference between an invoice you owe and
                        a fee you would walk away from is a fact about intentions.
                        NOT OFFERED ON A CLOSURE FEE: a lease break exists BECAUSE you closed, so
                        calling it a cost you would avoid by closing is a contradiction. */}
                    {r.payMonth == null ? (
                      <span className="badge badge-debt" title="Triggered by closing, so always a debt">
                        debt
                      </span>
                    ) : (
                      <button
                        className={"badge " + (r.kind === "planned" ? "badge-planned" : "badge-debt")}
                        disabled={!canWrite}
                        title={r.kind === "planned"
                          ? "Not counted in your clean-exit date — click to mark it a debt"
                          : "Counted in your clean-exit date — click if you would not pay it on closing"}
                        onClick={() => canWrite && setDoc(d => setKind(d, r.id,
                          r.kind === "planned" ? "debt" : "planned"))}>
                        {r.kind === "planned" ? "planned" : "debt"}
                      </button>
                    )}
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
          {/* THE FLAVOUR FIRST, because it decides what the rest of the form asks for. The three differ
              at exactly one moment — closure — and that difference is what the fields below express. */}
          <div className="flavour-pick">
            {[["payment", "Payment", "A debt due on a date, or when you close"],
              ["recurring", "Recurring", "Overhead that stops when the business does"],
              ["indexed", "Indexed", "Scales with revenue, project spend or profit"]].map(([k, label, why]) => (
              <button key={k} className={"flavour" + (draft.flavor === k ? " on" : "")}
                      onClick={() => setDraft(d => ({ ...d, flavor: k }))}>
                <b>{label}</b><span>{why}</span>
              </button>
            ))}
          </div>

          <div className="members-form">
            <input className="inp" placeholder="What" value={draft.label}
                   onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
            <input className="inp" type="number" placeholder="Signed (month)" value={draft.signedMonth}
                   onChange={e => setDraft(d => ({ ...d, signedMonth: Number(e.target.value) || 0 }))} />

            {draft.flavor === "indexed" ? (
              <>
                <select className="sel" value={draft.indexOf || "revenue"}
                        onChange={e => setDraft(d => ({ ...d, indexOf: e.target.value }))}>
                  {INDEX_OF.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                {draft.indexOf === "project" && (
                  <select className="sel" value={draft.indexRef || ""}
                          onChange={e => setDraft(d => ({ ...d, indexRef: e.target.value }))}>
                    <option value="">Every project</option>
                    {(doc?.projects || []).map(pr => (
                      <option key={pr.id} value={pr.id}>{pr.name || "Project"}</option>
                    ))}
                  </select>
                )}
                <input className="inp" type="number" step="0.1" placeholder="Rate %"
                       value={draft.indexPct ?? ""}
                       onChange={e => setDraft(d => ({ ...d, indexPct: Number(e.target.value) || 0 }))} />
              </>
            ) : draft.flavor === "recurring" ? (
              <input className="inp" type="number" placeholder="Per month" value={draft.amount || ""}
                     onChange={e => setDraft(d => ({ ...d, amount: Number(e.target.value) || 0 }))} />
            ) : (
              <>
                {/* A PAYMENT CAN HAVE NO DUE DATE. A lease break or a dissolution cost is real,
                    quantified, and has no month until you pick one — leaving it blank is the point,
                    not an omission. */}
                <input className="inp" type="number" placeholder="Payable (month)"
                       value={draft.payMonth ?? ""}
                       onChange={e => setDraft(d => ({ ...d,
                         payMonth: e.target.value === "" ? null : (Number(e.target.value) || 0) }))} />
                <input className="inp" type="number" placeholder="Amount" value={draft.amount || ""}
                       onChange={e => setDraft(d => ({ ...d, amount: Number(e.target.value) || 0 }))} />
              </>
            )}
            <button className="addbtn"
                    disabled={!draft.label ||
                      (draft.flavor === "indexed" ? !(draft.indexPct > 0) : !(draft.amount > 0))}
                    onClick={() => {
                      setDoc(d => addManual(d, draft.flavor === "indexed"
                        ? { ...draft, amount: 0, payMonth: null,
                            index: { of: draft.indexOf || "revenue", ref: draft.indexRef || null,
                                     pct: (draft.indexPct || 0) / 100 } }
                        : draft));
                      setAdding(false);
                      setDraft({ label: "", signedMonth: 0, payMonth: 1, amount: 0, flavor: "payment" });
                    }}>
              Add
            </button>
            <button className="linkbtn" onClick={() => setAdding(false)}>Cancel</button>
          </div>

          {preview && (
            <p className="acct-row-s">
              {/* BOTH SENTENCES AT ONCE. The first is why the model stays quiet today; the second is why
                  this tab exists. */}
              This does not change your runway. Your clean-exit point becomes{" "}
              <b>{preview.coveredEndless ? "beyond the horizon" : `${preview.coveredMonths.toFixed(1)} months`}</b>
              {preview.uncovered > 0 && <> and commits you to <b>{money(preview.uncovered)}</b> you do not have</>}.
            </p>
          )}
        </section>
      )}

      {imported && (
        <section className="panel">
          <div className="panel-h">
            <div>
              <h3>From QuickBooks</h3>
              {/* SAID EVERY TIME, not only when the list is short. A bill is raised when an INVOICE
                  arrives; a commitment begins when you sign — so this misses everything signed and not
                  yet billed, which is precisely the long-dated purchase order the tab exists for. An
                  empty list read as "nothing outstanding" would be worse than not importing at all. */}
              <p>{imported.note}</p>
            </div>
            <button className="linkbtn" onClick={() => setImported(null)}>Dismiss</button>
          </div>

          {imported.reason && <p className="acct-row-s acct-warn">{imported.reason}</p>}

          {imported.drafts.length === 0
            ? <p className="acct-row-s">No unpaid bills came back.</p>
            : (
              <table className="tbl">
                <thead><tr><th>Bill</th><th>Due</th>
                  <th style={{ textAlign: "right" }}>Amount</th><th /></tr></thead>
                <tbody>
                  {imported.drafts.map((d, i) => (
                    <tr key={d.extRef || i}>
                      <td>{d.label}</td>
                      <td className="meta">month {d.payMonth}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--fm)" }}>{money(d.amount)}</td>
                      <td>
                        {/* NOTHING IS WRITTEN UNTIL SOMEBODY CONFIRMS. An import that silently added
                            obligations would change a company's runway on the strength of a report
                            nobody had read. */}
                        <button className="linkbtn" onClick={() => {
                          setDoc(dd => addManual(dd, d));
                          setImported(im => ({ ...im, drafts: im.drafts.filter(x => x !== d) }));
                        }}>Add</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

          {(imported.noDate > 0 || imported.duplicates > 0 || imported.skipped > 0) && (
            <p className="acct-row-s">
              {/* COUNTED, NOT SILENT. A row that did not import for a reason somebody can act on is
                  worth a sentence; a row that vanished is a support ticket. */}
              {imported.noDate > 0 && <>{imported.noDate} had no due date. </>}
              {imported.duplicates > 0 && <>{imported.duplicates} already recorded. </>}
              {imported.skipped > 0 && <>{imported.skipped} were credits or zero.</>}
            </p>
          )}
        </section>
      )}

      {/* ── DEBT AND NOTES ─────────────────────────────────────────────────────────────────────
          One section with three groups, because they are one conversation — what a lender or a
          noteholder is owed — and three different answers about whether closing discharges it. */}
      {(p?.debtTotal > 0 || (p?.royalties || []).length > 0) && (
        <section className="panel">
          <div className="panel-h">
            <div><h3>Debt and notes</h3>
              <p>Repayments are already in your runway. These are the balances behind them.</p></div>
            <span className="chip">{money((p.debtTotal || 0))}</span>
          </div>

          {p.ventureDebt?.length > 0 && (
            <Group label="Venture debt" total={p.ventureDebtTotal}
                   toggle={{ on: withVentureDebt, set: (v) => setExit("exitCountsVentureDebt", v) }}>
              {p.ventureDebt.map(x => <Row key={x.id} label={x.label} tag={x.what} amount={x.amount} />)}
            </Group>
          )}

          {p.noteDebt?.length > 0 && (
            <Group label="Note debt" total={p.noteDebtTotal}
                   toggle={{ on: withNoteDebt, set: (v) => setExit("exitCountsNoteDebt", v) }}>
              {p.noteDebt.map(x => <Row key={x.id} label={x.label} tag={x.what} amount={x.amount} />)}
            </Group>
          )}

          {(p.royalties || []).length > 0 && (
            /* NO TOGGLE, because there is no decision to make. A royalty is paid out of revenue you are
               earning; stop trading and there is nothing further owed. Offering a switch would imply
               otherwise. */
            <Group label="Royalties" total={null}
                   note="Not counted in your clean exit — stop trading and nothing further is owed.">
              {p.royalties.map(x => (
                <Row key={x.id} label={x.label} tag={`${Math.round(x.pct * 100)}% of ${x.of}`}
                     amount={x.cap} amountLabel="until" />
              ))}
            </Group>
          )}
        </section>
      )}

      {/* ── COST SHARE ─────────────────────────────────────────────────────────────────────── */}
      {(p?.costShareByGrant || []).length > 0 && (
        <section className="panel">
          <div className="panel-h">
            <div><h3>Cost share</h3>
              <p>Not owed on top of your plan — the part of your project spending that is never
                 reimbursed. Change the award to change these.</p></div>
            <span className="chip">{money(p.costShareTotal)}</span>
          </div>
          {p.costShareByGrant.map(g => (
            <Group key={g.projectId} label={g.label} total={g.total}>
              {g.periods.map(per => (
                <Fold key={per.key} label={per.label} total={per.total} count={per.rows.length}>
                  {per.rows.map(c => (
                    <Row key={c.id} label={c.label.replace(/^.*— /, "")}
                         tag={c.dueAt ? dateShort(c.dueAt) : `month ${c.payMonth}`} amount={c.amount} />
                  ))}
                </Fold>
              ))}
            </Group>
          ))}
        </section>
      )}

      {/* ── SHUTDOWN COSTS ─────────────────────────────────────────────────────────────────── */}
      {p?.shutdownTotal > 0 && (
        <section className="panel">
          <div className="panel-h">
            <div><h3>Shutdown costs</h3>
              {/* THEIR OWN SECTION, not payments with a missing date. They exist only because you
                  stopped, and grouping them with dated obligations made them read as data somebody had
                  failed to fill in. */}
              <p>Only owed if you stop. Nothing here is in your runway.</p></div>
            <span className="chip">{money(p.shutdownTotal)}</span>
          </div>
          {p.shutdown.map(x => (
            <Row key={x.id} label={x.label} tag={x.derived ? "assumed" : "on closing"} amount={x.amount} />
          ))}
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

/** A named group inside a section: a heading, a total, an optional toggle, and its rows.
 *
 *  ONE COMPONENT FOR ALL OF THEM, so a group cannot look like a section by accident. The visual
 *  hierarchy is the argument — section is "what kind of obligation", group is "which one" — and two
 *  implementations would eventually disagree about which is which.
 */
function Group({ label, total, toggle, note, children }) {
  return (
    <div className="cgroup">
      <div className="cgroup-h">
        <b>{label}</b>
        {toggle && (
          <label className="dbt-toggle">
            <input type="checkbox" checked={toggle.on} onChange={e => toggle.set(e.target.checked)} />
            <span>Count in clean exit</span>
          </label>
        )}
        {total != null && <span className="cgroup-t">{money(total)}</span>}
      </div>
      {note && <p className="cgroup-n">{note}</p>}
      <div className="cgroup-b">{children}</div>
    </div>
  );
}

/** One line inside a group. */
function Row({ label, tag, amount, amountLabel }) {
  return (
    <div className="crow">
      <span className="crow-l">{label}{tag && <em className="src">{tag}</em>}</span>
      <span className="crow-a">
        {amountLabel && <i>{amountLabel} </i>}{money(amount)}
      </span>
    </div>
  );
}

/** A collapsible sub-group. Defaults CLOSED.
 *
 *  A monthly-billed award has twelve rows per budget period, and three periods is thirty-six lines of
 *  detail nobody asked for. The TOTAL is what somebody wants — it is what a funder checks — and the
 *  rows are there when they want to reconcile against something they were sent.
 *
 *  The count is on the summary line so a closed fold still says how much it is hiding; a disclosure
 *  triangle with nothing beside it is a thing people learn not to open.
 */
function Fold({ label, total, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"fold" + (open ? " on" : "")}>
      <button className="fold-h" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="fold-c" aria-hidden="true">{open ? "\u2212" : "+"}</span>
        <span className="fold-l">{label}</span>
        <span className="fold-n">{count} {count === 1 ? "entry" : "entries"}</span>
        <span className="fold-t">{money(total)}</span>
      </button>
      {open && <div className="fold-b">{children}</div>}
    </div>
  );
}
