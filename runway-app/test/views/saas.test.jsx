// The subscription editor in the Revenue tab.
import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { emptyDoc } from "../../src/state/document";
import { blankSaas } from "../../src/engine/saas";

const openRevenue = (initial) => {
  function H() { const [d, setD] = useState(initial); return <RunwayApp doc={d} setDoc={setD} />; }
  const { container } = render(<H />);
  fireEvent.click([...container.querySelectorAll("button.nav")].find(b => /Cash flow/.test(b.textContent)));
  fireEvent.click([...container.querySelectorAll("button.subtab")].find(b => /^Revenue$/.test(b.textContent)));
  return container;
};
const btn = (c, re) => [...c.querySelectorAll("button")].find(b => re.test(b.textContent));
const withCash = (over = {}) => ({ ...emptyDoc(), cash: 300000, ...over });

describe("the subscription panel", () => {
  it("sits in the Revenue tab and says why it exists", () => {
    const c = openRevenue(withCash());
    expect(c.textContent).toMatch(/Subscription revenue/);
    expect(c.textContent).toMatch(/ceiling/i);
  });

  it("adds a book with all the fields the model needs", () => {
    const c = openRevenue(withCash());
    fireEvent.click(btn(c, /\+?\s*Subscription$/));
    expect(c.querySelector(".saas-card")).toBeTruthy();
    const labels = [...c.querySelectorAll(".saas-f span")].map(s => s.textContent);
    expect(labels).toContain("Customers now");
    expect(labels).toContain("Churn %/mo");
    expect(labels).toContain("New per month");
  });

  it("shows the steady state the churn implies", () => {
    // 20 adds against 10% churn is a 200-customer business, whatever the founder hoped.
    const c = openRevenue(withCash({ saas: [{ ...blankSaas(), arpu: 100, newPerMonth: 20, churnPct: 10 }] }));
    expect(c.textContent).toMatch(/Settles at/);
    expect(c.textContent).toMatch(/200 customers/);
  });

  it("warns when no churn was entered, because that is unbounded growth", () => {
    const c = openRevenue(withCash({ saas: [{ ...blankSaas(), arpu: 100, newPerMonth: 20, churnPct: 0 }] }));
    expect(c.textContent).toMatch(/grows without limit/i);
  });

  it("warns when nothing new is coming in, because that is decay", () => {
    const c = openRevenue(withCash({ saas: [{ ...blankSaas(), startCustomers: 80, arpu: 100, churnPct: 5 }] }));
    expect(c.textContent).toMatch(/decays to nothing/i);
  });

  it("counts subscription MRR in the recurring-revenue figure", () => {
    // Without this a pure-subscription company reads as zero recurring revenue, since the book
    // expands to per-month one-time lines.
    const c = openRevenue(withCash({ saas: [{ ...blankSaas(), startCustomers: 100, arpu: 250 }] }));
    expect(c.textContent).toMatch(/incl\. subscriptions/);
  });

  it("edits write through to the document", () => {
    let doc = withCash({ saas: [{ ...blankSaas(), id: "s1", arpu: 0 }] });
    function H() { const [d, setD] = useState(doc); doc = d; return <RunwayApp doc={d} setDoc={setD} />; }
    const { container } = render(<H />);
    fireEvent.click([...container.querySelectorAll("button.nav")].find(b => /Cash flow/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll("button.subtab")].find(b => /^Revenue$/.test(b.textContent)));
    const arpu = [...container.querySelectorAll(".saas-f")].find(f => /Revenue each/.test(f.textContent)).querySelector("input");
    fireEvent.change(arpu, { target: { value: "150" } });
    expect(doc.saas[0].arpu).toBe("150");
  });

  it("deletes cleanly", () => {
    const c = openRevenue(withCash({ saas: [{ ...blankSaas(), arpu: 100 }] }));
    expect(c.querySelector(".saas-card")).toBeTruthy();
    fireEvent.click(c.querySelector('[aria-label="Delete subscription"]'));
    expect(c.querySelector(".saas-card")).toBeNull();
  });

  it("says nothing alarming when there are none", () => {
    const c = openRevenue(withCash());
    expect(c.textContent).toMatch(/No subscription products yet/);
    expect(c.querySelector(".saas-card")).toBeNull();
  });
});

