import { it, vi, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { Account } from "../../src/views/Account";
import * as sync from "../../src/state/sync";
const api = {
  listCompanies: vi.fn().mockResolvedValue([{ id: "co-1", name: "Celadyne", role: "owner" }]),
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
