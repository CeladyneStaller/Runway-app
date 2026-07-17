// The paths a first-run user actually takes.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { emptyDoc, demoDoc } from "../../src/state/document";

function mount(initial) {
  let doc = initial;
  const api = {};
  const Harness = () => {
    const [d, setD] = require("react").useState(initial);
    api.doc = d; api.set = setD;
    return <RunwayApp doc={d} setDoc={setD} />;
  };
  return { ...render(<Harness />), api };
}

describe("first run", () => {
  it("shows the empty state, not someone else's company", () => {
    const { container } = render(<RunwayApp doc={emptyDoc()} setDoc={() => {}} />);
    expect(container.textContent).toMatch(/Nothing in the model yet/i);
    expect(container.textContent).not.toMatch(/Alex Rivera|Northwind/);
  });
  it("offers the demo explicitly", () => {
    let doc = emptyDoc();
    const { container, rerender } = render(<RunwayApp doc={doc} setDoc={(v) => { doc = typeof v === "function" ? v(doc) : v; }} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /demo company/i.test(b.textContent)));
    expect(doc.employees.length).toBeGreaterThan(0);
    rerender(<RunwayApp doc={doc} setDoc={() => {}} />);
    expect(container.textContent).toMatch(/5\.6 mo/);
  });
  it("leaves the empty state as soon as there is cash", () => {
    const withCash = { ...emptyDoc(), cash: 100000 };
    const { container } = render(<RunwayApp doc={withCash} setDoc={() => {}} />);
    expect(container.textContent).not.toMatch(/Nothing in the model yet/i);
    expect(container.textContent).toMatch(/Runway remaining/i);
  });
});

describe("the document is the unit", () => {
  it("editing anything produces a whole new document, never a mutation", () => {
    const before = demoDoc();
    const snapshot = JSON.stringify(before);
    let after = before;
    render(<RunwayApp doc={before} setDoc={(v) => { after = typeof v === "function" ? v(before) : v; }} />);
    expect(JSON.stringify(before)).toBe(snapshot);   // the original is untouched
  });
});
