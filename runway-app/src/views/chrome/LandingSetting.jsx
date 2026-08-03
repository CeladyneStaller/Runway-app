// Where your day starts.
//
// ON THE PROFILE, NOT THE COMPANY, and stored on `profiles` rather than in `tabprefs` — signing in on a
// laptop and a phone to two different screens would be a preference behaving like a bug.
//
// THE PORTFOLIO APPEARS ONLY FOR AN ADVISOR. Somebody with two companies of their own is switching
// between two models, not running a portfolio, and offering the option to people who cannot use it is a
// feature advertising itself to the wrong audience.
import React, { useState } from "react";
import { landingChoices, landingFor, PORTFOLIO } from "../../engine/landing";

export function LandingSetting({ account, companies = [], isAdvisor = false, value, onSaved }) {
  const [choice, setChoice] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const choices = landingChoices({ companies, isAdvisor });

  // Only worth offering when there is more than one answer. One company and no advisor flag means one
  // possible landing, and a dropdown with a single option is a control pretending to be a decision.
  if (choices.length < 2) return null;

  // WHAT IT ACTUALLY RESOLVES TO, from the same function the app lands with. A setting that says
  // "Default" without saying what the default IS makes somebody change it just to find out.
  const resolved = landingFor({ companies, isAdvisor, preferred: choice || null });
  const resolvedLabel = resolved.view === PORTFOLIO
    ? "your portfolio"
    : (companies.find(c => c.id === resolved.companyId)?.name || "your company");

  const save = async (next) => {
    setBusy(true); setMsg(null);
    try {
      await account.setLanding(next || null);
      setChoice(next);
      await onSaved?.(next);
    } catch (e) { setMsg(e?.message || "Could not save that."); }
    setBusy(false);
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h3>Where you start</h3>
          <p>The screen you land on when you sign in. Follows you across devices.</p>
        </div>
      </div>

      <div className="acct-row">
        <div>
          <div className="acct-row-t">Landing page</div>
          <div className="acct-row-s">
            Currently opens <b>{resolvedLabel}</b>.
          </div>
        </div>
        <div className="acct-row-a">
          <select className="sel" value={choice} disabled={busy}
                  aria-label="Landing page"
                  onChange={e => save(e.target.value)}>
            <option value="">Decide for me</option>
            {choices.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {!choice && (
        <p className="acct-row-s">
          {/* The rule, said plainly, because "decide for me" is only reassuring if you can see what it
              decides. */}
          {isAdvisor
            ? "Advisors start on their portfolio."
            : "Starts on a company you own, or the one you have been in longest."}
        </p>
      )}

      {msg && <p className="acct-row-s acct-warn">{msg}</p>}
    </section>
  );
}
