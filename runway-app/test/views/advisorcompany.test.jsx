import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { AdvisorCompany } from "../../src/views/chrome/AdvisorCompany";
import { buildModelParts, buildModelFromDoc } from "../../src/engine/buildmodel";
import { buildProjection } from "../../src/engine/projection";
import { canaryDoc as demoDoc } from "../../src/state/document";

afterEach(cleanup);
globalThis.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const doc = demoDoc();
const parts = () => {
  const p = buildModelParts(doc);
  return { ...p, rows: buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {}) };
};
const co = { id: "co-1", name: "Harbor Point Labs" };

describe("an advisor's view of one client", () => {
  it("draws the client's own runway chart", () => {
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} />);
    expect(v.container.textContent).toMatch(/Runway, with its range/);
    expect(v.container.querySelector("svg")).toBeTruthy();
  });

  it("shows a tile per tab, with a real figure on each", () => {
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} />);
    const tiles = [...v.container.querySelectorAll(".tt")];
    expect(tiles.length).toBeGreaterThan(3);
    for (const t of tiles) {
      expect(t.querySelector(".ttv").textContent.trim()).not.toBe("");
      expect(t.querySelector(".tts").textContent.trim()).not.toBe("");
    }
  });

  it("OPENS THAT TAB, not the dashboard", () => {
    // The whole point of the tiles: an advisor already knows which part of the business they are
    // worried about, and opening the company then hunting for Payroll is a step that exists only
    // because the software was built company-first.
    const onOpen = vi.fn();
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} onOpen={onOpen} />);
    const pay = [...v.container.querySelectorAll(".tt")]
      .find(t => /Payroll/.test(t.textContent));
    fireEvent.click(pay);
    expect(onOpen).toHaveBeenCalledWith("pay");
  });

  it("hides a tile for a tab the company turned off", () => {
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} hiddenTabs={["proj"]} />);
    expect([...v.container.querySelectorAll(".tt")].some(t => /Projects/.test(t.textContent))).toBe(false);
  });

  it("SAYS a model would not load rather than reading as an empty company", () => {
    // The worse failure by far: an advisor seeing a healthy-looking screen for a company whose data
    // they cannot actually see.
    const v = render(<AdvisorCompany company={co} doc={null} parts={null} />);
    expect(v.container.textContent).toMatch(/Could not read this model/);
    expect(v.container.querySelector(".tt")).toBeNull();
  });

  it("says so when there are no tiles to show, without claiming the model failed", () => {
    // Two different empties, and conflating them is the failure worth guarding: a model that WILL NOT
    // LOAD must never look like a company with nothing in it.
    //
    // Driven through `hiddenTabs` rather than a hand-emptied document — I could not reliably construct
    // one that produced no tiles, and a test whose premise I cannot verify is worse than no test.
    const all = ["flow", "pay", "proj", "sales", "inv", "hist", "ms", "cmt", "scn"];
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} hiddenTabs={all} />);
    expect(v.container.textContent).toMatch(/nothing in it yet/);
    expect(v.container.textContent).not.toMatch(/Could not read/);
  });

  it("offers no control that would change the client's model", () => {
    // An advisor is always a viewer. Every button here navigates.
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} onOpen={() => {}} />);
    expect(v.container.querySelector("input")).toBeNull();
    expect(v.container.querySelector("select")).toBeNull();
    expect(v.container.textContent).not.toMatch(/\bSave\b|\bDelete\b|\bAdd\b/);
  });
});

describe("the advisor's scenarios, on the company tab", () => {
  const account = (rows = []) => ({
    myScenarios: vi.fn().mockResolvedValue(rows),
    saveScenario: vi.fn(), deleteScenario: vi.fn(), shareScenario: vi.fn(),
  });

  it("mounts the advisor's own scenario workspace", async () => {
    // The ONE writing act on a screen where an advisor is otherwise a viewer.
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} account={account()} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/scenario/i));
  });

  it("feeds the Scenarios TILE from the panel's fetch, not a second one", async () => {
    // Two fetches for one list is two chances to disagree about a number both are showing on the same
    // screen.
    const api = account([
      { id: "s1", name: "Delay two hires", patch: {}, shared_at: "2026-07-01" },
      { id: "s2", name: "Bridge $200k", patch: {} },
    ]);
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} account={api} />);
    await waitFor(() => {
      const tile = [...v.container.querySelectorAll(".tt")].find(t => /Scenarios/.test(t.textContent));
      expect(tile?.querySelector(".ttv").textContent).toMatch(/^2/);
    });
    expect(api.myScenarios).toHaveBeenCalledTimes(1);
  });

  it("shows NO scenarios tile until the list has arrived", () => {
    // Undefined means nobody has fetched them; `[]` means the advisor has none. A tile reading
    // "0 scenarios" before the fetch returns is a lie with a short shelf life.
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} />);
    expect([...v.container.querySelectorAll(".tt")].some(t => /Scenarios/.test(t.textContent))).toBe(false);
  });

  it("does not mount the workspace without an account to reach", () => {
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} />);
    expect(v.container.textContent).not.toMatch(/Offer to the company/i);
  });
});

describe("the advisor's own scenarios, on the company tab", () => {
  const scnApi = (rows = []) => ({
    myScenarios: vi.fn().mockResolvedValue(rows),
    saveScenario: vi.fn().mockResolvedValue({}),
    deleteScenario: vi.fn().mockResolvedValue({}),
    shareScenario: vi.fn().mockResolvedValue({}),
  });

  it("mounts the panel when there is an account to load it with", async () => {
    // THE ONE WRITING ACT ON THIS SCREEN. An advisor cannot change a client's model — the role gate
    // refuses — but they keep their own scenario layer per company and can offer one to the owner.
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} account={scnApi()} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/scenario/i));
  });

  it("shows no scenario panel without an account", () => {
    // Not a failure state: the component is also rendered in tests and previews with no API behind it,
    // and a panel that cannot load is worse than no panel.
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} />);
    expect(v.container.textContent).not.toMatch(/Offer to the company/i);
  });

  it("does not show a scenarios TILE until the panel has reported", async () => {
    // `undefined` means nobody has fetched them; `[]` means the advisor has none. A tile reading
    // "0 scenarios" before the fetch returns is a lie with a short shelf life — and it would sit six
    // inches above the list that contradicts it.
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} />);
    expect([...v.container.querySelectorAll(".tt")].some(t => /Scenarios/.test(t.textContent)))
      .toBe(false);
  });

  it("reads the tile from what the PANEL loaded, not a second fetch", async () => {
    // One fetch, one number. Fetching separately would let the tile and the list below it disagree.
    const rows = [{ id: "s1", name: "Delay two hires", patch: {} },
                  { id: "s2", name: "Bridge 200k", patch: {} }];
    const api = scnApi(rows);
    const v = render(<AdvisorCompany company={co} doc={doc} parts={parts()} account={api} />);
    await waitFor(() => {
      const tile = [...v.container.querySelectorAll(".tt")].find(t => /Scenarios/.test(t.textContent));
      expect(tile?.querySelector(".ttv").textContent).toMatch(/2/);
    });
    expect(api.myScenarios).toHaveBeenCalledTimes(1);
  });
});
