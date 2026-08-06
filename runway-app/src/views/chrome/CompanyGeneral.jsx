// Company → General. What this company is called, and removing it.
//
// SEPARATED FROM THE SWITCHER, which stays in the rail. Switching companies is navigation and happens
// many times a day; renaming one is a setting and happens twice. Burying the frequent action inside the
// rare one would be the wrong trade, and the old Companies panel did exactly that by holding both.
import React, { useEffect, useState } from "react";

export function CompanyGeneral({ company, account, onRenamed, doc, setDoc = () => {}, canEdit = true }) {
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

      {/* MOVED HERE FROM SPEND HISTORY, where it sat above a table of recorded months and looked like
          part of them. It is a property of the COMPANY — the origin every month index is measured from
          — so it belongs beside the company's name.

          The old comment in this spot said the control was read-only because changing the start
          re-bases every line, actual and milestone. That reasoning was right and the control was
          editable on the other tab anyway, so the warning was being made in the one place the change
          could not be made. It travels with the control instead. */}
      <div className="acct-row acct-row-stack">
        <div>
          <div className="acct-row-t">Model starts</div>
          <div className="acct-row-s">
            Month 0 of the model. Every month label, every recorded actual and the whole projection are
            measured from here — <b>changing it re-bases the document</b>.
          </div>
        </div>
        <div className="startcfg">
          <label className="fl">Projection start
            <div className="mrow">
              <select className="sel" value={doc?.startM ?? 0} disabled={!canEdit}
                      aria-label="Projection start month"
                      onChange={e => setDoc(d => ({ ...d, startM: +e.target.value }))}>
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                  .map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <input className="inp" type="number" style={{ width: 82 }} disabled={!canEdit}
                     aria-label="Projection start year" value={doc?.startY ?? 2026}
                     onChange={e => setDoc(d => ({ ...d, startY: +e.target.value }))} />
            </div>
          </label>
          <label className="fl">Cash on hand at start
            <input className="inp" type="number" style={{ width: 132 }} disabled={!canEdit}
                   aria-label="Cash on hand at start" value={doc?.cash ?? 0}
                   onChange={e => setDoc(d => ({ ...d, cash: +e.target.value }))} />
          </label>
        </div>
      </div>

      {msg && <p className="acct-row-s">{msg}</p>}
    </section>
  );
}
