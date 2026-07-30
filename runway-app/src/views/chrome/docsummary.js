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

/** Runway in months, or null when the model never reaches zero inside the horizon.
 *
 *  ONE DEFINITION, used by `headline` below, the advisor portfolio and the scenario review screen. Any
 *  of those three could have projected a document itself in four lines — and then there would be four
 *  answers to "when do we run out", which is the number this entire product exists to state. */
export function runwayMonths(doc) {
  if (!doc) return null;
  try {
    const z = zeroInfo(buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {}),
                       doc.startY, doc.startM);
    return z ? z.months : null;
  } catch { return null; }
}

export function headline(doc) {
  if (!doc) return null;
  try {
    const m = runwayMonths(doc);
    return {
      runway: m == null ? `${HORIZON}+ mo` : `${m.toFixed(1)} mo`,
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
