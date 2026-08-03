import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { AdvisorHome } from "../../src/views/chrome/AdvisorHome";
import { demoDoc } from "../../src/state/document";

afterEach(cleanup);
globalThis.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const api = (over = {}) => ({
  listAdvisedCompanies: vi.fn().mockResolvedValue([
    { id: "a", name: "Celadyne Energy", has_document: true },
    { id: "b", name: "Halden Bio", has_document: true },
  ]),
  readCompanyDocument: vi.fn().mockResolvedValue(demoDoc()),
  ...over,
});

describe("where an advisor lands", () => {
  it("lists every client in the rail, with a runway beside each", async () => {
    const v = render(<AdvisorHome account={api()} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/Celadyne Energy/));
    expect(v.container.textContent).toMatch(/Halden Bio/);
    await waitFor(() => expect(v.container.querySelector(".navr")).toBeTruthy());
  });

  it("sorts by WHO RUNS OUT FIRST", async () => {
    // The order is the feature: it answers "who do I call today", which is the question a fractional
    // CFO opens the app with.
    const short = { ...demoDoc(), cash: 40000 };
    const account = api({
      readCompanyDocument: vi.fn().mockImplementation(id =>
        Promise.resolve(id === "b" ? short : demoDoc())),
    });
    const v = render(<AdvisorHome account={account} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.querySelectorAll("tbody tr").length).toBe(2));
    await waitFor(() => {
      const first = v.container.querySelector("tbody tr").textContent;
      expect(first).toMatch(/Halden Bio/);
    });
  });

  it("MARKS a client whose model would not load rather than dropping it", async () => {
    // Omitting it would tell an advisor they have fewer clients than they do — and a blank cell would
    // read as a client with nothing wrong, which is the one thing it is not.
    const account = api({
      readCompanyDocument: vi.fn().mockImplementation(id =>
        id === "b" ? Promise.reject(new Error("nope")) : Promise.resolve(demoDoc())),
    });
    const v = render(<AdvisorHome account={account} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/could not read/i));
    expect(v.container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("opens a client's tab in place, not the whole app", async () => {
    const onEnter = vi.fn();
    const v = render(<AdvisorHome account={api()} onEnterCompany={onEnter} />);
    await waitFor(() => expect(v.container.querySelectorAll(".navitem").length).toBeGreaterThan(1));
    fireEvent.click([...v.container.querySelectorAll(".navitem")].find(b => /Celadyne/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/Across their tabs/));
    expect(onEnter).not.toHaveBeenCalled();     // looking is not entering
  });

  it("enters the ordinary app at the tab a tile names", async () => {
    // The whole reason the tiles are doors.
    const onEnter = vi.fn();
    const v = render(<AdvisorHome account={api()} onEnterCompany={onEnter} />);
    await waitFor(() => expect(v.container.querySelectorAll(".navitem").length).toBeGreaterThan(1));
    fireEvent.click([...v.container.querySelectorAll(".navitem")].find(b => /Celadyne/.test(b.textContent)));
    await waitFor(() => expect(v.container.querySelector(".tt")).toBeTruthy());
    fireEvent.click([...v.container.querySelectorAll(".tt")].find(t => /Payroll/.test(t.textContent)));
    expect(onEnter).toHaveBeenCalledWith("a", "pay");
  });

  it("offers a button naming the company, not a switcher", async () => {
    const onEnter = vi.fn();
    const v = render(<AdvisorHome account={api()} onEnterCompany={onEnter} />);
    await waitFor(() => expect(v.container.querySelectorAll(".navitem").length).toBeGreaterThan(1));
    fireEvent.click([...v.container.querySelectorAll(".navitem")].find(b => /Celadyne/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/Open Celadyne Energy/));
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /Open Celadyne/.test(b.textContent)));
    expect(onEnter).toHaveBeenCalledWith("a", "dash");
  });

  it("explains itself to an advisor with no clients yet", async () => {
    const account = api({ listAdvisedCompanies: vi.fn().mockResolvedValue([]) });
    const v = render(<AdvisorHome account={account} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/No clients yet/));
  });

  it("says so when the client list itself fails", async () => {
    const account = api({ listAdvisedCompanies: vi.fn().mockRejectedValue(new Error("offline")) });
    const v = render(<AdvisorHome account={account} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/offline|Could not list/i));
  });
});
