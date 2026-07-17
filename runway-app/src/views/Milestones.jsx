// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React from "react";
import { money } from "../engine/money";
import { dateLong, uid } from "../engine/time";
import { Investment } from "./Investment";
import { I } from "./chrome/icons";

export function Milestones({ ms, setMilestones }) {
  const del = (id) => setMilestones(m => m.filter(x => x.id !== id));
  const add = () => setMilestones(m => [...m, { id: uid(), label: "New milestone", y: 2027, m: 5, day: 15 }]);
  const maxAbs = Math.max(1, ...ms.map(m => Math.abs(m.bal)));

  return (
    <div className="panel">
      <div className="panel-h">
        <div><h3>Critical dates</h3><p>Projected cash balance at each date — including project spend. Green clears; red is a shortfall you'd need to cover.</p></div>
        <button className="addbtn" onClick={add}>{I.plus} Add date</button>
      </div>
      <div>
        {ms.map((m) => {
          const pass = m.bal >= 0;
          const w = (Math.abs(m.bal) / maxAbs) * 100;
          return (
            <div className="ms-row" key={m.id}>
              <div className="ms-info">
                <div className="mtitle">{m.label}
                  {m.fromRound && <span className="chip" style={{ background: "var(--line-2)", color: "var(--muted)" }}>from Investment</span>}
                  <span className={"chip " + (pass ? "ok" : "bad")}>{pass ? "on track" : "shortfall"}</span></div>
                <div className="mdate">{dateLong(m.date)}{m.fromRound && <span style={{ color: "var(--muted-2)" }}> · move it on the Investment tab</span>}</div>
              </div>
              <div className="ms-track"><i style={{ width: w + "%", background: pass ? "var(--signal)" : "var(--danger)" }} /></div>
              <div className="ms-bal" style={{ color: pass ? "var(--signal-ink)" : "var(--danger)" }}>{money(m.bal)}</div>
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
