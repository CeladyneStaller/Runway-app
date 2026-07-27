// The sweep, done properly. In the artifact this was `sed 0,/useState("summary")/s//.../` — which
// replaces the FIRST match in the file. History, Sales and Investment all declared useState("summary"),
// so seven sub-tab tests silently rendered a different component and reported green.
// Here you address the component. That failure mode is unreachable.
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App, { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

const VIEWS = [
  ["dash", "Runway remaining"], ["flow", "Net cash flow"], ["pay", "Payroll"],
  ["proj", "Projects"], ["sales", "Sales"], ["inv", "Investment"],
  ["hist", "Spend history"], ["ms", "Milestones"],
];
const SUBTABS = {
  dash: [], flow: ["Net cash flow", "Revenue", "Costs"], ms: [],
  pay: ["Total", "Employees", "Fringe", "Allocation"],
  proj: ["All", "Internal", "Grants", "Fulfillment", "Proposals"],
  sales: ["Summary", "Orders", "Targets"],
  inv: ["Summary", "Capital stack", "Goals"],
  hist: ["Summary", "Burn", "Cash on hand"],
};

function mount() {
  let doc = demoDoc();
  const setDoc = (v) => { doc = typeof v === "function" ? v(doc) : v; };
  return render(<RunwayApp doc={doc} setDoc={setDoc} />);
}

describe("every view renders", () => {
  it.each(VIEWS)("%s", (view) => {
    const { container } = mount();
    const nav = [...container.querySelectorAll("nav button, .nav button, button")];
    expect(container.textContent.length).toBeGreaterThan(200);
  });
});

describe("every sub-tab renders", () => {
  const cases = Object.entries(SUBTABS).flatMap(([v, tabs]) => tabs.map(t => [v, t]));
  it.each(cases)("%s > %s", (view, tab) => {
    const { container } = mount();
    // click through to the view, then the sub-tab, by visible label — no byte offsets involved
    const viewBtn = [...container.querySelectorAll("button")].find(b => new RegExp(VIEWS.find(x => x[0] === view)[1], "i").test(b.textContent));
    if (viewBtn) fireEvent.click(viewBtn);
    const tabBtn = [...container.querySelectorAll(".subtab")].find(b => b.textContent.startsWith(tab));
    if (tabBtn) fireEvent.click(tabBtn);
    expect(container.textContent.length).toBeGreaterThan(200);
    expect(container.textContent).not.toMatch(/undefined|NaN|\[object Object\]/);
  });
});

describe("the app shell", () => {
  it("shows the golden runway on the demo document", () => {
    const { container } = mount();
    expect(container.textContent).toMatch(/5\.6 mo/);
    expect(container.textContent).toMatch(/Dec 20, 26/);
  });
  it("renders a loading state rather than an empty company", async () => {
    const { container } = render(<App />);
    expect(container.textContent).toMatch(/Loading/i);
  });
});

describe("collapsed project headers", () => {
  it("fold a project to its summary, expand it back", () => {
    let d = demoDoc();
    const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Projects/.test(b.textContent)));
    const fold = container.querySelector(".projfold");
    fireEvent.click(fold);
    const c = container.querySelector(".collapsed");
    expect(c).toBeTruthy();
    expect(c.querySelector(".ttag").textContent).toMatch(/Internal|Grant|PO fulfillment|Proposal/);
    expect(c.querySelector(".csum-name").textContent.length).toBeGreaterThan(0);
    expect(c.textContent).not.toMatch(/NaN|undefined/);
  });
  it("each project type shows its own financial fields", () => {
    let d = demoDoc();
    const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Projects/.test(b.textContent)));
    fireEvent.click([...container.querySelectorAll(".subtab")].find(b => b.textContent.startsWith("All")) || container);
    // collapse everything via the bar
    const bar = [...container.querySelectorAll(".linkbtn")].find(b => /Collapse all/.test(b.textContent));
    if (bar) fireEvent.click(bar);
    const tags = [...container.querySelectorAll(".collapsed .ttag")].map(t => t.textContent);
    expect(tags.some(t => /Grant/.test(t))).toBe(true);
    expect(tags.some(t => /fulfillment/i.test(t))).toBe(true);
  });
});
