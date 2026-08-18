// "View cost codes" modal: the full code->project mapping table with add/delete. Distinct from the
// ledger's "Unmapped cost codes" panel (which only prompts for codes seen but not mapped) — both coexist.
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { canaryDoc as demoDoc } from "../../src/state/document";

function openLedger(doc) {
  let d = doc;
  const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /Spend history/.test(b.textContent)));
  fireEvent.click([...container.querySelectorAll(".subtab")].find(b => b.textContent.startsWith("Ledger")));
  return { container, get: () => d };
}

describe("View cost codes modal", () => {
  it("opens from the ledger and lists existing mappings", () => {
    const { container } = openLedger(demoDoc());
    const btn = [...container.querySelectorAll("button")].find(b => /View cost codes/.test(b.textContent));
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(container.textContent).toMatch(/Cost code mappings/);
    // demo codeMap maps 5000/5100/etc — at least one row present
    expect(container.querySelectorAll(".modal .tbl tbody tr").length).toBeGreaterThan(0);
  });

  it("adds a new mapping", () => {
    const api = openLedger(demoDoc());
    fireEvent.click([...api.container.querySelectorAll("button")].find(b => /View cost codes/.test(b.textContent)));
    const before = Object.keys(api.get().codeMap).length;
    const codeInput = api.container.querySelector(".cm-add-row .inp");
    fireEvent.change(codeInput, { target: { value: "9999" } });
    const destSel = api.container.querySelector(".cm-add-row .sel");
    const firstProj = [...destSel.options].find(o => o.value && o.value !== "");
    fireEvent.change(destSel, { target: { value: firstProj.value } });
    fireEvent.click([...api.container.querySelectorAll(".cm-add-row button")].find(b => /Add/.test(b.textContent)));
    expect(Object.keys(api.get().codeMap).length).toBe(before + 1);
    expect(api.get().codeMap["9999"]).toBe(firstProj.value);
  });

  it("deletes a mapping", () => {
    const api = openLedger(demoDoc());
    fireEvent.click([...api.container.querySelectorAll("button")].find(b => /View cost codes/.test(b.textContent)));
    const before = Object.keys(api.get().codeMap).length;
    const firstDel = api.container.querySelector(".modal .tbl tbody .iconbtn");
    fireEvent.click(firstDel);
    expect(Object.keys(api.get().codeMap).length).toBe(before - 1);
  });

  it("the Unmapped cost codes panel still appears independently", () => {
    let d = demoDoc();
    // add a ledger line with a code that isn't mapped
    d.history = [{ month: 0, lines: [{ code: "ZZZ", amount: 5000 }] }, ...d.history.slice(1)];
    const { container } = openLedger(d);
    expect(container.textContent).toMatch(/Unmapped cost codes/);
  });
});
