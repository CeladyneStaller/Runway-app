// Company → General. What this company is called, and removing it.
//
// SEPARATED FROM THE SWITCHER, which stays in the rail. Switching companies is navigation and happens
// many times a day; renaming one is a setting and happens twice. Burying the frequent action inside the
// rare one would be the wrong trade, and the old Companies panel did exactly that by holding both.
import React, { useEffect, useState } from "react";

export function CompanyGeneral({ company, account, onRenamed }) {
  const [name, setName] = useState(company?.name || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // A switch changes which company this page is about, so the field has to follow it.
  useEffect(() => { setName(company?.name || ""); setMsg(null); }, [company?.id, company?.name]);

  if (!company) return null;
  const changed = name.trim() && name.trim() !== company.name;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await account.renameCompany(company.id, name.trim());
      await onRenamed?.();
      setMsg("Saved.");
    } catch (e) { setMsg(e?.message || "Could not rename this company."); }
    setBusy(false);
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h3>General</h3>
          <p>What this company is called. Everybody here sees it, and it appears on invitations.</p>
        </div>
      </div>

      <div className="acct-row">
        <div>
          <div className="acct-row-t">Company name</div>
          <div className="acct-row-s">Shown in the sidebar, on invitations and in exports</div>
        </div>
        <div className="acct-row-a">
          <input className="inp" value={name} aria-label="Company name"
                 onChange={e => setName(e.target.value)} />
          <button className="addbtn" disabled={!changed || busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* READ-ONLY, DELIBERATELY. The start month is the origin every month index in the document is
          measured from, so changing it here would silently re-base every line, actual and milestone.
          It belongs to the setup flow, where the consequence can be explained and the model rebuilt. */}
      <div className="acct-row">
        <div>
          <div className="acct-row-t">Model starts</div>
          <div className="acct-row-s">
            Every date in the model is measured from here. Changing it re-bases the whole document, so
            it is set during setup rather than here.
          </div>
        </div>
        <div className="acct-row-a"><span className="chip">{company.startLabel || "—"}</span></div>
      </div>

      {msg && <p className="acct-row-s">{msg}</p>}
    </section>
  );
}
