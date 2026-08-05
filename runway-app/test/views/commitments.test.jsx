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

  it("names the clean-exit date, in months, comparable with runway", () => {
    // Relabelled: it is the last point you could stop trading and pay everyone, not a second runway.
    const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 1, amount: 188000 });
    const v = draw(d);
    expect(v.container.textContent).toMatch(/Clean exit until/);
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

describe("the Grant cost share table", () => {
  const base = demoDoc();

  it("gets its own table, not a row among the signed obligations", () => {
    const v = draw(base);
    expect(v.container.textContent).toMatch(/Grant cost share/);
  });

  it("SAYS IT IS NOT OWED ON TOP OF THE PLAN", () => {
    // Listing it beside signed purchase orders implied a second call on the same cash. It is the part
    // of spending already happening that never comes back — a different fact entirely.
    expect(draw(base).container.textContent).toMatch(/not owed on top of your plan/i);
  });

  it("points at the award as the place to change it", () => {
    expect(draw(base).container.textContent).toMatch(/change the award/i);
  });

  it("offers no writing control, because there is nothing here to edit", () => {
    const v = draw(base, { canWrite: true });
    const rows = [...v.container.querySelectorAll("tr")]
      .filter(r => /cost share, period/i.test(r.textContent));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => expect(r.querySelectorAll("button").length).toBe(0));
  });
});

describe("the debt / planned badge", () => {
  const base = demoDoc();
  const withPay = (over = {}) => addManual(base,
    { label: "Bill", signedMonth: 0, payMonth: 3, amount: 1000, ...over });

  it("shows on a dated payment and toggles", () => {
    const d = withPay();
    let held = d;
    const v = render(<Commitments doc={d} setDoc={fn => { held = fn(d); }} rows={rowsOf(d)} />);
    const b = [...v.container.querySelectorAll("button")].find(x => /^debt$/i.test(x.textContent));
    expect(b).toBeTruthy();
    fireEvent.click(b);
    expect(held.commitments.find(c => c.label === "Bill").kind).toBe("planned");
  });

  it("IS NOT OFFERED on a closure fee", () => {
    // A lease break exists BECAUSE you closed. Calling it a cost you would avoid by closing is a
    // contradiction, and a control that lets somebody express one will eventually be used to.
    const d = withPay({ payMonth: null, label: "Lease break" });
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)} />);
    const row = [...v.container.querySelectorAll("tr")].find(r => /Lease break/.test(r.textContent));
    expect(row.textContent).toMatch(/debt/i);
    expect([...row.querySelectorAll("button")].some(b => /^debt$|^planned$/i.test(b.textContent))).toBe(false);
  });

  it("says what the badge does to the number", () => {
    // A control that silently changes a headline figure is how somebody ends up mistrusting the figure
    // rather than the control.
    const d = withPay({ kind: "planned" });
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)} />);
    const b = [...v.container.querySelectorAll("button")].find(x => /^planned$/i.test(x.textContent));
    expect(b.getAttribute("title")).toMatch(/clean-exit/i);
  });

  it("a viewer sees the badge and cannot change it", () => {
    const d = withPay();
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)} canWrite={false} />);
    const b = [...v.container.querySelectorAll("button")].find(x => /^debt$/i.test(x.textContent));
    expect(b.disabled).toBe(true);
  });

  it("the headline says clean exit, not covered runway", () => {
    // The two dates answer different questions and the interface must not imply they are rivals.
    const v = render(<Commitments doc={withPay()} setDoc={() => {}} rows={rowsOf(withPay())} />);
    expect(v.container.textContent).toMatch(/Clean exit until/);
    expect(v.container.textContent).not.toMatch(/Covered runway/);
  });
});

describe("the notice assumption", () => {
  const base = demoDoc();
  const d = addManual(base, { label: "x", signedMonth: 0, payMonth: 3, amount: 1000 });

  it("IS STATED WHERE THE NUMBER IS, not buried in settings", () => {
    // A closure figure computed from an assumption is fine provided the assumption is visible and can
    // be argued with. Hidden in a settings page, it is just a number somebody has to trust.
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)} />);
    expect(v.container.textContent).toMatch(/Clean exit assumes/);
    expect(v.container.textContent).toMatch(/weeks' notice for everyone/);
  });

  it("is editable and writes to settings", () => {
    let held = d;
    const v = render(<Commitments doc={d} setDoc={fn => { held = fn(d); }} rows={rowsOf(d)} />);
    const inp = v.container.querySelector(".inp-wk");
    expect(inp.value).toBe("4");
    fireEvent.change(inp, { target: { value: "8" } });
    expect(held.settings.noticeWeeks).toBe(8);
  });

  it("is read-only for a viewer", () => {
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)} canWrite={false} />);
    expect(v.container.querySelector(".inp-wk").disabled).toBe(true);
  });

  it("names the two failures separately", () => {
    const late = addManual(base, { label: "L", signedMonth: 0, payMonth: 9, amount: 150000 });
    const v = render(<Commitments doc={late} setDoc={() => {}} rows={rowsOf(late)} />);
    expect(v.container.textContent).toMatch(/Cannot be paid/);
    expect(v.container.textContent).not.toMatch(/Uncovered/);
  });
});
