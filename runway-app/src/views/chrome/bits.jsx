// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import React from "react";
import { computeGrant } from "../../engine/grant";
import { lineSpan } from "../../engine/projection";
import { HORIZON, monthLabel } from "../../engine/time";
import { useStart } from "../../state/StartCtx";

export const STATUS = { "on-track": ["On track", "var(--signal-ink)", "rgba(16,135,107,.12)"], "at-risk": ["At risk", "var(--caution)", "rgba(201,130,27,.14)"],
  met: ["Met", "var(--signal-ink)", "rgba(16,135,107,.12)"], missed: ["Missed", "var(--danger)", "rgba(188,59,42,.1)"], pending: ["Pending", "var(--muted)", "var(--line-2)"] };

export const statusChipOf = (st) => { const [lab, col, bg] = STATUS[st] || STATUS.pending; return <span className="schip" style={{ background: bg, color: col }}>{lab}</span>; };

export const MOPTS = (START_Y, START_M) => Array.from({ length: HORIZON + 1 }, (_, i) => <option key={i} value={i}>{monthLabel(START_Y, START_M, i)}</option>);

export const timingLabel = (l, START_Y, START_M) => l.cadence === "onetime" ? monthLabel(START_Y, START_M, l.start) : `${monthLabel(START_Y, START_M, l.start)} → ${l.end == null ? "ongoing" : monthLabel(START_Y, START_M, l.end)}`;

export const revOf = (p) => p.type === "grant" && p.grant ? computeGrant(p.grant).lines.filter(l => l.kind === "revenue").reduce((a, l) => a + lineSpan(l), 0) : 0;

/* ---- proposal type switch — lives in the card header, proposals only ---- */
export function TypeSeg({ p, setType }) {
  if (p.stage !== "prospective" || p.type === "fulfillment") return null;
  return (
    <div className="seg sm typeseg">
      <button className={p.type === "grant" ? "on" : ""} onClick={() => setType(p.id, "grant")}>Grant</button>
      <button className={p.type === "internal" ? "on" : ""} onClick={() => setType(p.id, "internal")}>Internal</button>
    </div>
  );
}

/* ---- stage switch + proposal controls, in the card body ---- */
export function StageBar({ p, setP }) {
  const { START_Y, START_M } = useStart();
  const prospective = p.stage === "prospective";
  return (
    <div className="gstage">
      <div className="seg sm">
        <button className={prospective ? "on" : ""} onClick={() => setP(p.id, { stage: "prospective" })}>Proposal</button>
        <button className={!prospective ? "on" : ""} onClick={() => setP(p.id, { stage: "awarded" })}>{p.type === "grant" ? "Awarded" : "Approved"}</button>
      </div>
      {prospective && <>
        <button className={"gtoggle " + (p.include ? "on" : "")} onClick={() => setP(p.id, { include: !p.include })}>
          <span className="dot" />{p.include ? "In the runway — modeling the win" : "Excluded — awaiting decision"}
        </button>
        <label className="inlfield">Decision <select className="sel" value={p.decisionMonth ?? 3} onChange={e => setP(p.id, { decisionMonth: +e.target.value })}>{MOPTS(START_Y, START_M)}</select></label>
      </>}
    </div>
  );
}

export const MField = ({ label, children }) => <div className="mfield"><label className="mlabel">{label}</label><div className="mrow">{children}</div></div>;
