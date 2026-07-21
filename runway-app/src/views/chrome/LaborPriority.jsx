import React, { useMemo } from "react";
import { laborPriorities } from "../../engine/labor";

// Labor prioritization: each employee ranked by how much their presence costs the runway (leave-one-out
// Δ zero-date). Net (their cost minus the project revenue/work they enable) is primary; cost-only is
// shown alongside so the gap — what they bring in — is visible. Per-100-grant-hours where it applies.
//
// This runs N projection rebuilds, so it's memoized on the base doc: it recomputes only when the
// document actually changes, not on every render.
export function LaborPriority({ baseDoc }) {
  const { rows, baseZero, baseZeroNull } = useMemo(
    () => baseDoc ? laborPriorities(baseDoc) : { rows: [], baseZero: null, baseZeroNull: true },
    [baseDoc]);

  const fmtMonths = (d) => (d > 0 ? "+" : "") + d.toFixed(1);
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.netDelta)));

  return (
    <div className="panel">
      <div className="panel-h">
        <div><h3>Labor prioritization</h3>
          <p>If a person weren't here, where would the runway zero-date move? "Net" removes their cost <em>and</em> the grant/project work they enable — so a well-reimbursed hire can cost little net. The gap to "cost-only" is roughly what they bring in.</p>
        </div>
        <div className="lp-base">Base runway <b className="num">{baseZeroNull ? "beyond horizon" : baseZero.toFixed(1) + " mo"}</b></div>
      </div>

      {rows.length === 0 ? (
        <div className="lp-empty">Add employees to see how each affects the runway.</div>
      ) : (
        <table className="tbl lp-tbl">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="lp-r">Net Δ runway</th>
              <th className="lp-r">Cost-only Δ</th>
              <th className="lp-r">Brings in</th>
              <th className="lp-r">Per 100 grant-hrs</th>
            </tr>
          </thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.title}</div>
              </td>
              <td className="lp-r">
                <div className="lp-delta">
                  <div className="lp-barwrap">
                    <div className="lp-bar" style={{ width: (Math.abs(r.netDelta) / maxAbs) * 100 + "%", background: r.netDelta >= 0 ? "var(--danger)" : "var(--signal)" }} />
                  </div>
                  <span className="num" style={{ fontWeight: 600 }}>{fmtMonths(r.netDelta)}<em className="lp-mo">mo</em></span>
                </div>
              </td>
              <td className="lp-r num" style={{ color: "var(--muted)" }}>{fmtMonths(r.costDelta)}<em className="lp-mo">mo</em></td>
              <td className="lp-r num" style={{ color: r.broughtIn > 0.05 ? "var(--signal-ink)" : "var(--muted-2)" }}>
                {r.broughtIn > 0.05 ? fmtMonths(r.broughtIn) + " mo" : "—"}
              </td>
              <td className="lp-r num" style={{ color: "var(--muted)" }}>
                {r.per100h == null ? "—" : fmtMonths(r.per100h)}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="lp-note">
        Positive Δ means removing them <b>extends</b> the runway (their presence is a net cost); negative means removing them <b>shortens</b> it (they more than pay for themselves). This is decision-support, not a recommendation — it ignores everything a spreadsheet can't see.
      </div>
    </div>
  );
}
