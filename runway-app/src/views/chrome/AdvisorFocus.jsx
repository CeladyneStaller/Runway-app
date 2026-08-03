// The owner deciding which tabs an advisor works on.
//
// ⚠️ THIS IS FOCUS, NOT CONFIDENTIALITY, AND THE LABELLING IS THE DESIGN.
//
// `load_document` delivers the entire model as one blob. An advisor's browser receives every salary
// whatever is set here — this hides the TAB, not the data, which is one dev-tools panel away.
//
// So every word on this screen says "what they work on" and none of it says "access", "permission" or
// "private". A checkbox labelled "Payroll" that does not withhold payroll is worse than no checkbox: it
// is a promise the software does not keep, made to somebody deciding whether to share salary data with
// a contractor. And a user who believes salaries are already hidden will never ask for the feature that
// would hide them.
//
// The honest version needs `employees` out of the blob and a role-aware `load_document`; the plan is in
// LAYER-2-advisor-confidentiality.md.
import React, { useState } from "react";
// The tab list, kept here rather than imported from `App.jsx` — a settings panel reaching into the
// app shell for a constant is how a circular import starts. Labels match the rail.
const NAV = [
  ["flow", "Cash flow"], ["pay", "Payroll"], ["proj", "Projects"], ["sales", "Sales"],
  ["inv", "Investment"], ["hist", "Spend history"], ["ms", "Milestones"], ["scn", "Scenarios"],
];

const FOCUSABLE = () => NAV;   // the dashboard is always on, so it is not in the list

export function AdvisorFocus({ account, companyId, member, companyHidden = [], onSaved }) {
  const [focus, setFocus] = useState(member?.focus_tabs ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const focused = Array.isArray(focus);
  const tabs = FOCUSABLE();

  const commit = async (next) => {
    setBusy(true); setMsg(null);
    try {
      await account.setAdvisorFocus(companyId, member.user_id, next);
      setFocus(next);
      await onSaved?.();
    } catch (e) {
      // The server refuses an empty focus, and the message says why rather than "failed".
      setMsg(e?.message || "Could not save that.");
    }
    setBusy(false);
  };

  const toggle = (key) => {
    const now = focused ? focus : tabs.map(([k]) => k);
    const next = now.includes(key) ? now.filter(k => k !== key) : [...now, key];
    // AN ADVISOR WITH NO TABS IS A REMOVED ADVISOR. Caught here as well as on the server, because a
    // message is better than an error — and the owner's actual intent in that case is "remove".
    if (next.length === 0) {
      setMsg("An advisor needs at least one tab. Remove them instead if they should not be here.");
      return;
    }
    commit(next);
  };

  return (
    <div className="focusbox">
      <div className="acct-row">
        <div>
          <div className="acct-row-t">What they work on</div>
          <div className="acct-row-s">
            Tabs outside this are hidden in their view.
          </div>
        </div>
        <div className="acct-row-a">
          <div className="segbtn" role="group" aria-label="Advisor focus">
            <button className={!focused ? "on" : ""} disabled={busy}
                    onClick={() => commit(null)}>Everything</button>
            <button className={focused ? "on" : ""} disabled={busy}
                    onClick={() => commit(tabs.filter(([k]) => !companyHidden.includes(k)).map(([k]) => k))}>
              Chosen tabs
            </button>
          </div>
        </div>
      </div>

      {focused && (
        <div className="focusgrid">
          {tabs.map(([key, label]) => {
            // THE COMPANY'S OWN HIDDEN TABS ARE A FLOOR. Showing a tick that does nothing would be a
            // control lying about its own effect, so it says why instead.
            const offForAll = companyHidden.includes(key);
            return (
              <label key={key} className={"tog" + (offForAll ? " off" : "")}>
                <input type="checkbox" disabled={busy || offForAll}
                       checked={!offForAll && focus.includes(key)}
                       onChange={() => toggle(key)} />
                <span>
                  {label}
                  {offForAll && <em>this company does not use it</em>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {msg && <p className="acct-row-s acct-warn">{msg}</p>}

      <p className="focusnote">
        <b>This changes what they see, not what they can read.</b> The model is still sent to their
        browser in full. Use it to focus an advisor, not to keep something from one.
      </p>
    </div>
  );
}
