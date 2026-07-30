// The People panel and the invitation screen. The rules live in the database; what is tested here is
// that the UI offers only what the server will accept, and that it says what to do when it will not.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { Members, AcceptInvite } from "../../src/views/chrome/Members";

afterEach(cleanup);

const member = (over = {}) => ({
  user_id: "u1", email: "owner@acme.com", role: "owner",
  joined_at: "2026-01-01T00:00:00Z", is_me: true, ...over,
});

const api = (over = {}) => ({
  listMembers: vi.fn().mockResolvedValue([member()]),
  companyPlan: vi.fn().mockResolvedValue({ plan: "collaborative", status: "active",
                                           seats: 3, used: 1, pending: 0 }),
  listInvitations: vi.fn().mockResolvedValue([]),
  inviteMember: vi.fn().mockResolvedValue({ token: "t", url: "https://app/?invite=t" }),
  revokeInvitation: vi.fn().mockResolvedValue(undefined),
  setMemberRole: vi.fn().mockResolvedValue(undefined),
  removeMember: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const draw = async (a) => {
  const v = render(<Members account={a} companyId="co-1" />);
  await waitFor(() => expect(a.listMembers).toHaveBeenCalled());
  return v;
};

describe("seats are stated, not implied", () => {
  it("says how many are used and how many are left", async () => {
    const v = await draw(api());
    await waitFor(() => expect(v.container.textContent).toMatch(/1 of 3 seats used/));
  });

  it("counts a pending invitation as taken, and says so", async () => {
    const v = await draw(api({ companyPlan: vi.fn().mockResolvedValue({ seats: 3, used: 1, pending: 1 }) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/held by pending invitation/i));
  });

  it("explains an over-capacity company WITHOUT implying anybody was removed", async () => {
    // A downgrade leaves everybody a member and takes away write access. Saying "removed" here would
    // describe a data loss that did not happen.
    const v = await draw(api({ companyPlan: vi.fn().mockResolvedValue({ seats: 1, used: 3, pending: 0 }) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/nobody has been removed/i));
  });

  it("says a company with no subscription cannot be saved to", async () => {
    const v = await draw(api({ companyPlan: vi.fn().mockResolvedValue({ seats: 0, used: 1, pending: 0 }) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/no subscription/i));
  });
});

describe("the invite form offers only what the server will accept", () => {
  it("an owner may grant every role", async () => {
    const v = await draw(api());
    const sel = v.getByLabelText("Role to invite as");
    expect([...sel.options].map(o => o.value)).toEqual(["viewer", "editor", "admin", "owner"]);
  });

  it("an ADMIN is offered neither owner NOR admin", async () => {
    // 027: only an owner appoints admins. Offering it and letting the server refuse would be a
    // dropdown that lies.
    const v = await draw(api({ listMembers: vi.fn().mockResolvedValue([member({ role: "admin" })]) }));
    const sel = v.getByLabelText("Role to invite as");
    expect([...sel.options].map(o => o.value)).toEqual(["viewer", "editor"]);
  });

  it("an ADMIN is not offered owner", async () => {
    // The escalation this blocks: an admin who can mint owners promotes themselves by inviting their
    // own second address. Offering it and letting the server refuse would be a dropdown that lies.
    const v = await draw(api({ listMembers: vi.fn().mockResolvedValue([member({ role: "admin" })]) }));
    const sel = v.getByLabelText("Role to invite as");
    expect([...sel.options].map(o => o.value)).not.toContain("owner");
  });

  it("an editor gets no invite form at all", async () => {
    const v = await draw(api({ listMembers: vi.fn().mockResolvedValue([member({ role: "editor" })]) }));
    expect(v.queryByLabelText("Email to invite")).toBeNull();
  });

  it("refuses BEFORE an address is typed when the seats are gone", async () => {
    const v = await draw(api({ companyPlan: vi.fn().mockResolvedValue({ seats: 1, used: 1, pending: 0 }) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/every seat on this plan is taken/i));
    expect(v.getByLabelText("Email to invite").disabled).toBe(true);
  });
});

describe("the link is shown once", () => {
  it("appears after inviting, with what it can and cannot do", async () => {
    const a = api();
    const v = await draw(a);
    fireEvent.change(v.getByLabelText("Email to invite"), { target: { value: "new@acme.com" } });
    fireEvent.click([...v.container.querySelectorAll("button")].find(b => b.textContent.trim().endsWith("Invite")));
    await waitFor(() => expect(a.inviteMember).toHaveBeenCalledWith("co-1", "new@acme.com", "editor"));
    await waitFor(() => expect(v.getByLabelText("Invitation link").value).toBe("https://app/?invite=t"));
    // The three properties somebody needs to know before sending it to the wrong place.
    expect(v.container.textContent).toMatch(/works once/i);
    expect(v.container.textContent).toMatch(/only for that address/i);
    expect(v.container.textContent).toMatch(/not shown again/i);
  });
});

describe("removing and leaving", () => {
  it("the last owner is offered no way to leave", async () => {
    // A company with no owner cannot invite, cannot be deleted, and cannot be repaired by the customer.
    const v = await draw(api());
    expect(v.queryByText("Leave")).toBeNull();
  });

  it("but an owner among several can", async () => {
    const v = await draw(api({ listMembers: vi.fn().mockResolvedValue([
      member(), member({ user_id: "u2", email: "two@acme.com", role: "owner", is_me: false }),
    ]) }));
    await waitFor(() => expect(v.getByText("Leave")).toBeTruthy());
  });

  it("an admin cannot remove an owner", async () => {
    const v = await draw(api({ listMembers: vi.fn().mockResolvedValue([
      member({ role: "admin" }),
      member({ user_id: "u2", email: "boss@acme.com", role: "owner", is_me: false }),
    ]) }));
    await waitFor(() => expect(v.container.textContent).toMatch(/boss@acme.com/));
    expect(v.queryByText("Remove")).toBeNull();
  });
});

describe("accepting an invitation", () => {
  const acct = (over = {}) => ({
    acceptInvitation: vi.fn().mockResolvedValue({ company_id: "co-9", company_name: "Acme", role: "editor" }),
    declineInvitation: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

  it("ASKS rather than accepting on open", async () => {
    // A link that acts on being opened is a link that acts when a mail client scans it.
    const a = acct();
    const v = render(<AcceptInvite account={a} token="t" onDone={() => {}} />);
    expect(a.acceptInvitation).not.toHaveBeenCalled();
    expect(v.container.textContent).toMatch(/salaries, runway and funding/i);
  });

  it("names the company after joining", async () => {
    const v = render(<AcceptInvite account={acct()} token="t" onDone={() => {}} />);
    fireEvent.click(v.getByText("Accept"));
    await waitFor(() => expect(v.container.textContent).toMatch(/joined Acme/i));
  });

  it("explains a wrong-address refusal instead of showing the code", async () => {
    const a = acct({ acceptInvitation: vi.fn().mockRejectedValue(new Error("wrong_email")) });
    const v = render(<AcceptInvite account={a} token="t" onDone={() => {}} />);
    fireEvent.click(v.getByText("Accept"));
    await waitFor(() => expect(v.container.textContent).toMatch(/sent to a different email address/i));
    // Still offers the way forward — this person holds a real invitation.
    expect(v.getByText("Accept")).toBeTruthy();
  });

  it("declining says nothing was shared", async () => {
    const a = acct();
    const v = render(<AcceptInvite account={a} token="t" onDone={() => {}} />);
    fireEvent.click(v.getByText("Decline"));
    await waitFor(() => expect(v.container.textContent).toMatch(/nothing was shared with you/i));
    expect(a.declineInvitation).toHaveBeenCalledWith("t");
  });
});
