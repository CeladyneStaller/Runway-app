// ── The legal documents, as one source ───────────────────────────────────────────────────────────
//
// ⚠️ THE MARKDOWN IN THIS FOLDER IS THE EXECUTED TEXT, converted once from the signed .docx. Both
// surfaces render THESE files — the public page and the in-app modal — because a modal fed by a
// separate copy will drift from the page, and the drift will be invisible until somebody quotes the
// wrong one back at you.
//
// ⚠️ AND THE VERSION LIVES HERE, NOT IN `plans.js`. It was `2026-08-04` there while the executed
// documents said `2026-08-12` — eight days apart, which would have recorded acceptances naming a
// version nobody was shown. **The number belongs beside the text it names.**

import terms from "./terms.md?raw";
import privacy from "./privacy.md?raw";

export const LEGAL_VERSION = "2026-08-12";

/** ⚠️ THE LAST VERSION WHOSE CHANGES WERE MATERIAL — not the current version.
 *
 *  Comparing an acceptance date against the document's modified date is the obvious design and it has
 *  a flaw worth avoiding: **a typo fix would re-prompt every customer.** Ask a few thousand people to
 *  re-accept because a comma moved and they stop reading the prompt, which is the opposite of what it
 *  is for.
 *
 *  So a bump to `LEGAL_VERSION` publishes a new document; a bump to THIS asks everybody again. Fixing a
 *  clause moves both. Fixing a spelling moves only the first.
 *
 *  ⚠️ IT IS ALSO A STRING COMPARISON, NOT DATE ARITHMETIC. These happen to be dates, but parsing a date
 *  to decide whether somebody is bound by an agreement invites a timezone bug in the one place nobody
 *  wants one.
 */
export const REACCEPT_FROM = "2026-08-12";
export const LEGAL_EFFECTIVE = "12 August 2026";

export const DOCS = Object.freeze({
  terms: {
    id: "terms", title: "Terms of Service", path: "/terms", body: terms,
    // ⚠️ SHOWN ABOVE THE TEXT, because the executed document puts them there. Burying a jury waiver at
    // section 13 and calling it disclosed is the kind of thing that gets a clause struck.
    warnings: [
      "Section 13 contains a jury waiver and a class action waiver.",
      "Section 11 limits our liability.",
      "Section 6 explains that Waterline is a modelling tool, not an adviser.",
    ],
  },
  privacy: {
    id: "privacy", title: "Privacy Policy", path: "/privacy", body: privacy,
    warnings: [
      "We do not sell or rent personal information and we never have.",
      "We do not use your data to train machine learning or AI models.",
    ],
  },
});

/** Section headings, for a table of contents built from the text rather than maintained beside it. */
export function sectionsOf(body) {
  return (body || "").split("\n")
    .filter(l => l.startsWith("## "))
    .map(l => {
      const t = l.slice(3).trim();
      const m = /^(\d+)\.\s*(.*)$/.exec(t);
      return { n: m ? m[1] : null, title: m ? m[2] : t, id: `s${m ? m[1] : t.slice(0, 8)}` };
    });
}

/** ⚠️ A SUPERSEDED VERSION MUST STAY REACHABLE. An acceptance record naming a version is worth nothing
 *  if that text is later overwritten in place — the record points at a document that has to still
 *  exist. Old versions live at `/terms/<version>` and are never deleted. */
export const versionedPath = (docId, version) =>
  version && version !== LEGAL_VERSION ? `${DOCS[docId].path}/${version}` : DOCS[docId].path;


/** Does this person need to accept again?
 *
 *  ⚠️ AN EMPTY OR MISSING ACCEPTANCE COUNTS AS STALE, and that is the case this exists for: every
 *  account created before the checkbox has a `terms_accepted_at` for terms nobody was shown. **That is
 *  worse than no record — it asserts something that did not happen** — and publishing does not fix
 *  rows already written.
 */
export function needsReacceptance(acceptedVersion) {
  if (!acceptedVersion) return true;
  return String(acceptedVersion) < REACCEPT_FROM;
}
