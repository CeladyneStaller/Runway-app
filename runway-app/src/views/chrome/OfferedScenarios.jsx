// Scenarios offered by an advisor, waiting on the owner.
//
// WHAT "REVIEW" SHOWS. A scenario is not a copy of the model — it is `{ name, patches }`, an overlay
// over the base document (`engine/scenario.js`). So the patches ARE the diff, and `describePatch`
// already turns each into a sentence for the Scenarios screen. Showing the whole resulting model would
// be a wall of numbers nobody checks; showing three lines and what they do to the runway is a decision
// somebody can actually make.
//
// ACCEPTING IS TWO OPERATIONS AND ONE BUTTON. `decide_scenario` records the answer; the scenario is
// then appended to `doc.scenarios` and saved through the ORDINARY write path, by the owner, with their
// permissions, their version check and their audit row. The advisor never writes the document. That
// also means the two can come apart — recorded, then the save fails on a conflict — so the failure is
// reported rather than swallowed, and the offer is already marked decided so it will not reappear.
import React, { useCallback, useEffect, useState } from "react";
import { applyScenario, describePatch } from "../../engine/scenario";
import { runwayMonths } from "./docsummary";
import { HORIZON } from "../../engine/time";

const months = (m) => (m == null ? `${HORIZON}+ mo` : `${m.toFixed(1)} mo`);

export function OfferedScenarios({ account, companyId, role, doc, onImport }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    if (!account?.offeredScenarios || !companyId || role !== "owner") { setRows(null); return; }
    account.offeredScenarios(companyId).then(setRows).catch(() => setRows([]));
  }, [account, companyId, role]);
  useEffect(load, [load]);

  // Owner only, and absent rather than empty when there is nothing waiting: a heading with no content
  // under it is a thing people learn to scroll past.
  if (role !== "owner" || !rows?.length) return null;

  const base = doc ? runwayMonths(doc) : null;

  const decide = async (row, accept) => {
    setBusy(row.id); setMsg(null);
    try {
      await account.decideScenario(row.id, accept);
      if (accept) {
        // The scenario carries the advisor's id; a fresh one is minted so it cannot collide with
        // anything already in the document.
        await onImport({ ...row.body, id: undefined, name: row.body?.name || row.name, saved: true });
      }
      setRows(rs => rs.filter(r => r.id !== row.id));
    } catch (e) {
      setMsg(accept
        ? `Recorded your acceptance, but the scenario could not be added: ${e?.message || e}. ` +
          "It will not be offered again — ask for it to be sent once more."
        : (e?.message || "That did not work."));
      load();
    }
    setBusy(null);
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h3>Offered by your advisor</h3>
          <p>Accepting adds it as a scenario. It does not change your live figures.</p>
        </div>
      </div>

      {rows.map(row => {
        const scn = row.body || {};
        const patches = scn.patches || [];
        const after = doc ? runwayMonths(applyScenario(doc, scn)) : null;
        // A number only means something next to the one it replaces, so the delta is stated rather
        // than left as two figures to subtract.
        const delta = base != null && after != null ? after - base : null;
        return (
          <div className="offered" key={row.id}>
            <div className="offered-h">
              <div>
                <div className="acct-row-t">{scn.name || row.name}</div>
                <div className="acct-row-s">
                  {row.author_email} · offered {new Date(row.shared_at).toLocaleDateString()}
                </div>
              </div>
              <span className="chip chip-advisor">Advisor</span>
            </div>

            <div className="offered-nums">
              <div><span>Runway now</span><b>{months(base)}</b></div>
              <div><span>If accepted</span><b>{months(after)}</b></div>
              <div>
                <span>Difference</span>
                <b className={delta == null ? "" : delta >= 0 ? "up" : "down"}>
                  {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} mo`}
                </b>
              </div>
            </div>

            <div className="offered-changes">
              {patches.length === 0
                ? <div className="acct-row-s">This scenario changes nothing.</div>
                : patches.map((p, i) => (
                    <div className="acct-row-s" key={i}>{describePatch(p, doc)}</div>
                  ))}
            </div>

            <div className="members-form">
              <button className="rvbtn go" disabled={busy === row.id} onClick={() => decide(row, true)}>
                Accept
              </button>
              <button className="linkbtn" disabled={busy === row.id} onClick={() => decide(row, false)}>
                Decline
              </button>
              <span className="acct-row-s" style={{ marginLeft: "auto" }}>
                {row.author_email.split("@")[0]} is told either way
              </span>
            </div>
          </div>
        );
      })}

      {msg && <p className="acct-row-s acct-warn">{msg}</p>}
    </section>
  );
}
