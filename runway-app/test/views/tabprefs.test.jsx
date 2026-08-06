// Hiding tabs, end to end — plus the guard that keeps the settings screen honest about what exists.
import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { RunwayApp } from "../../src/App";
import { LayoutSection } from "../../src/views/Account";
import { TabPrefsProvider, TAB_REGISTRY } from "../../src/state/tabprefs";
import { demoDoc } from "../../src/state/document";

const app = (prefs) => {
  function H() {
    const [d, setD] = useState(demoDoc());
    return <TabPrefsProvider value={prefs}><RunwayApp doc={d} setDoc={setD} tabPrefs={prefs} /></TabPrefsProvider>;
  }
  return render(<H />).container;
};
const navs = (c) => [...c.querySelectorAll("button.nav")].map(b => b.textContent);
const subs = (c) => [...c.querySelectorAll("button.subtab")].map(b => b.textContent);
const open = (c, re) => fireEvent.click([...c.querySelectorAll("button.nav")].find(b => re.test(b.textContent)));

describe("the registry matches what the views actually render", () => {
  it("lists every sub-tab each view builds — a sub-tab it cannot see is one nobody can hide", () => {
    // The registry is duplicated from the views by necessity: each builds its own TABS locally with
    // live counts, so there is nothing importable. This is the guard against that duplication rotting.
    const files = { flow: "CashFlow", pay: "Payroll", proj: "Projects",
                    sales: "Sales", inv: "Investment", hist: "History" };
    for (const [view, file] of Object.entries(files)) {
      const src = readFileSync(`src/views/${file}.jsx`, "utf8");
      const block = /const TABS = \[([\s\S]*?)\];/.exec(src)[1];
      const keys = [...block.matchAll(/\["([a-z]+)",/g)].map(m => m[1]);
      const registered = TAB_REGISTRY.find(t => t.view === view).subs.map(([k]) => k);
      expect(registered, `${file} sub-tabs drifted from the registry`).toEqual(keys);
    }
  });
});

describe("hiding a main tab", () => {
  it("removes it from the nav", () => {
    const c = app({ views: ["pay", "scn"], subs: {} });
    expect(navs(c).some(t => /Payroll/.test(t))).toBe(false);
    expect(navs(c).some(t => /Scenarios/.test(t))).toBe(false);
    expect(navs(c).some(t => /Dashboard/.test(t))).toBe(true);
  });

  it("leaves the Dashboard alone even when asked to hide it", () => {
    expect(navs(app({ views: ["dash"], subs: {} })).some(t => /Dashboard/.test(t))).toBe(true);
  });

  it("changes nothing about the model", () => {
    // It is a view preference. The runway must not move because somebody tidied their nav.
    const shown = app({ views: [], subs: {} });
    const hidden = app({ views: ["pay", "proj", "sales"], subs: {} });
    expect(shown.querySelector(".sub").textContent).toBe(hidden.querySelector(".sub").textContent);
    expect(hidden.textContent).toMatch(/4\.3/);
  });
});

describe("hiding a sub-tab", () => {
  it("removes it from that view's tab row", () => {
    const c = app({ views: [], subs: { flow: ["costs"] } });
    open(c, /Cash flow/);
    expect(subs(c).some(t => /^Costs$/.test(t))).toBe(false);
    expect(subs(c).some(t => /^Revenue$/.test(t))).toBe(true);
  });

  it("does not land on a hidden default", () => {
    // Cash flow defaults to "Net cash flow". Hiding it must not leave that tab showing.
    const c = app({ views: [], subs: { flow: ["net"] } });
    open(c, /Cash flow/);
    expect(subs(c).some(t => /Net cash flow/.test(t))).toBe(false);
    expect(c.querySelector("button.subtab.on").textContent).toMatch(/Revenue/);
  });

  it("still shows one when everything in the view is hidden", () => {
    const c = app({ views: [], subs: { flow: ["net", "revenue", "costs"] } });
    open(c, /Cash flow/);
    expect(subs(c).length).toBe(1);
  });
});

describe("the settings screen", () => {
  // Rendered directly: the surrounding Account page needs a live session, and what is under test
  // here is the control, not the page.
  const acct = (prefs, onChange = () => {}) =>
    render(<LayoutSection prefs={prefs} onChange={onChange} />).container;

  it("lists every tab, with the Dashboard locked on", () => {
    const c = acct({ views: [], subs: {} });
    expect(c.textContent).toMatch(/Layout/);
    expect(c.querySelector('[aria-label="Dashboard"]').disabled).toBe(true);
    expect(c.querySelector('[aria-label="Payroll"]').disabled).toBe(false);
  });

  it("says plainly that this changes nothing but the view", () => {
    expect(acct({ views: [], subs: {} }).textContent).toMatch(/nothing is deleted, no number/i);
  });

  it("hides a tab when unticked", () => {
    let got = null;
    const c = acct({ views: [], subs: {} }, p => { got = p; });
    fireEvent.click(c.querySelector('[aria-label="Payroll"]'));
    expect(got.views).toEqual(["pay"]);
  });

  it("REFUSES to hide the last sub-tab, rather than appearing to and not working", () => {
    let got = null;
    const c = acct({ views: [], subs: { flow: ["net", "revenue"] } }, p => { got = p; });
    fireEvent.click(c.querySelector('[aria-label="Cash flow: Costs"]'));
    expect(got).toBeNull();
  });

  it("offers a way back to everything, with a count", () => {
    const c = acct({ views: ["pay"], subs: { flow: ["costs"] } });
    expect(c.textContent).toMatch(/Show everything again \(2 hidden\)/);
  });

  it("offers no such button when nothing is hidden", () => {
    expect(acct({ views: [], subs: {} }).textContent).not.toMatch(/Show everything again/);
  });
});
