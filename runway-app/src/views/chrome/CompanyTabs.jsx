// Which tabs this company uses. Owner only.
//
// THE OTHER HALF OF A DECISION `state/tabprefs.js` ALREADY MADE. That file stores each person's own
// decluttering, per device, and says why company-wide sharing would be wrong: "one person decluttering
// their own screen must not rearrange somebody else's." That is still true. This answers a different
// question — not "what do I want to look at" but "what does this company use at all" — and only an
// owner can answer it.
//
// The two layers do not override each other. A member cannot un-hide what is turned off here, and
// turning something on here does not force it back onto anybody's own screen.
import React, { useCallback, useEffect, useState } from "react";
import { TAB_REGISTRY, isLocked } from "../../state/tabprefs";
import { ROLE_GATED_TABS } from "../../engine/roles";

export function CompanyTabs({ account, companyId, role }) {
  const [hidden, setHidden] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    if (!account?.companyTabs || !companyId) { setHidden(null); return; }
    account.companyTabs(companyId).then(h => setHidden(h || [])).catch(() => setHidden([]));
  }, [account, companyId]);
  useEffect(load, [load]);

  // Owner only, and absent rather than disabled for everybody else: a control you can see and cannot
  // use is an invitation to ask why.
  if (role !== "owner" || hidden === null) return null;

  const toggle = async (view) => {
    const next = hidden.includes(view) ? hidden.filter(v => v !== view) : [...hidden, view];
    setHidden(next); setBusy(true); setMsg(null);
    try { await account.setCompanyTabs(companyId, next); }
    catch (e) { setMsg(e?.message || "Could not save that."); load(); }
    setBusy(false);
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h3>Tabs this company uses</h3>
          <p>
            Turning one off hides it for everybody here. People can still hide more for themselves —
            this sets what is available, not what each person looks at.
          </p>
        </div>
      </div>
      <div className="tabgrid">
        {TAB_REGISTRY.map(t => {
          const locked = isLocked(t.view);
          const gated = !!ROLE_GATED_TABS[t.view];
          const on = !hidden.includes(t.view);
          return (
            <label key={t.view} className={"tabtoggle" + (locked ? " is-locked" : "")}>
              <input type="checkbox" checked={locked || on} disabled={locked || busy}
                     aria-label={`${t.label} available to this company`}
                     onChange={() => toggle(t.view)} />
              <span>
                {t.label}
                {/* The Dashboard is the fallback when a view disappears, so a company that hid it
                    would leave its members landing on nothing. */}
                {locked && <em> · always on</em>}
                {gated && !locked && <em> · owners, admins and advisors only</em>}
              </span>
            </label>
          );
        })}
      </div>
      {msg && <p className="acct-row-s acct-warn">{msg}</p>}
    </section>
  );
}
