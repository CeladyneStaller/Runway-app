import React, { useState } from "react";
import { costShareReconciliation } from "../../engine/costshare";
import { money, moneyFull } from "../../engine/money";
import { useStart } from "../../state/StartCtx";
import { monthLabel } from "../../engine/time";

// Cost-share reconciliation, in the expanded grant card. Renders nothing unless the project is a grant
// with a match requirement (the engine returns null otherwise). Everything shown is derived — required
// from the budget, recorded from the ledger — so there's no input here, just a read-out.
export function CostSharePanel({ project, hist, maps }) {
  const { START_Y, START_M } = useStart();
  const [open, setOpen] = useState(false);
  const r = costShareReconciliation(project, hist, maps);
  if (!r) return null;

  const pctLabel = r.pct == null ? "—" : Math.round(r.pct * 100) + "%";
  const typeLabel = r.costShareType === "inkind" ? "in-kind" : "cash";

  return (
    <div className="csr">
      <div className="csr-head">
        <div className="csr-title">
          Cost-share <span className="csr-sub">{Math.round(r.costSharePct * 100)}% {typeLabel} match</span>
        </div>
        <div className={"csr-status" + (r.met ? " met" : r.hasRecorded ? " partial" : " none")}>
          {r.met ? "Met" : r.hasRecorded ? pctLabel + " recorded" : "None recorded"}
        </div>
      </div>

      <div className="csr-bar">
        <div className="csr-fill" style={{ width: Math.min(100, (r.pct || 0) * 100) + "%" }} />
      </div>
      <div className="csr-nums">
        <span><b className="num">{moneyFull(r.recordedMatch)}</b> toward match</span>
        <span className="csr-of">of <b className="num">{moneyFull(r.required)}</b> required</span>
        {r.remaining > 0.5 && <span className="csr-rem"><b className="num">{moneyFull(r.remaining)}</b> remaining</span>}
      </div>
      <div className="csr-note">
        Match inferred at {Math.round(r.costSharePct * 100)}% of recorded grant spend. Code ledger lines with a category to see the breakdown below.
      </div>

      {r.perPeriod.length > 1 && (
        <button className="linkbtn csr-toggle" onClick={() => setOpen(o => !o)}>
          {open ? "Hide" : "Show"} per-period detail
        </button>
      )}

      {(open || r.perPeriod.length === 1) && (
        <div className="csr-periods">
          {r.perPeriod.map(p => (
            <div className="csr-period" key={p.period}>
              <div className="csr-ph">
                <span>BP{p.period + 1} <em>({monthLabel(START_Y, START_M, p.start)}–{monthLabel(START_Y, START_M, p.end)})</em></span>
                <span className={"csr-pchip" + (p.met ? " met" : p.recordedSpend > 0 ? " partial" : "")}>
                  {p.met ? "met" : moneyFull(p.recordedMatch) + " / " + moneyFull(p.required)}
                </span>
              </div>
              {p.byCat.length > 0 && (
                <div className="csr-cats">
                  {p.byCat.map(c => (
                    <div className="csr-cat" key={c.category}>
                      <span className="csr-catname">{c.category}</span>
                      <span className="csr-catnum">
                        {c.required > 0
                          ? <>{money(c.recorded)} / {money(c.required)}</>
                          : <>{money(c.recorded)} <em>(no budget)</em></>}
                      </span>
                      <span className={"csr-dot" + (c.met ? " met" : c.recorded > 0 ? " partial" : " none")} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