describe("recording MRR against a book", () => {
  const withRec = (actuals, over = {}) => withCash({
    saas: [{ ...blankSaas(), id: "s1", startCustomers: 100, arpu: 100, actuals, ...over }],
  });

  it("invites a record and explains what it does", () => {
    const c = openRevenue(withRec({}));
    expect(c.textContent).toMatch(/Recorded MRR/);
    expect(c.textContent).toMatch(/stop being a forecast/i);
  });

  it("shows each record against what was projected, and the gap", () => {
    const c = openRevenue(withRec({ 0: 8000 }));
    expect(c.textContent).toMatch(/vs \$10,000 projected/);
    expect(c.textContent).toMatch(/−\$2,000/);
  });

  it("says 'on plan' rather than a zero when they agree", () => {
    const c = openRevenue(withRec({ 0: 10000 }));
    expect(c.textContent).toMatch(/on plan/);
  });

  it("names the customer count the billing implies", () => {
    const c = openRevenue(withRec({ 0: 8000 }));
    expect(c.textContent).toMatch(/implies/i);
    expect(c.textContent).toMatch(/80/);
    expect(c.textContent).toMatch(/built on the wrong base/i);
  });

  it("offers re-basing only when the record disagrees with the model", () => {
    // Re-basing changes the FORECAST, so it is a decision — never a side effect of recording.
    expect(btn(openRevenue(withRec({ 0: 8000 })), /Re-base forecast/)).toBeTruthy();
    expect(btn(openRevenue(withRec({ 0: 10000 })), /Re-base forecast/)).toBeFalsy();
  });

  it("re-basing rewrites the book from what was billed", () => {
    let doc = withRec({ 2: 5000 }, { newPerMonth: 0, churnPct: 0 });
    function H() { const [d, setD] = useState(doc); doc = d; return <RunwayApp doc={d} setDoc={setD} />; }
    const { container } = render(<H />);
    fireEvent.click([...container.querySelectorAll("button.nav")].find(b => /Cash flow/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll("button.subtab")].find(b => /^Revenue$/.test(b.textContent)));
    fireEvent.click(btn(container, /Re-base forecast/));
    expect(doc.saas[0].start).toBe(2);
    expect(doc.saas[0].startCustomers).toBeCloseTo(50, 6);
  });

  it("records write through to the document", () => {
    let doc = withRec({ 0: 0 });
    function H() { const [d, setD] = useState(doc); doc = d; return <RunwayApp doc={d} setDoc={setD} />; }
    const { container } = render(<H />);
    fireEvent.click([...container.querySelectorAll("button.nav")].find(b => /Cash flow/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll("button.subtab")].find(b => /^Revenue$/.test(b.textContent)));
    fireEvent.change(container.querySelector('[aria-label="Recorded MRR for month 0"]'), { target: { value: "7500" } });
    expect(doc.saas[0].actuals[0]).toBe("7500");
  });

  it("a record can be removed again", () => {
    let doc = withRec({ 0: 8000 });
    function H() { const [d, setD] = useState(doc); doc = d; return <RunwayApp doc={d} setDoc={setD} />; }
    const { container } = render(<H />);
    fireEvent.click([...container.querySelectorAll("button.nav")].find(b => /Cash flow/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll("button.subtab")].find(b => /^Revenue$/.test(b.textContent)));
    fireEvent.click(container.querySelector('[aria-label="Remove record for month 0"]'));
    expect(doc.saas[0].actuals).toEqual({});
  });
});

describe("the variance reaches the flag panel the rest of the app uses", () => {
  it("a subscription gap appears in Spend history alongside project gaps", () => {
    // One place to look, not two — subscription variances carry a `label` because they have no
    // project whose name the table could resolve.
    const doc = withCash({ saas: [{ ...blankSaas(), name: "Pro plan", startCustomers: 100, arpu: 100, actuals: { 0: 8000 } }] });
    function H() { const [d, setD] = useState(doc); return <RunwayApp doc={d} setDoc={setD} />; }
    const { container } = render(<H />);
    fireEvent.click([...container.querySelectorAll("button.nav")].find(b => /Spend history/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll("button.subtab")].find(b => /^Ledger$/.test(b.textContent)));
    expect(container.textContent).toMatch(/Recorded revenue differs from projection/);
    expect(container.textContent).toMatch(/Pro plan/);
  });
});

describe("month labels are real dates", () => {
  it("names the actual month, not a transposed one", () => {
    // `monthLabel(y, m, idx)` — this panel had the arguments in the wrong order and rendered
    // "May 2" where it meant "Oct 26". The old tests asserted the ROWS existed but never their text,
    // which is exactly how a label bug survives a green suite.
    const doc = withCash({ startY: 2026, startM: 6, saas: [{ ...blankSaas(), start: 3, arpu: 100, startCustomers: 10, actuals: { 3: 900 } }] });
    const c = openRevenue(doc);
    expect(c.querySelector(".saas-rec-m").textContent).toBe("Oct 26");
    expect(c.textContent).toMatch(/Starts Oct 26/);
  });
});
