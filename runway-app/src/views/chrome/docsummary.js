// Four numbers a person recognises, for the two places the app has to ask "which of these documents do
// you mean": resolving a conflict, and adopting a model left in this browser. Shared because the
// question is the same, and two drifting copies of "what does this document contain" would be a bug
// waiting to happen.
import { buildModelFromDoc } from "../../engine/buildmodel";
import { buildProjection, zeroInfo } from "../../engine/projection";
import { HORIZON } from "../../engine/time";
import { moneyFull } from "../../engine/money";

export const SUMMARY_ROWS = [
  ["Runway", "runway"],
  ["Cash on hand", "cash"],
  ["People", "people"],
  ["Projects, orders & lines", "lines"],
  ["Last saved", "saved"],
];

export function headline(doc) {
  if (!doc) return null;
  try {
    const rows = buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {});
    const z = zeroInfo(rows, doc.startY, doc.startM);
    return {
      runway: z ? `${z.months.toFixed(1)} mo` : `${HORIZON}+ mo`,
      cash: moneyFull(doc.cash || 0),
      people: (doc.employees || []).length,
      lines: (doc.lines || []).length + (doc.projects || []).length + (doc.pos || []).length,
      saved: doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : "unknown",
    };
  } catch {
    return null;   // an unreadable document is better summarised as nothing than as a crash
  }
}

/** Is there enough here to be worth asking about? An empty shell is not worth a dialog. */
export const hasSubstance = (doc) =>
  !!doc && ((doc.cash || 0) > 0
    || (doc.employees || []).length > 0
    || (doc.lines || []).length > 0
    || (doc.projects || []).length > 0
    || (doc.history || []).length > 0);
