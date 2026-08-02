// Company settings → Data. Export and import, for this company.
//
// COMPANY-SCOPED, NOT PERSONAL, and owner-only. Importing replaces the model every member of this
// company sees, so it belongs on a page whose title already says whose model is at risk. The
// alternative — a company picker on a page called "Your data" — puts the most destructive action in
// the product behind a heading that is actively misleading about its blast radius.
//
// EXPORT IS ALSO OWNER-ONLY, and that is a decision worth naming rather than assuming. An export is a
// complete copy of the company's payroll, grants and cash position; a viewer who can read it on screen
// is not the same as a viewer who can walk out with the file. If that proves too strict in practice it
// is one line to relax.
import React, { useRef, useState } from "react";

export function CompanyData({ company, doc, onExport, onImport, canWrite }) {
  const file = useRef(null);
  const [pending, setPending] = useState(null);
  const [msg, setMsg] = useState(null);

  const counts = {
    projects: (doc?.projects || []).length,
    people: (doc?.employees || []).length,
    months: (doc?.history || []).length,
    milestones: (doc?.milestones || []).length,
  };

  const chosen = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";                 // so choosing the same file twice still fires
    if (f) { setPending(f); setMsg(null); }
  };

  const confirm = async () => {
    try { await onImport(pending); setPending(null); }
    catch (err) { setMsg(err?.message || "That file could not be read as a Waterline document."); }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <div>
            <h3>Export</h3>
            <p>
              A JSON file you own, on a disk you own. It is also the migration test — export before a
              schema change, import after, and confirm the runway has not moved.
            </p>
          </div>
        </div>
        <div className="acct-row">
          <div>
            <div className="acct-row-t">{company?.name || "This company"}</div>
            <div className="acct-row-s">
              {counts.projects} projects · {counts.people} people · {counts.months} months of history
              · {counts.milestones} milestones
            </div>
          </div>
          <div className="acct-row-a">
            <button className="addbtn ghost" onClick={onExport}>Export</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <div>
            <h3>Import</h3>
            <p>Replaces this company's entire model with the contents of a file.</p>
          </div>
        </div>

        <div className="acct-row">
          <div>
            <div className="acct-row-t">Choose a file</div>
            <div className="acct-row-s">
              A Waterline export of any version — older ones are migrated forward on load
            </div>
          </div>
          <div className="acct-row-a">
            <input type="file" accept="application/json,.json" ref={file}
                   style={{ display: "none" }} onChange={chosen} />
            <button className="addbtn ghost" disabled={!canWrite} onClick={() => file.current?.click()}>
              Choose file…
            </button>
          </div>
        </div>

        {/* THE COUNTS ARE THE WARNING. "This will replace your model" is a sentence people click past;
            "6 projects, 9 people and 14 months of history" is the same fact in a form that makes
            somebody stop and check they meant it. */}
        {pending && (
          <div className="acct-warnbox">
            <b>This replaces everything in {company?.name || "this company"}.</b>{" "}
            {counts.projects} projects, {counts.people} people&rsquo;s payroll, {counts.months} months
            of history and {counts.milestones} milestones are overwritten, for everybody here.
            <div className="members-form">
              <button className="addbtn" onClick={confirm}>Replace the model</button>
              <button className="linkbtn" onClick={() => setPending(null)}>Cancel</button>
              <span className="acct-row-s" style={{ marginLeft: "auto" }}>
                {pending.name}
              </span>
            </div>
          </div>
        )}

        {msg && <p className="acct-row-s acct-warn">{msg}</p>}
      </section>
    </>
  );
}
