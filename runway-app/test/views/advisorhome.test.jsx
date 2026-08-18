import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { AdvisorHome } from "../../src/views/chrome/AdvisorHome";
import { canaryDoc as demoDoc } from "../../src/state/document";

afterEach(cleanup);
globalThis.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const api = (over = {}) => ({
  listAdvisedCompanies: vi.fn().mockResolvedValue([
    { id: "a", name: "Harbor Point Labs", has_document: true },
    { id: "b", name: "Halden Bio", has_document: true },
  ]),
  readCompanyDocument: vi.fn().mockResolvedValue(demoDoc()),
  ...over,
});

describe("where an advisor lands", () => {
  it("lists every client in the rail, with a runway beside each", async () => {
    const v = render(<AdvisorHome account={api()} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.textContent).toMatch(/Harbor Point Labs/));
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
    await waitFor(() => expect(v.container.querySelectorAll(".rail button.nav").length).toBeGreaterThan(1));
    fireEvent.click([...v.container.querySelectorAll(".rail button.nav")].find(b => /Harbor Point/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/Across their tabs/));
    expect(onEnter).not.toHaveBeenCalled();     // looking is not entering
  });

  it("enters the ordinary app at the tab a tile names", async () => {
    // The whole reason the tiles are doors.
    const onEnter = vi.fn();
    const v = render(<AdvisorHome account={api()} onEnterCompany={onEnter} />);
    await waitFor(() => expect(v.container.querySelectorAll(".rail button.nav").length).toBeGreaterThan(1));
    fireEvent.click([...v.container.querySelectorAll(".rail button.nav")].find(b => /Harbor Point/.test(b.textContent)));
    await waitFor(() => expect(v.container.querySelector(".tt")).toBeTruthy());
    fireEvent.click([...v.container.querySelectorAll(".tt")].find(t => /Payroll/.test(t.textContent)));
    expect(onEnter).toHaveBeenCalledWith("a", "pay");
  });

  it("offers a button naming the company, not a switcher", async () => {
    const onEnter = vi.fn();
    const v = render(<AdvisorHome account={api()} onEnterCompany={onEnter} />);
    await waitFor(() => expect(v.container.querySelectorAll(".rail button.nav").length).toBeGreaterThan(1));
    fireEvent.click([...v.container.querySelectorAll(".rail button.nav")].find(b => /Harbor Point/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/Open Harbor Point Labs/));
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => /Open Harbor Point/.test(b.textContent)));
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

describe("it is actually styled", () => {
  // THE BUG THESE CATCH. Every test above passed while the page rendered as unstyled white HTML: the
  // structure was right, the data was right, and not one class matched the stylesheet. Assertions about
  // text content cannot see that, which is why a page can be "fully tested" and visibly broken.
  const { readFileSync } = require("node:fs");
  const css = readFileSync("src/styles.css", "utf8");

  it("wraps in .rw, which scopes the whole stylesheet", async () => {
    const v = render(<AdvisorHome account={api()} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.querySelector(".shell")).toBeTruthy());
    // `.rw` must be an ANCESTOR of the shell, not merely present somewhere.
    expect(v.container.querySelector(".rw .shell")).toBeTruthy();
  });

  it("uses classes the stylesheet defines", async () => {
    // `navitem`, `brandmark`, `railgrp`, `navr` and `fine` were all invented — they rendered as
    // nothing and no test noticed.
    const v = render(<AdvisorHome account={api()} onEnterCompany={() => {}} />);
    await waitFor(() => expect(v.container.querySelector(".shell")).toBeTruthy());

    const used = new Set();
    v.container.querySelectorAll("[class]").forEach(el =>
      String(el.getAttribute("class")).split(/\s+/).filter(Boolean).forEach(c => used.add(c)));

    const missing = [...used].filter(c => !new RegExp("\\." + c + "[\\s{,:.]").test(css));
    expect(missing, `not in styles.css: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("the advisor's own account", () => {
  it("offers the profile menu on the portfolio, not only inside a client", async () => {
    // THE AVATAR IS ON EVERY SCREEN OR IT IS ON NONE. It was in the company app's header and missing
    // here — so an advisor, whose HOME this is, could only reach their own settings by first opening
    // somebody else's company. The one thing that follows a person across companies was reachable only
    // from inside one.
    const v = render(<AdvisorHome account={api()} onEnterCompany={() => {}} onOpenSettings={() => {}} />);
    await waitFor(() => expect(v.container.querySelector(".avatar")).toBeTruthy());
  });

  it("keeps it on a company tab too, beside the open button", async () => {
    const v = render(<AdvisorHome account={api()} onEnterCompany={() => {}} onOpenSettings={() => {}} />);
    await waitFor(() => expect(v.container.querySelectorAll(".rail button.nav").length).toBeGreaterThan(1));
    fireEvent.click([...v.container.querySelectorAll(".rail button.nav")]
      .find(b => /Harbor Point/.test(b.textContent)));
    await waitFor(() => expect(v.container.textContent).toMatch(/Open Harbor Point/));
    expect(v.container.querySelector(".avatar")).toBeTruthy();
  });

  it("routes to profile settings rather than into a company", async () => {
    const onSettings = vi.fn();
    const onEnter = vi.fn();
    const v = render(<AdvisorHome account={api()} onEnterCompany={onEnter} onOpenSettings={onSettings} />);
    await waitFor(() => expect(v.container.querySelector(".avatar")).toBeTruthy());
    fireEvent.click(v.container.querySelector(".avatar"));
    await waitFor(() => expect(v.container.querySelector(".pdrop")).toBeTruthy());
    fireEvent.click([...v.container.querySelectorAll(".pitem")].find(b => /Advisor plan/.test(b.textContent)));
    expect(onSettings).toHaveBeenCalledWith("profile", "advisor");
    expect(onEnter).not.toHaveBeenCalled();
  });
});
