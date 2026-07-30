// Which tabs a company uses. Owner-only, and the other half of a decision `tabprefs.js` already made
// about personal decluttering — so most of what matters here is that the two layers stay distinct.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { CompanyTabs } from "../../src/views/chrome/CompanyTabs";

afterEach(cleanup);

const api = (hidden = []) => ({
  companyTabs: vi.fn().mockResolvedValue(hidden),
  setCompanyTabs: vi.fn().mockResolvedValue(undefined),
});

const draw = async (a, role = "owner") => {
  const v = render(<CompanyTabs account={a} companyId="co-1" role={role} />);
  if (role === "owner") await waitFor(() => expect(a.companyTabs).toHaveBeenCalled());
  return v;
};

describe("who sees it", () => {
  it("owners only — absent for everybody else, not disabled", async () => {
    // A control you can see and cannot use is an invitation to ask why.
    for (const role of ["admin", "editor", "viewer"]) {
      const v = await draw(api(), role);
      expect(v.container.textContent).toBe("");
    }
  });

  it("renders for an owner", async () => {
    const v = await draw(api());
    expect(v.container.textContent).toMatch(/Tabs this company uses/);
  });
});

describe("what it says it does", () => {
  it("names the boundary between this and personal hiding", async () => {
    // The distinction people get wrong: this sets what is AVAILABLE, not what each person looks at.
    const v = await draw(api());
    expect(v.container.textContent).toMatch(/hides it for everybody/i);
    expect(v.container.textContent).toMatch(/still hide more for themselves/i);
  });

  it("marks the Dashboard as always on and refuses to toggle it", async () => {
    // It is the fallback whenever a view disappears, so a company that hid it would leave members
    // landing on nothing.
    const v = await draw(api());
    const box = v.getByLabelText("Dashboard available to this company");
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(true);
  });

  it("marks Scenarios as role-gated, so the owner knows turning it on is not the whole story", async () => {
    const v = await draw(api());
    expect(v.container.textContent).toMatch(/owners, admins and advisors only/i);
  });
});

describe("toggling", () => {
  it("turns a tab off for the company", async () => {
    const a = api();
    const v = await draw(a);
    fireEvent.click(v.getByLabelText("Investment available to this company"));
    await waitFor(() => expect(a.setCompanyTabs).toHaveBeenCalledWith("co-1", ["inv"]));
  });

  it("turns one back on without disturbing the others", async () => {
    const a = api(["inv", "sales"]);
    const v = await draw(a);
    fireEvent.click(v.getByLabelText("Investment available to this company"));
    await waitFor(() => expect(a.setCompanyTabs).toHaveBeenCalledWith("co-1", ["sales"]));
  });

  it("shows the new state immediately, then reloads if the save failed", async () => {
    // Optimistic, because a checkbox that waits for a round trip feels broken — but it re-reads on
    // failure rather than leaving the screen claiming something the server did not accept.
    const a = api();
    a.setCompanyTabs = vi.fn().mockRejectedValue(new Error("forbidden"));
    const v = await draw(a);
    fireEvent.click(v.getByLabelText("Sales available to this company"));
    await waitFor(() => expect(a.companyTabs).toHaveBeenCalledTimes(2));
  });
});
