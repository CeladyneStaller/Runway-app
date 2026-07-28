// Critical dates: a date, what the model says the balance will be on it, and — since this panel is
// the one people bring to a board meeting — what the balance NEEDS to be.
import React from "react";
import { money } from "../engine/money";
import { dateLong, uid } from "../engine/time";
import { msTarget } from "../engine/capital";
import { I } from "./chrome/icons";

const pad = (n) => String(n).padStart(2, "0");

// STORED AS {y, m, day} WITH A ZERO-BASED MONTH, because that is what `new Date(y, m, day)` takes and
// what every consumer already assumes. An <input type="date"> speaks YYYY-MM-DD with a one-based
// month, so the conversion happens here and NOWHERE ELSE.
//
// Neither direction builds a Date from a string. `new Date("2027-05-15")` is UTC midnight and reports
// as the 14th in any negative-offset timezone — the same trap `dateWindows` avoids, and this suite
// runs under TZ=America/Denver so a regression would be caught rather than merely possible.
const toInput = (ms) => `${ms.y}-${pad((ms.m ?? 0) + 1)}-${pad(ms.day ?? 1)}`;
const fromInput = (value) => {
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;            // a half-typed date must not wipe the stored one
  return { y, m: m - 1, day: d };
};

export function Milestones({ ms, setMilestones }) {
  const upd = (id, patch) =>
    setMilestones(list => list.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const del = (id) => setMilestones(list => list.filter(x => x.id !== id));

  // SIX MONTHS OUT, not a date hard-coded in the past. The old default was 15 May 2027, which was a
  // year ahead when it was written and is a critical date you have already missed by the time anyone
  // reads this.
  const add = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    setMilestones(list => [...list, { id: uid(), label: "New milestone",
                                      y: d.getFullYear(), m: d.getMonth(), day: d.getDate() }]);
  };

  const maxAbs = Math.max(1, ...ms.map(m => Math.abs(m.bal)));

  return (
    <div className="panel">
      <div className="panel-h">
        <div><h3>Critical dates</h3><p>Projected cash balance at each date — including project spend. Set a target to say how much has to be there, not just that something is.</p></div>
        <button className="addbtn ghost" onClick={add}>{I.plus} Add date</button>
      </div>
      <div>
        {ms.map((m) => {
          const target = m.target ?? msTarget(m);
          const pass = m.pass ?? (m.bal >= target);
          const gap = m.gap ?? (m.bal - target);
          const w = (Math.abs(m.bal) / maxAbs) * 100;
          return (
            <div className="ms-row" key={m.id}>
              <div className="ms-info">
                <div className="mtitle">
                  {/* Rounds are edited on the Investment tab — a close date has to stay in step with
                      the round it belongs to, so it is shown here and owned there. */}
                  {m.fromRound
                    ? <>{m.label}<span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>from Investment</span></>
                    : <input className="inp ms-name" value={m.label} aria-label="Milestone name"
                             onChange={e => upd(m.id, { label: e.target.value })} />}
                  <span className={"chip " + (pass ? "ok" : "bad")}>{pass ? "on track" : "shortfall"}</span>
                </div>
                <div className="mdate">
                  {m.fromRound
                    ? <>{dateLong(m.date)}<span style={{ color: "var(--muted-2)" }}> · move it on the Investment tab</span></>
                    : <input className="inp sm" type="date" value={toInput(m)} aria-label="Milestone date"
                             onChange={e => { const d = fromInput(e.target.value); if (d) upd(m.id, d); }} />}
                  {!m.fromRound && (
                    <label className="ms-target">
                      needs
                      <input className="inp sm" type="number" step="1000" aria-label="Target cash on hand"
                             value={Number.isFinite(+m.target) ? m.target : ""} placeholder="0"
                             onChange={e => upd(m.id, { target: e.target.value === "" ? undefined : +e.target.value })} />
                    </label>
                  )}
                </div>
              </div>
              <div className="ms-track"><i style={{ width: w + "%", background: pass ? "var(--signal)" : "var(--danger)" }} /></div>
              <div className="ms-bal" style={{ color: pass ? "var(--signal-ink)" : "var(--danger)" }}>
                {money(m.bal)}
                {/* The GAP is the number somebody acts on: how much has to be found, or how much
                    room there is. Shown only when a target makes it mean something. */}
                {target > 0 && (
                  <div className="ms-gap" style={{ color: pass ? "var(--muted)" : "var(--danger)" }}>
                    {pass ? `${money(gap)} above target` : `${money(Math.abs(gap))} short of ${money(target)}`}
                  </div>
                )}
              </div>
              {m.fromRound
                ? <span style={{ width: 32, display: "inline-block" }} />
                : <button className="iconbtn" onClick={() => del(m.id)} aria-label="Delete milestone">{I.trash}</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
