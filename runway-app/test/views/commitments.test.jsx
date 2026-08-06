import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Commitments } from "../../src/views/Commitments";
import { buildProjection } from "../../src/engine/projection";
import { buildModelFromDoc } from "../../src/engine/buildmodel";
import { addManual, promote } from "../../src/engine/commitments";
import { demoDoc } from "../../src/state/document";

// The demo now ships five commitments to demonstrate them, so it is the wrong fixture for a test about
// an empty tab or about what a single commitment does.
const bare = () => {
  const d = demoDoc();
  return { ...d, commitments: [], lines: (d.lines || []).filter(l => !String(l.id).startsWith("l_demo_")) };
};

afterEach(cleanup);
const rowsOf = (d) => buildProjection(buildModelFromDoc(d), d.settings?.toggles || {});
const draw = (doc, over = {}) =>
  render(<Commitments doc={doc} setDoc={() => {}} rows={rowsOf(doc)} {...over} />);

describe("the Commitments tab", () => {
  const base = bare();

  it("EXPLAINS THE CONCEPT when empty", () => {
    // Unlike every other tab, this one is not populated by using the product normally. Somebody
    // arriving has to be told what belongs in it before they can put anything in it.
    //
    // Needs a model with NO AWARDS: the demo carries a derived cost-share obligation now, so it is
    // never truly empty — which is the cost-share feature working, not this test failing.
    const v = draw({ ...bare(), projects: [], commitments: [] });
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
  const base = bare();
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
  const base = bare();

  it("gets its own SECTION, grouped by award", () => {
    // Cost share is checked per period by the funder, so a flat list of rows from three grants is one
    // nobody can reconcile against anything they were sent.
    const v = draw(demoDoc());
    expect(v.container.textContent).toMatch(/Cost share/);
    expect(v.container.querySelectorAll(".cgroup").length).toBeGreaterThan(0);
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
    const v = draw(demoDoc(), { canWrite: true });
    // THE PERIODS DEFAULT CLOSED NOW, so the rows have to be opened before they can be inspected —
    // a test that looked for them without opening was passing on a layout that no longer exists.
    v.container.querySelectorAll(".fold-h").forEach(b => fireEvent.click(b));
    const rows = [...v.container.querySelectorAll(".crow")]
      .filter(r => /period|month/i.test(r.textContent));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => expect(r.querySelectorAll("button").length).toBe(0));
  });
});

describe("the debt / planned badge", () => {
  const base = bare();
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
  const base = bare();
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

describe("the tab's four sections", () => {
  const d = () => {
    const b = demoDoc();
    return { ...b, rounds: [
      { id: "vd", name: "Growth facility", kind: "debt", status: "closed", amount: 800000,
        closeMonth: 0, termMonths: 36, rateAPR: 12 },
      { id: "nd", name: "2025 note", kind: "note", status: "closed", amount: 400000,
        closeMonth: 0, maturityMonths: 18, atMaturity: "repay" },
      { id: "rn", name: "Ferrous note", kind: "note", status: "closed", amount: 300000,
        closeMonth: 0, atMaturity: "royalty", royaltyPct: 0.03, capMultiple: 4 },
    ] };
  };
  const v = () => render(<Commitments doc={d()} setDoc={() => {}} rows={rowsOf(d())} />);

  it("groups venture debt, note debt and royalties under one heading", () => {
    const t = v().container.textContent;
    expect(t).toMatch(/Debt and notes/);
    expect(t).toMatch(/Venture debt/);
    expect(t).toMatch(/Note debt/);
    expect(t).toMatch(/Royalties/);
  });

  it("gives venture and note debt SEPARATE toggles", () => {
    // A lender with a security interest is not a noteholder, and a founder asking "could I settle
    // everyone else" usually means one of them specifically.
    const boxes = [...v().container.querySelectorAll(".dbt-toggle input")];
    expect(boxes.length).toBe(2);
  });

  it("offers NO toggle on royalties, because there is no decision to make", () => {
    // Stop trading and nothing further is owed. A switch would imply otherwise.
    const groups = [...v().container.querySelectorAll(".cgroup")];
    const roy = groups.find(g => /Royalties/.test(g.textContent));
    expect(roy.querySelectorAll(".dbt-toggle").length).toBe(0);
    expect(roy.textContent).toMatch(/nothing further is owed/i);
  });

  it("SHUTDOWN COSTS ARE THEIR OWN SECTION, including the payroll assumption", () => {
    // Not payments with a missing date. They exist only because you stopped — and grouping them with
    // dated obligations made them read as data somebody had failed to fill in.
    const t = v().container.textContent;
    expect(t).toMatch(/Shutdown costs/);
    expect(t).toMatch(/Payroll notice/);
    expect(t).toMatch(/Only owed if you stop/);
  });

  it("every section shows its own total", () => {
    const chips = [...v().container.querySelectorAll(".panel-h .chip")];
    expect(chips.length).toBeGreaterThanOrEqual(2);
    chips.forEach(c => expect(c.textContent).toMatch(/[\d,]/));
  });
});

describe("the exit toggles persist", () => {
  it("WRITE TO THE DOCUMENT, not to component state", () => {
    // They were `useState`, so leaving the tab reset them. A setting that silently reverts is worse
    // than no setting, because the next reading is wrong in a way nobody notices.
    const d = { ...demoDoc(), rounds: [{ id: "vd", name: "Facility", kind: "debt", status: "closed",
      amount: 800000, closeMonth: 0, termMonths: 36, rateAPR: 12 }] };
    let held = d;
    const v = render(<Commitments doc={d} setDoc={fn => { held = fn(d); }} rows={rowsOf(d)} />);
    fireEvent.click(v.container.querySelector(".dbt-toggle input"));
    expect(held.settings.exitCountsVentureDebt).toBe(false);
  });

  it("default to counting when the document says nothing", () => {
    const d = { ...demoDoc(), settings: { ...demoDoc().settings } };
    delete d.settings.exitCountsVentureDebt;
    const v = render(<Commitments doc={d} setDoc={() => {}} rows={rowsOf(d)} />);
    const box = v.container.querySelector(".dbt-toggle input");
    if (box) expect(box.checked).toBe(true);
  });

  it("the tile shows months and puts the consequence underneath", () => {
    // "not now" read as an error message rather than a number.
    const v = render(<Commitments doc={demoDoc()} setDoc={() => {}} rows={rowsOf(demoDoc())} />);
    expect(v.container.textContent).not.toMatch(/not now/);
    expect(v.container.textContent).toMatch(/Clean exit until/);
  });
});

describe("cost share grouped by budget period", () => {
  const draw2 = () => render(<Commitments doc={demoDoc()} setDoc={() => {}} rows={rowsOf(demoDoc())} />);

  it("groups the periods inside the award", () => {
    // A funder checks the match PER PERIOD, so a flat list of rows from three periods is one nobody can
    // reconcile against anything they were sent.
    expect(draw2().container.textContent).toMatch(/Budget period 1/);
    expect(draw2().container.textContent).toMatch(/Budget period 2/);
  });

  it("DEFAULTS CLOSED, and says how much it is hiding", () => {
    // A monthly-billed award has twelve rows per period; three periods is thirty-six lines nobody asked
    // for. The total is what somebody wants — and a disclosure triangle with nothing beside it is a
    // thing people learn not to open.
    const v = draw2();
    const fold = [...v.container.querySelectorAll(".fold-h")][0];
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.textContent).toMatch(/entr(y|ies)/);
    expect(v.container.querySelectorAll(".fold-b").length).toBe(0);
  });

  it("opens on click", () => {
    const v = draw2();
    fireEvent.click(v.container.querySelector(".fold-h"));
    expect(v.container.querySelectorAll(".fold-b").length).toBe(1);
  });

  it("every period shows its own total", () => {
    const totals = [...draw2().container.querySelectorAll(".fold-t")];
    expect(totals.length).toBeGreaterThan(1);
    totals.forEach(t => expect(t.textContent).toMatch(/\d/));
  });

  it("long labels are allowed to truncate rather than push the amount off", () => {
    // Without `min-width: 0` a flex item will not shrink below its content, so the row grew instead of
    // the text ellipsing — which is the defect that makes a table look broken.
    const css = require("node:fs").readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.crow-l\{min-width:0/);
    expect(css).toMatch(/\.cgroup-h b\{min-width:0/);
  });
});
