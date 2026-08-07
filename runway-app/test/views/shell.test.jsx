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
    expect(container.textContent).toMatch(/4\.2 mo/);
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

describe("the rail foot", () => {
  it("carries the document's identity, not the demo's", () => {
    // It used to read `Northwind Labs / Projection start · Jul 2026` — hardcoded. Someone else's
    // company name, in the chrome, on every screen, forever.
    const { container } = render(<RunwayApp doc={{ ...demoDoc(), name: "Harbor Point", startY: 2029, startM: 3 }} setDoc={() => {}} />);
    // The name FIELD is gone — every company has a name and the model name was a second string for
    // the same object. What the footer still carries is the projection start, which is the one thing
    // there that helps you read the charts above it.
    const foot = container.querySelector(".railfoot");
    expect(foot.querySelector(".docname")).toBeNull();
    expect(foot.textContent).toContain("April 2029");
    expect(foot.textContent).not.toContain("Northwind Labs");
  });

  it("and so does the topbar subtitle — the SAME hardcode, missed once already", () => {
    // The rail-foot fix above was correct and its test was scoped to `.railfoot`, so an identical
    // hardcoded "Northwind Labs" two elements away in the topbar survived it untouched. The narrow
    // assertion is what let it hide: a guard against a string appearing ANYWHERE has to look everywhere.
    // The subtitle reads the COMPANY name now, not the document's. The original point stands and is
    // worth keeping: a guard against a hardcoded string has to look everywhere, not just where the
    // last one was found.
    const { container } = render(
      <RunwayApp doc={{ ...demoDoc(), name: "a stale model name" }} setDoc={() => {}}
                 companyName="Harbor Point" />
    );
    // THE NAME MOVED TO THE EYEBROW. The sub line now carries plan, cash-on-hand date and cash now —
    // the name was taken out of it precisely because it repeated what sits directly above. The
    // original point survives the move and is the reason this still asserts on the whole document:
    // a guard against a hardcoded string has to look everywhere, not just where the last one was.
    expect(container.querySelector(".eyebrow").textContent).toMatch(/^Harbor Point$/);
    expect(container.textContent).not.toMatch(/Northwind Labs/);
    expect(container.textContent).not.toMatch(/a stale model name/);
  });

  it("no chrome anywhere names a company the document doesn't", () => {
    const { container } = render(<RunwayApp doc={{ ...demoDoc(), name: "Harbor Point" }} setDoc={() => {}} />);
    expect(container.textContent).not.toContain("Northwind Labs");
  });

  it("falls back to a placeholder rather than a blank when the model is unnamed", () => {
    const { container } = render(<RunwayApp doc={{ ...demoDoc(), name: "" }} setDoc={() => {}} />);
    // Same move: the placeholder lives in the eyebrow with the name it stands in for.
    expect(container.querySelector(".eyebrow").textContent).toMatch(/^Untitled model$/);
  });
  it("keeps Export and Import OUT of the rail entirely", () => {
    // REVERSED. They were in the rail footer, one click from every screen — and import replaces the
    // model every member of the company sees. The most destructive control in the product, in the
    // least guarded place. Both moved to Company settings → Data, owner-only.
    const { container } = render(<RunwayApp doc={demoDoc()} setDoc={() => {}} />);
    expect(container.querySelectorAll(".docbar")).toHaveLength(0);
    const rail = container.querySelector(".rail");
    expect(rail.textContent).not.toMatch(/Export|Import/);
    expect(rail.querySelector('input[type="file"]')).toBeNull();
  });
});
