import { describe, it, vi, expect } from "vitest";
import { CompanyGeneral } from "../../src/views/chrome/CompanyGeneral";
import { render, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { Account } from "../../src/views/Account";
import * as sync from "../../src/state/sync";
const api = {
  listCompanies: vi.fn().mockResolvedValue([{ id: "co-1", name: "Harbor Point", role: "owner" }]),
  profile: vi.fn().mockResolvedValue({ last_company_id: "co-1" }),
  listMembers: vi.fn().mockResolvedValue([]),
  companyPlan: vi.fn().mockResolvedValue({ plan: "solo", status: "active" }),
  companyTabs: vi.fn().mockResolvedValue([]),
  qboStatus: vi.fn().mockResolvedValue(null),
  advisorPlan: vi.fn().mockResolvedValue({ companies: 0, allowed: 0 }),
  listAdvisedCompanies: vi.fn().mockResolvedValue([]),
};
// EVERY COMPANY PAGE MUST DRAW SOMETHING. The General page came up BLANK in the browser because
// `DeleteCompany` was mounted as though it were a panel — it is the confirmation modal, and it threw on
// `company.name` before the company list had loaded. A throw inside a route renders nothing at all, so
// there was no visual clue: no error, no half-drawn page, just white.
it.each(["general","plan","people","tabs","connections"])("company page %s draws something", async (page) => {
  vi.spyOn(sync, "getAccountApi").mockReturnValue(api);
  vi.spyOn(sync, "getAuthAdapter").mockReturnValue({ activeCompany: () => "co-1" });
  vi.spyOn(sync, "getSessionProvider").mockReturnValue({ getUser: vi.fn().mockResolvedValue({ email: "c@x.com" }), current: () => Promise.resolve({ email: "c@x.com" }) });
  const v = render(<Account doc={{ name: "m" }} scope="company" page={page} onClose={()=>{}} onGo={()=>{}} />);
  await waitFor(() => expect(v.container.querySelector(".setbody")).toBeTruthy());
  const body = v.container.querySelector(".setbody").textContent.trim();
  expect(body.length).toBeGreaterThan(0);
});

it.each(["profile","appearance","advisor","data"])("profile page %s draws something", async (page) => {
  vi.spyOn(sync, "getAccountApi").mockReturnValue(api);
  vi.spyOn(sync, "getAuthAdapter").mockReturnValue({ activeCompany: () => "co-1" });
  vi.spyOn(sync, "getSessionProvider").mockReturnValue({
    getUser: vi.fn().mockResolvedValue({ email: "c@x.com" }),
    current: () => Promise.resolve({ email: "c@x.com" }),
  });
  const v = render(<Account doc={{ name: "m" }} scope="profile" page={page}
                            tabPrefs={{}} onTabPrefs={() => {}} onClose={() => {}} onGo={() => {}} />);
  await waitFor(() => expect(v.container.querySelector(".setbody")).toBeTruthy());
  expect(v.container.querySelector(".setbody").textContent.trim().length).toBeGreaterThan(0);
});

it("does not claim you are not the owner while the role is still unknown", async () => {
  // A load failure used to lock every page with "only the owner can change this" — a false answer that
  // sends somebody to ask a person who cannot help them.
  vi.spyOn(sync, "getAccountApi").mockReturnValue({
    ...api, listCompanies: vi.fn().mockRejectedValue(new Error("offline")),
  });
  vi.spyOn(sync, "getAuthAdapter").mockReturnValue({ activeCompany: () => "co-1" });
  vi.spyOn(sync, "getSessionProvider").mockReturnValue({
    getUser: vi.fn().mockResolvedValue({ email: "c@x.com" }),
    current: () => Promise.resolve({ email: "c@x.com" }),
  });
  const v = render(<Account doc={{ name: "m" }} scope="company" page="general"
                            onClose={() => {}} onGo={() => {}} />);
  await waitFor(() => expect(v.container.querySelector(".setbody")).toBeTruthy());
  expect(v.container.textContent).not.toMatch(/Only the owner/i);
});

describe("projection setup lives in company settings", () => {
  it("THE CONTROL IS THERE, and editable", () => {
    // MOVED FROM SPEND HISTORY, where it sat above a table of recorded months and read as part of them.
    // It is a property of the COMPANY — the origin every month index is measured from — so it belongs
    // beside the company's name.
    const doc = { startY: 2026, startM: 6, cash: 500000 };
    let held = doc;
    const v = render(<CompanyGeneral company={{ id: "c1", name: "Co", startLabel: "Jul 2026" }}
                                     account={{}} doc={doc} setDoc={fn => { held = fn(doc); }} />);
    const month = v.container.querySelector('[aria-label="Projection start month"]');
    expect(month).toBeTruthy();
    expect(Number(month.value)).toBe(6);
    fireEvent.change(month, { target: { value: "0" } });
    expect(held.startM).toBe(0);
  });

  it("carries the warning WITH the control", () => {
    // The old read-only spot explained that changing the start re-bases the document — while the
    // editable control lived on another tab. The warning was being made in the one place the change
    // could not be made.
    const v = render(<CompanyGeneral company={{ id: "c1", name: "Co" }} account={{}}
                                     doc={{ startY: 2026, startM: 6, cash: 1 }} setDoc={() => {}} />);
    expect(v.container.textContent).toMatch(/re-bases the document/i);
  });

  it("cash on hand moved with it", () => {
    const doc = { startY: 2026, startM: 6, cash: 500000 };
    let held = doc;
    const v = render(<CompanyGeneral company={{ id: "c1", name: "Co" }} account={{}}
                                     doc={doc} setDoc={fn => { held = fn(doc); }} />);
    fireEvent.change(v.container.querySelector('[aria-label="Cash on hand at start"]'),
                     { target: { value: "750000" } });
    expect(held.cash).toBe(750000);
  });

  it("is read-only for somebody who cannot edit", () => {
    const v = render(<CompanyGeneral company={{ id: "c1", name: "Co" }} account={{}}
                                     doc={{ startY: 2026, startM: 6, cash: 1 }} setDoc={() => {}}
                                     canEdit={false} />);
    expect(v.container.querySelector('[aria-label="Projection start month"]').disabled).toBe(true);
  });
});
