import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Commitments } from "../../src/views/Commitments";
import { buildProjection } from "../../src/engine/projection";
import { buildModelFromDoc } from "../../src/engine/buildmodel";
import { addManual, promote } from "../../src/engine/commitments";
import { demoDoc } from "../../src/state/document";

afterEach(cleanup);
const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
const draw = (doc, over = {}) =>
  render(<Commitments doc={doc} setDoc={() => {}} rows={rowsOf(doc)} {...over} />);

describe("the Commitments tab", () => {
  const base = demoDoc();

  it("EXPLAINS THE CONCEPT when empty", () => {
    // Unlike every other tab, this one is not populated by using the product normally. Somebody
    // arriving has to be told what belongs in it before they can put anything in it.
    //
    // Needs a model with NO AWARDS: the demo carries a derived cost-share obligation now, so it is
    // never truly empty — which is the cost-share feature working, not this test failing.
    const v = draw({ ...base, projects: [], commitments: [] });
    expect(v.container.textContent).toMatch(/Nothing signed yet/);
    expect(v.container.textContent).toMatch(/agreed to pay and have not paid/);
  });

  it("shows the obligation and what it is short by", () => {
    const d = addManual(base, { label: "Pilot deposit", signedMonth: 0, payMonth: 7, amount: 188000 });
    const v = draw(d);
    expect(v.container.textContent).toMatch(/Pilot deposit/);
    expect(v.container.textContent).toMatch(/short/);
  });

  it("says covered runway as a number comparable to runway", () => {
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 1, amount: 188000 });
    const v = draw(d);
    expect(v.container.textContent).toMatch(/Covered runway/);
    expect(v.container.textContent).toMatch(/\d\.\d mo/);
  });

  it("offers planned lines for promotion, and says promoting moves no cash", () => {
    // The panel that makes the tab populate itself.
    const d = { ...base, lines: [...(base.lines || []),
      { id: "l_x", label: "Membrane rig", cadence: "onetime", kind: "cost", amount: 64000, start: 3 }] };
    const v = draw(d);
    expect(v.container.textContent).toMatch(/Ready to promote/);
    expect(v.container.textContent).toMatch(/Membrane rig/);
    expect(v.container.textContent).toMatch(/changes no cash/);
  });

  it("promotes without duplicating the cost", () => {
    const d = { ...base, lines: [...(base.lines || []),
      { id: "l_x", label: "Rig", cadence: "onetime", kind: "cost", amount: 64000, start: 3 }] };
    let held = d;
    const v = render(<Commitments doc={d} setDoc={(fn) => { held = fn(d); }} rows={rowsOf(d)} />);
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /Mark signed/.test(b.textContent)));
    expect(held.commitments).toHaveLength(1);
    expect(held.lines).toHaveLength(d.lines.length);      // no second line
  });

  it("hides every writing control from a viewer", () => {
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 2, amount: 1000 });
    const v = draw(d, { canWrite: false });
    expect(v.container.textContent).not.toMatch(/Mark paid|Add\b|Mark signed/);
  });

  it("uses classes the stylesheet defines", () => {
    // The unstyled-advisor-portfolio failure: correct structure, correct data, no class matched.
    const { readFileSync } = require("node:fs");
    const css = readFileSync("src/styles.css", "utf8");
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 2, amount: 1000 });
    const v = draw(d);
    const used = new Set();
    v.container.querySelectorAll("[class]").forEach(el =>
      String(el.getAttribute("class")).split(/\s+/).filter(Boolean).forEach(c => used.add(c)));
    const missing = [...used].filter(c => !new RegExp("\\." + c + "[\\s{,:.]").test(css));
    expect(missing, `not in styles.css: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("pulling unpaid bills", () => {
  const base = demoDoc();
  const account = (grid) => ({ qboSync: vi.fn().mockResolvedValue({ grid }) });
  const payGrid = {
    headers: ["Tx Date", "Doc Num", "Vendor", "Due Date", "Open Balance"],
    rows: [["2026-07-12", "B-1001", "Bruker", "2026-09-30", "42,000"]],
  };

  it("offers the pull only with an account behind it", () => {
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 2, amount: 1000 });
    const without = draw(d);
    expect(without.container.textContent).not.toMatch(/Pull unpaid bills/);
    cleanup();
    const withIt = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)}
                                       account={account(payGrid)} companyId="co-1" />);
    expect(withIt.container.textContent).toMatch(/Pull unpaid bills/);
  });

  it("lists what came back WITHOUT writing any of it", async () => {
    // An import that silently added obligations would change a company's runway on the strength of a
    // report nobody had read.
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 2, amount: 1000 });
    const setDoc = vi.fn();
    const v = render(<Commitments doc={d} setDoc={setDoc} rows={rowsOf(d)}
                                  account={account(payGrid)} companyId="co-1" />);
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /Pull unpaid/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/Bruker/));
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("SAYS it is invoiced obligations only", async () => {
    // A bill is raised when an invoice arrives; a commitment begins when you sign. An empty list read
    // as "nothing outstanding" would be worse than not importing at all.
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 2, amount: 1000 });
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)}
                                  account={account(payGrid)} companyId="co-1" />);
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /Pull unpaid/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/not yet invoiced/i));
  });

  it("says so when the pull fails, rather than showing an empty list", async () => {
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 2, amount: 1000 });
    const bad = { qboSync: vi.fn().mockRejectedValue(new Error("payables 403")) };
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)}
                                  account={bad} companyId="co-1" />);
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /Pull unpaid/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/payables 403/));
  });
});
