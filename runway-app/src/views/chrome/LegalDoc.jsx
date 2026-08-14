import { useState } from "react";
import { DOCS, LEGAL_VERSION, LEGAL_EFFECTIVE, sectionsOf } from "../../legal";

/** The document text, rendered from the markdown in `src/legal`.
 *
 *  ⚠️ ONE RENDERER FOR BOTH SURFACES. The public page and the modal show the SAME component over the
 *  SAME file — a modal fed by a separate copy drifts from the page, and the drift stays invisible until
 *  somebody quotes the wrong one back at you.
 */
export function LegalBody({ doc, compact = false }) {
  const d = DOCS[doc];
  if (!d) return null;
  const lines = (d.body || "").split("\n");
  const out = [];
  let n = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    n += 1;
    if (l.startsWith("## ")) {
      const m = /^(\d+)\./.exec(l.slice(3));
      out.push(<h3 key={n} id={m ? `s${m[1]}` : undefined} className="lgl-h">{l.slice(3)}</h3>);
    } else if (l.startsWith("### ")) {
      out.push(<h4 key={n} className="lgl-h4">{l.slice(4)}</h4>);
    } else if (l.startsWith("# ")) {
      if (!compact) out.push(<p key={n} className="lgl-sub">{l.slice(2)}</p>);
    } else {
      // ⚠️ ALL-CAPS PARAGRAPHS STAY ALL-CAPS. They are conspicuous in the executed document on purpose —
      // several disclaimers are only enforceable if they are conspicuous, so a renderer that
      // sentence-cases them for tidiness is weakening the clause.
      out.push(<p key={n} className={l === l.toUpperCase() && l.length > 40 ? "lgl-p lgl-caps" : "lgl-p"}>{l}</p>);
    }
  }
  return <div className={compact ? "lgl compact" : "lgl"}>{out}</div>;
}

/** The warnings the executed document places ABOVE the text. */
export const LegalWarnings = ({ doc }) => (
  <div className="lgl-warn">{(DOCS[doc]?.warnings || []).map((w, i) => <p key={i}>{w}</p>)}</div>
);

/**
 * ⚠️ A MODAL, NOT A LINK, IN THE SIGN-UP FLOW. A link navigates away and throws out a half-typed email
 * and password — so people either do not read it or lose their work. Closing this returns to a form with
 * everything still in it, which is the whole reason it exists.
 */
export function LegalModal({ doc, onClose }) {
  const d = DOCS[doc];
  if (!d) return null;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card lgl-modal" role="dialog" aria-label={d.title}
           onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span className="modal-t">{d.title}</span>
          <span className="meta">Version {LEGAL_VERSION}</span>
        </div>
        <div className="modal-b lgl-scroll">
          <LegalWarnings doc={doc} />
          <LegalBody doc={doc} compact />
        </div>
        <div className="modal-f">
          {/* ⚠️ NOT OPTIONAL. People are entitled to keep a copy, and a modal they cannot print or save
              is a document they cannot retain. It points at the same public URL, which is what makes
              "one source, two surfaces" true rather than aspirational. */}
          <a className="addbtn ghost" href={d.path} target="_blank" rel="noreferrer">Open in a new tab</a>
          <span className="meta" style={{ marginRight: "auto" }}>Effective {LEGAL_EFFECTIVE}</span>
          <button className="addbtn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** The public page — for somebody who has NOT signed up.
 *
 *  ⚠️ THIS IS WHY A MODAL CANNOT BE THE ONLY SURFACE. University and national-lab procurement reviews
 *  terms BEFORE an account exists; that is how those institutions buy. A modal-only approach means the
 *  person who must approve the software cannot read it without creating an account.
 */
export function LegalPage({ doc }) {
  const d = DOCS[doc];
  const [open, setOpen] = useState(null);
  if (!d) return null;
  const secs = sectionsOf(d.body);
  return (
    <div className="lgl-page">
      <nav className="lgl-toc">
        {secs.map(s => (
          <a key={s.id} href={`#${s.id}`}>{s.n ? `${s.n} · ` : ""}{s.title}</a>
        ))}
      </nav>
      <div>
        <h2 className="lgl-title">{d.title}</h2>
        <div className="lgl-meta">
          Version {LEGAL_VERSION} · Effective {LEGAL_EFFECTIVE} · Waterline Technology Co.
        </div>
        <LegalWarnings doc={doc} />
        <LegalBody doc={doc} />
        <div className="lgl-foot">
          <span>Superseded versions are kept and dated.</span>
          <button className="linkbtn" onClick={() => setOpen(doc === "terms" ? "privacy" : "terms")}>
            Read the {doc === "terms" ? "Privacy Policy" : "Terms of Service"}
          </button>
        </div>
      </div>
      {open && <LegalModal doc={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
