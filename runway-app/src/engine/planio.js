// ── Appendix E in and out ────────────────────────────────────────────────────────────────────────
//
// IMPORT MATTERS MORE THAN EXPORT. Nobody starts a project in this app — they start it in a proposal,
// where the milestone table is already written and already agreed. A product that can read it inherits
// a populated schedule; one that cannot asks somebody to retype twenty rows.

import { appendixERows, quarterOf } from "./plan.js";

export const APPENDIX_E_HEADERS = [
  "Task Number or Subtask Number",
  "Task Title or Subtask Title (If Applicable)",
  "Milestone Type (Milestone or Go/No-Go Decision Point)",
  "Milestone Number (Go/No-Go Decision Point Number)",
  "Milestone Description (Go/No-Go Decision Criteria)",
  "Milestone Verification Process (What, How, Who, Where)",
  "Anticipated Date (Months from Start of the Project)",
  "Anticipated Quarter (Quarters from Start of the Project)",
];

/** Tab-separated, which is what pastes into Word and Excel as a table. */
export function planToTSV(project) {
  const rows = appendixERows(project);
  const body = rows.map(r => [r.taskNumber, r.title, r.type, r.milestoneNumber,
                              r.description, r.verification, r.month, r.quarter]
    // A TAB OR NEWLINE INSIDE A CELL WOULD SPLIT THE ROW. Verification text is free prose and people
    // paste line breaks into it constantly.
    .map(v => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim()).join("\t"));
  return [APPENDIX_E_HEADERS.join("\t"), ...body].join("\n");
}

// ── import ───────────────────────────────────────────────────────────────────────────────────────

/** Which of our fields a pasted column is. Matched by CONTENT, not position.
 *
 *  Recipients reorder columns, drop the quarter, and rename headings. Matching on distinctive words
 *  rather than on an exact string means a table that has been through three proposals still lands.
 */
const COLUMN_PATTERNS = [
  ["number",       /task\s*(number|no|#)|subtask\s*(number|no|#)|^wbs|^task$|^no\.?$|^#$/i],
  ["title",        /title|task\s*name|deliverable|description of task/i],
  ["type",         /milestone\s*type|^type$|go\s*\/?\s*no[- ]?go\s*(point|type)?$/i],
  ["label",        /milestone\s*(number|no|#|id)|^m\s*#|decision\s*point\s*number/i],
  ["description",  /milestone\s*description|decision\s*criteria|^description$|criteria/i],
  ["verification", /verification|what.*how.*who|evidence/i],
  ["month",        /month|anticipated\s*date|^date$/i],
  ["quarter",      /quarter|^q$/i],
];

export function matchColumns(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const clean = String(h || "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    for (const [field, re] of COLUMN_PATTERNS) {
      // FIRST MATCH WINS PER FIELD. "Milestone Description" matches both `title` and `description`
      // patterns; taking the first unclaimed field in pattern order puts it where the form puts it.
      if (map[field] === undefined && re.test(clean)) { map[field] = i; break; }
    }
  });
  return map;
}

const TYPE_OF = (s) => {
  const v = String(s || "").toLowerCase();
  if (/go\s*\/?\s*no/.test(v)) return "gate";
  if (/milestone/.test(v)) return "milestone";
  if (/task|subtask/.test(v)) return "task";
  return null;
};

/** Parse a pasted table into draft entries.
 *
 *  ⚠️ NOTHING IS DROPPED. A row with no date, no type, or an unreadable number is still work somebody
 *  wrote down — losing it because a cell was blank produces a table that does not match the one they
 *  filed, and they will not notice until an agency does. Every problem is reported per row instead.
 */
export function parsePlanPaste(text) {
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [], map: {}, error: "Needs a header row and at least one row." };

  const split = (l) => (l.includes("\t") ? l.split("\t") : l.split(/\s*\|\s*/)).map(c => c.trim());
  const headers = split(lines[0]);
  const map = matchColumns(headers);
  if (map.title === undefined && map.description === undefined) {
    return { headers, rows: [], map, error: "No title or description column found." };
  }

  const at = (cells, f) => (map[f] === undefined ? "" : (cells[map[f]] || "").trim());
  const rows = lines.slice(1).map((l, i) => {
    const c = split(l);
    const notes = [];

    let kind = TYPE_OF(at(c, "type"));
    if (!kind) {
      // INFERRED FROM THE NUMBER'S DEPTH, which is the form's own convention: 1.1 is a target, 1.1.1
      // is the work beneath it.
      const depth = String(at(c, "number")).split(".").filter(Boolean).length;
      kind = depth >= 3 ? "task" : "milestone";
      notes.push(`type not given — read as ${kind}`);
    }

    const rawMonth = at(c, "month");
    let month = null;
    if (/^\d+$/.test(rawMonth)) month = +rawMonth;
    else if (/^q\s*(\d+)$/i.test(rawMonth)) {
      // ⚠️ A QUARTER IS NOT A MONTH. Appendix E has both columns and recipients fill in whichever their
      // proposal used. Guessing silently would put a gate up to two months from where it belongs.
      month = (+/^q\s*(\d+)$/i.exec(rawMonth)[1] - 1) * 3;
      notes.push(`quarter, not month — read as month ${month}`);
    } else if (/^q\s*(\d+)$/i.test(at(c, "quarter")) && !rawMonth) {
      month = (+/^q\s*(\d+)$/i.exec(at(c, "quarter"))[1] - 1) * 3;
      notes.push(`no month column — derived month ${month} from ${at(c, "quarter")}`);
    } else if (rawMonth) {
      notes.push(`month "${rawMonth}" not understood`);
    } else {
      notes.push("no date — it will not appear on the timeline until you give it one");
    }

    return {
      i, kind,
      number: at(c, "number"),
      title: at(c, "title") || at(c, "description").slice(0, 80),
      label: kind === "task" ? null : at(c, "label"),
      description: at(c, "description"),
      verification: at(c, "verification"),
      month, notes,
    };
  });
  return { headers, rows, map, error: null };
}

/** Turn accepted drafts into plan entries, re-parenting tasks to the target above them. */
export function draftsToPlan(drafts) {
  const out = [];
  let lastTarget = null;
  for (const d of drafts) {
    const id = `pl_${Math.random().toString(36).slice(2, 9)}`;
    const isTask = d.kind === "task";
    // A TASK BELONGS TO THE TARGET ABOVE IT IN THE PASTE, which is the order the form prints. Matching
    // on the number prefix instead would break the moment somebody's numbering is inconsistent — and
    // it usually is, because these tables are edited by hand across years.
    if (!isTask) lastTarget = id;
    out.push({
      id, kind: d.kind, parentId: isTask ? lastTarget : null,
      number: d.number || "", label: d.label || null,
      title: d.title || "", description: d.description || "",
      verification: d.verification || "",
      month: Number.isFinite(d.month) ? d.month : 0,
      outcome: null, status: "not-started",
    });
  }
  return out;
}

export { quarterOf };
