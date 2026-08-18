import { describe, it, expect } from "vitest";
import { SHAPE_QUESTIONS, hiddenFromAnswers, stepsFor } from "../../src/engine/setupshape.js";
import { subtabsOf } from "../../src/state/tabprefs.js";

const hidden = (a) => hiddenFromAnswers(a, subtabsOf);

describe("⚠️ the wizard's shape questions", () => {
  it("never names a tab", () => {
    // If the wording only makes sense to somebody who has already seen the app, it is the wrong
    // wording — "do you want the Investment tab" fails this as badly as "do you take investment" fails
    // the relevance test.
    const words = SHAPE_QUESTIONS.flatMap(q => [q.q, ...(q.children || []).map(c => c.q)]).join(" ");
    for (const banned of ["tab", "Projects tab", "Sales tab", "Investment tab"]) {
      expect(words.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("⚠️ COMPUTES WHAT TO HIDE, NOT WHAT TO SHOW", () => {
    // A wizard producing a list of VISIBLE things would silently hide anything added to the app
    // afterwards — a tab shipped next month would be invisible to every company created before it.
    expect(hidden({ projects: true, internal: true, grants: true, preproduction: true,
                    sales: true, orders: true, subs: true, investment: true })).toEqual([]);
  });

  it("hides a whole tab when its parent is no", () => {
    const h = hidden({ sales: true, orders: true, subs: true });
    expect(h).toContain("proj");
    expect(h).toContain("inv");
  });

  it("⚠️ DOES NOT EMIT SUB-KEYS FOR A TAB THAT IS ALREADY HIDDEN", () => {
    // `preproduction` shows `sales:targets`, so somebody wanting pre-production but not sales would
    // otherwise get a stray key for a view that is hidden entirely — a row in the list that can never
    // be acted on.
    const h = hidden({ projects: true, internal: true, grants: true, sales: false });
    expect(h).toContain("sales");
    expect(h.filter(x => x.startsWith("sales:"))).toEqual([]);
  });

  it("⚠️ ONE QUESTION SHOWS FULFILLMENT AND TARGETS TOGETHER", () => {
    // Building something to sell is ONE activity the app models in two places. **Somebody who does it
    // needs both or neither**, and asking twice would let them end up with half.
    const off = hidden({ projects: true, internal: true, grants: true, preproduction: false,
                         sales: true, orders: true, subs: true, investment: true });
    expect(off).toContain("proj:fulfil");
    expect(off).toContain("sales:targets");
  });

  it("investment is one question for all three of its sub-tabs", () => {
    const h = hidden({ investment: false, projects: true, internal: true, grants: true,
                       preproduction: true, sales: true, orders: true, subs: true });
    expect(h).toContain("inv");
    expect(h.filter(x => x.startsWith("inv:"))).toEqual([]);
  });
});

describe("⚠️ the steps follow the answers", () => {
  it("SKIPS PROJECTS WHEN THERE ARE NONE", () => {
    // Corey's point, and the thing that makes this worth doing: **a wizard that asks about work you
    // have just said you do not do teaches people the questions were not listened to.**
    expect(stepsFor({ projects: false })).not.toContain("Projects");
    expect(stepsFor({ projects: true })).toContain("Projects");
  });

  it("shows Funding for grants OR investment, and neither otherwise", () => {
    expect(stepsFor({ grants: true })).toContain("Funding");
    expect(stepsFor({ investment: true })).toContain("Funding");
    expect(stepsFor({})).not.toContain("Funding");
  });

  it("always keeps Basics, the shape question, and People", () => {
    // Somebody must be able to name the company and say who is paid, whatever else they skip.
    for (const s of [{}, { projects: true, grants: true, investment: true }]) {
      expect(stepsFor(s).slice(0, 3)).toEqual(["Basics", "What to show", "People"]);
    }
  });
});
