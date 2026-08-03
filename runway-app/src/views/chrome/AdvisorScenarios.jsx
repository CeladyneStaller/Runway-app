// An advisor's own scenarios against a client's model.
//
// REUSES THE SCENARIOS VIEW, which was already parameterised on `{ scenarios, setScenarios }`. Growing
// a second scenario editor for advisors would mean two places to fix a patch bug and two answers to
// what a scenario looks like — and the engine's own comment says the value of the overlay design is
// that "the engine is untouched and the golden number cannot move".
//
// WHAT DIFFERS IS WHERE IT READS AND WRITES. The company's document is the BASE and is never modified:
// these scenarios live in `advisor_scenarios` (028), keyed to the advisor, invisible to the company
// until offered. `onApplyToPlan` is deliberately absent, which now removes the button rather than
// leaving it inert — an advisor cannot write the model, and a control that quietly does nothing is
// worse than one that is not there.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scenarios } from "../Scenarios";
import { buildModelFromDoc } from "../../engine";

/** Server rows -> what the Scenarios view expects, carrying the server id so a later edit knows which
 *  row it is. `_sid` rather than replacing `id`, because the view uses `id` for its own bookkeeping and
 *  a new scenario has one before the server has ever seen it. */
const toScenario = (row) => ({ ...(row.body || {}), _sid: row.id, _shared: row.shared_at,
                               _decision: row.decision });

export function AdvisorScenarios({ account, companyId, doc, onCount }) {
  // HELD IN A REF SO IT IS NOT A DEPENDENCY. Adding a callback to `load`'s deps re-fetches every time
  // the parent re-renders and happens to pass a fresh function — a refetch loop that looks like a slow
  // network rather than a bug. The ref keeps the latest one without making the fetch depend on it.
  const notify = useRef(onCount);
  notify.current = onCount;
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!account?.myScenarios || !companyId) { setRows([]); return; }
    // REPORTS ITS COUNT UP. The Scenarios tile beside this panel would otherwise have to fetch the
    // same list to say "3 yours · 1 offered" — two fetches and two chances to disagree about a number
    // both are showing on one screen.
    account.myScenarios(companyId)
      .then(rs => { const list = rs.map(toScenario); setRows(list); notify.current?.(list); })
      .catch(() => { setRows([]); notify.current?.([]); });
  }, [account, companyId]);
  useEffect(load, [load]);

  const scenarios = useMemo(() => rows || [], [rows]);

  /** The Scenarios view hands back a whole list; the difference is what has to be persisted.
   *
   *  DIFFED RATHER THAN SAVED WHOLESALE, because there is no bulk RPC and writing every scenario on
   *  every keystroke would be one request per patch edit. Local state moves first so the editor stays
   *  responsive, and a failed write reloads rather than leaving the screen showing something the server
   *  refused. */
  const setScenarios = (next) => {
    const list = typeof next === "function" ? next(scenarios) : next;
    setRows(list);
    void (async () => {
      setBusy(true);
      try {
        for (const s of list) {
          const before = scenarios.find(o => (o._sid && o._sid === s._sid) || o.id === s.id);
          const changed = !before || JSON.stringify(stripMeta(before)) !== JSON.stringify(stripMeta(s));
          if (!changed) continue;
          // A decided scenario is a record of what the owner agreed to; 028 refuses to edit one.
          if (s._decision) continue;
          const sid = await account.saveScenario(companyId, s.name, stripMeta(s), s._sid || null);
          if (!s._sid && sid) s._sid = sid;
        }
        for (const old of scenarios) {
          if (old._sid && !list.some(s => s._sid === old._sid)) await account.deleteScenario(old._sid);
        }
      } catch (e) { setMsg(e?.message || "Could not save that."); load(); }
      setBusy(false);
    })();
  };

  const offer = async (scn, on) => {
    setMsg(null); setBusy(true);
    try {
      if (!scn._sid) throw new Error("Save it first.");
      await (on ? account.shareScenario(scn._sid) : account.unshareScenario(scn._sid));
      load();
    } catch (e) { setMsg(e?.message || "Could not do that."); }
    setBusy(false);
  };

  if (rows === null) return <div className="splash">Loading your scenarios…</div>;

  return (
    <>
      <div className="advisor-note">
        <b>These are yours.</b> They are not part of {doc?.companyName || "this company"}&rsquo;s model
        and nobody here can see them until you offer one. Offering does not change anything either —
        an owner decides whether to add it.
      </div>

      {scenarios.length > 0 && (
        <div className="panel">
          <div className="panel-h"><div><h3>Offer to the company</h3></div></div>
          {scenarios.map(s => (
            <div className="acct-row" key={s._sid || s.id}>
              <div>
                <div className="acct-row-t">{s.name}</div>
                <div className="acct-row-s">
                  {s._decision === "accepted" && "Accepted — now in their model"}
                  {s._decision === "declined" && "Declined"}
                  {!s._decision && s._shared && "Offered, waiting on the owner"}
                  {!s._decision && !s._shared && `${(s.patches || []).length} change${(s.patches || []).length === 1 ? "" : "s"}, private`}
                </div>
              </div>
              <div className="acct-row-a">
                {/* A decided scenario is finished. Re-offering it would ask the owner to answer twice. */}
                {!s._decision && (
                  <button className="linkbtn" disabled={busy || !s._sid}
                          onClick={() => offer(s, !s._shared)}>
                    {s._shared ? "Withdraw" : "Offer"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {msg && <p className="acct-row-s acct-warn">{msg}</p>}
        </div>
      )}

      <Scenarios baseDoc={doc} buildModel={buildModelFromDoc}
                 scenarios={scenarios} setScenarios={setScenarios} />
    </>
  );
}

/** The scenario without our bookkeeping — what actually gets stored. */
function stripMeta(s) {
  const { _sid, _shared, _decision, ...rest } = s;
  return rest;
}
