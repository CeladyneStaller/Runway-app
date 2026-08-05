import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { CashFlow } from "../../src/views/CashFlow";
import { StartCtx } from "../../src/state/StartCtx";
import { buildProjection } from "../../src/engine/projection";
import { buildModelFromDoc } from "../../src/engine/buildmodel";
import { addManual } from "../../src/engine/commitments";
import { demoDoc } from "../../src/state/document";

afterEach(cleanup);
const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});

const draw = (doc, over = {}) => render(
  <StartCtx.Provider value={{ START_Y: doc.startY, START_M: doc.startM }}>
    <CashFlow doc={doc} rows={rowsOf(doc)} routeTab="costs" setRouteTab={() => {}}
              lines={doc.lines || []} setLines={() => {}} projWeeks={[]} projectCount={0}
              payrollMonthly={0} employees={doc.employees || []} setEmployees={() => {}}
              projects={doc.projects || []} setProjects={() => {}} saas={[]} {...over} />
  </StartCtx.Provider>);

const costs = (v) => {
  const b = [...v.container.querySelectorAll("button")].find(x => /^Costs$/.test(x.textContent));
  if (b) fireEvent.click(b);
  return v.container.textContent;
};

describe("commitments in the Costs sub-tab", () => {
  const base = demoDoc();

  it("lists an unpaid commitment", () => {
    const d = addManual(base, { label: "Pilot deposit", signedMonth: 0, payMonth: 3, amount: 188000 });
    expect(costs(draw(d))).toMatch(/Pilot deposit/);
  });

  it("SAYS THEY ALREADY MOVE THE CASH, so nobody reads it as a second charge", () => {
    // A promoted commitment references a line that was always in the plan; a manual one created its
    // own. Either way the money is already below. A reader who thinks this section adds to the
    // projection would conclude the runway is wrong.
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 3, amount: 1000 });
    expect(costs(draw(d))).toMatch(/already move the cash/i);
  });

  it("POINTS EDITING AT THE COMMITMENTS TAB", () => {
    // Two places to change one obligation is how the two disagree.
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 3, amount: 1000 });
    expect(costs(draw(d))).toMatch(/edit them on the Commitments tab/i);
  });

  it("offers no control that writes", () => {
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 3, amount: 1000 });
    const v = draw(d);
    costs(v);
    const labels = [...v.container.querySelectorAll("button")].map(b => b.textContent);
    expect(labels.some(t => /mark paid|remove|mark signed|add a commitment/i.test(t))).toBe(false);
  });

  it("does NOT list cost share here, because it is already in the project costs above", () => {
    // Showing the same money twice on ONE screen is worse than showing it twice across two. The Costs
    // tab already includes it inside the project cost lines; the Commitments tab lists it separately.
    const v = costs(draw(base));
    expect(v).not.toMatch(/cost share, period/i);
  });

  it("says when a commitment is not covered", () => {
    const d = addManual(base, { label: "Late", signedMonth: 0, payMonth: 9, amount: 400000 });
    expect(costs(draw(d))).toMatch(/not covered/i);
  });

  it("RENDERS WITHOUT `rows`, degrading to a date rather than throwing", () => {
    // Some render paths mount this view before the projection exists. A table missing its cover column
    // is better than a tab that does not render.
    const d = addManual(base, { label: "Bare", signedMonth: 0, payMonth: 3, amount: 1000 });
    expect(() => draw(d, { rows: undefined })).not.toThrow();
  });

  it("shows nothing at all when there are no commitments", () => {
    const bare = { ...base, projects: [], commitments: [] };
    expect(costs(draw(bare))).not.toMatch(/Signed and not yet paid/);
  });
});
