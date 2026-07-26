// Turning setup answers into a document.
//
// Kept PURE and separate from the wizard view for the usual reason: the mapping from "what somebody
// typed" to "a document the engine will accept" is the part with rules in it, and rules deserve tests
// that don't need a DOM. The view collects strings; this decides what they mean.
//
// It lives in state/ rather than engine/ because it builds a DOCUMENT, and `src/engine/` is forbidden
// from importing state or seed data (enforced by oxlint's no-restricted-imports). The engine never
// sees a document — it takes plain arrays — and that seam is worth more than the tidiness of having
// every pure function in one folder.
import { emptyDoc } from "./document";
import { zeroInfo } from "../engine/projection";

const uid = () => crypto.randomUUID();

/** Everything arrives from text inputs, so "250,000", " 250000 " and "" all have to mean something.
 *  A blank is zero, not NaN — a NaN in `cash` propagates into every balance in the projection and the
 *  chart silently stops drawing. */
export const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const named = (rows) => (rows || []).filter(r => String(r?.name || "").trim());

/** Answers -> a document. Rows with no name are dropped: the wizard always shows one blank row for
 *  the next entry, and that blank row is not a person. */
export function docFromSetup(answers = {}) {
  const d = emptyDoc();
  const name = String(answers.name || "").trim();

  return {
    ...d,
    name: name || d.name,
    cash: num(answers.cash),

    // basis/start/end/raises/promotions are the shape payroll.js expects; the wizard doesn't ask about
    // any of them, so they take the same defaults a manually-added employee gets.
    employees: named(answers.employees).map(e => ({
      id: uid(),
      name: String(e.name).trim(),
      title: String(e.title || "").trim(),
      basis: "annual",
      // A BLANK SALARY IS ALLOWED and becomes 0. The wizard warns about it rather than blocking, so
      // somebody who doesn't have the figures to hand can still finish; a person on the payroll with
      // no cost is visible in the model and fixable later, which a person left out entirely is not.
      amount: num(e.salary),
      start: 0, end: null, raises: [], promotions: [],
    })),

    // `lines: []` matters — a project with no lines contributes nothing to the projection, which is
    // correct for a name-and-budget sketch. The budget is recorded so the project page has something
    // to reconcile against once real costs are coded to it.
    projects: named(answers.projects).map(p => ({
      id: uid(),
      type: ["internal", "grant", "fulfillment"].includes(p.type) ? p.type : "internal",
      name: String(p.name).trim(),
      budget: num(p.budget),
      start: 0, end: null,
      lines: [],
    })),

    rounds: named(answers.rounds).map(r => ({
      id: uid(),
      kind: ["safe", "note", "equity", "debt"].includes(r.kind) ? r.kind : "safe",
      name: String(r.name).trim(),
      // Status drives confidence tier via INST_CONF, so it is the field that decides whether this money
      // shows up in the base projection at all. Default "planning" = speculative = off by default,
      // which is the conservative direction to be wrong in.
      status: ["planning", "raising", "committed", "closed"].includes(r.status) ? r.status : "planning",
      amount: num(r.amount),
      closeMonth: 0,
      capType: "post", confAuto: true, goals: [],
    })),
  };
}

/** People entered without a salary. The wizard shows this as a warning on the way out — not a block. */
export const missingSalaries = (answers = {}) =>
  named(answers.employees).filter(e => num(e.salary) <= 0).map(e => String(e.name).trim());

/** Did they actually tell us anything? Used to decide whether finishing the wizard should write a
 *  document at all — an all-skipped wizard should leave the account as new as it found it. */
export const setupHasSubstance = (answers = {}) =>
  num(answers.cash) > 0
  || named(answers.employees).length > 0
  || named(answers.projects).length > 0
  || named(answers.rounds).length > 0;

/** What a projection says about how long the money lasts, in the four states worth distinguishing.
 *
 *  `zeroInfo` returns ONE null for TWO completely different situations, and the setup wizard used to
 *  label both of them "cash-positive": the money genuinely never runs out because revenue covers
 *  costs, or the money is running out and simply outlasts the 36 months modelled. Telling somebody
 *  who is burning steadily that they are cash-flow positive, purely because their pile is bigger than
 *  our window, is the kind of wrong answer that gets believed. The sign of the net flow in the final
 *  modelled month separates them.
 *
 *  A REAL ZERO DATE WINS over both. If the cash runs out at month 5, "cash-flow positive at month 30"
 *  is not the answer — you do not reach month 30.
 *
 *  Pure and here rather than inline in the view, because "positive" is currently unreachable from the
 *  wizard's own inputs (it collects no recurring revenue), and a rule that cannot be exercised through
 *  the UI still deserves to be exercised somewhere. */
export function classifyRunway(rows) {
  if (!rows || rows.length === 0) return null;
  const z = zeroInfo(rows);
  if (z && z.months != null) return { kind: "runway", months: z.months };
  const last = rows[rows.length - 1];
  if (!last) return null;
  if (last.cost <= 0) return { kind: "idle" };        // nothing modelled to burn it
  return last.net >= 0 ? { kind: "positive" } : { kind: "beyond" };
}
