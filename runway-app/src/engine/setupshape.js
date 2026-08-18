// ── What a company says it does, and what that shows ─────────────────────────────────────────────
//
// ⚠️ THE QUESTIONS ASK ABOUT RELEVANCE, NOT ABOUT BUSINESS FACTS. Corey's framing, and it is better
// than the one I proposed: somebody can take investment and still not want to model it here. "Do you
// take investment?" gets a truthful yes from a founder tracking their cap table in a spreadsheet, and
// hands them a tab they will never open. **"Is this part of your plan here" is the actual question.**
//
// No question names a tab. If the wording only makes sense to somebody who has already seen the app,
// it is the wrong wording.

export const SHAPE_QUESTIONS = Object.freeze([
  {
    id: "projects",
    q: "Do you do work that involves projects with specified line item budgets and timelines?",
    hint: "Work you track separately, with its own budget and dates.",
    shows: ["proj"],
    subs: { proj: ["all"] },
    children: [
      { id: "internal", q: "Do you have projects funded entirely by company funds?",
        subs: { proj: ["internal"] } },
      { id: "grants", q: "Do you have existing or proposed projects funded by grants?",
        subs: { proj: ["grants", "proposals"] } },
      // ⚠️ ONE QUESTION, TWO TABS. Building something to sell is ONE activity that the app models in
      // two places — Fulfillment under Projects and Targets under Sales. **Somebody who does this needs
      // both or neither**, and asking twice would let them end up with half of it.
      { id: "preproduction",
        q: "Are you now, or will you later, sell pre-production products that require development?",
        subs: { proj: ["fulfil"], sales: ["targets"] } },
    ],
  },
  {
    id: "sales",
    q: "Are you, or will you be, paid for products or services?",
    hint: "Money that comes from customers rather than funders.",
    shows: ["sales"],
    subs: { sales: ["summary"] },
    children: [
      { id: "orders", q: "Do you sell products or services on a purchase order basis?",
        subs: { sales: ["orders"] } },
      { id: "subs", q: "Does your product offer a subscription model?",
        subs: { sales: ["subs"] } },
    ],
  },
  {
    id: "investment",
    q: "Is debt or dilutive financing from investors part of your plan, now or later?",
    hint: "Rounds, SAFEs, notes, or a raise you are planning.",
    // ⚠️ ONE QUESTION FOR ALL THREE SUB-TABS, per Corey. Capital stack and Goals are not separately
    // meaningful to somebody who answered no — and to somebody who answered yes, being asked three
    // times about one activity reads as the form not listening.
    shows: ["inv"],
    subs: { inv: ["summary", "stack", "goals"] },
    children: [],
  },
]);

/** Everything a question can show, including its children's. */
const allOf = (q) => {
  const views = new Set(q.shows || []);
  const subs = {};
  const add = (map) => {
    for (const [v, ids] of Object.entries(map || {})) {
      subs[v] = [...new Set([...(subs[v] || []), ...ids])];
    }
  };
  add(q.subs);
  for (const c of q.children || []) add(c.subs);
  return { views: [...views], subs };
};

/**
 * Answers to the flat hidden list that `set_company_tabs` stores.
 *
 * ⚠️ IT COMPUTES WHAT TO HIDE, NOT WHAT TO SHOW. The registry is the source of what EXISTS; this only
 * subtracts. **A wizard that produced a list of visible things would silently hide anything added to
 * the app afterwards** — a tab shipped next month would be invisible to every company created before
 * it, which is the opposite of what a default should do.
 *
 * @param answers  { projects: bool, internal: bool, ... } — absent counts as NO
 * @param subtabsOf  (view) => [{ id }]
 */
export function hiddenFromAnswers(answers = {}, subtabsOf = () => []) {
  const hidden = [];
  for (const q of SHAPE_QUESTIONS) {
    const { views, subs } = allOf(q);
    if (!answers[q.id]) {
      // The whole tab is off: hide the views and say nothing about their sub-tabs. Hiding both would
      // put rows in the list that can never be acted on while the parent is off.
      hidden.push(...views);
      continue;
    }
    // The tab is on, so each child decides its own sub-tabs.
    for (const c of q.children || []) {
      if (answers[c.id]) continue;
      for (const [view, ids] of Object.entries(c.subs || {})) {
        for (const id of ids) hidden.push(`${view}:${id}`);
      }
    }
    // ⚠️ AND A SUB-TAB BELONGING TO A TAB THAT IS OFF MUST NOT BE HIDDEN TWICE. `preproduction` shows
    // `sales:targets`, so somebody who wants pre-production but not sales would otherwise get a stray
    // key for a view that is already hidden entirely.
    void subs;
  }
  // Sub-tab keys for views that are hidden outright are noise — drop them.
  const offViews = new Set(hidden.filter(h => !h.includes(":")));
  return [...new Set(hidden)].filter(h => !h.includes(":") || !offViews.has(h.split(":")[0]));
}

/**
 * Which wizard steps to show, given the answers.
 *
 * ⚠️ IF SOMEBODY WILL NOT SEE THE PROJECTS TAB, DO NOT ASK THEM ABOUT PROJECTS. Corey's point, and it
 * is the thing that makes this worth doing at all: **a wizard that asks about work you have just said
 * you do not do is worse than no wizard**, because it teaches people the questions were not listened
 * to.
 */
export function stepsFor(answers = {}) {
  const steps = ["Basics", "What to show", "People"];
  if (answers.projects) steps.push("Projects");
  // Funding covers grants and rounds — either answer earns it.
  if (answers.grants || answers.investment) steps.push("Funding");
  return steps;
}
