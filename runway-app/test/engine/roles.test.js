// Roles. Every interesting case here is somebody trying to end up with more power than they started
// with, or a company ending up with nobody able to administer it.
import { describe, it, expect } from "vitest";
import {
  ROLES, rank, outranks, canInvite, grantableBy, roleChangeRefusal, removalRefusal, REFUSALS,
  seatsForPlan, seatsLeft, inviteRefusal, seatSummary, mayGrant, canSeeTab, tabIsVisible,
} from "../../src/engine/roles.js";

describe("rank", () => {
  it("orders the four roles", () => {
    expect(ROLES.map(rank)).toEqual([1, 2, 3, 4]);
    expect(outranks("owner", "admin")).toBe(true);
    expect(outranks("editor", "editor")).toBe(false);
  });

  it("ranks an unknown role LOWEST rather than throwing", () => {
    // Fed by a server response. A role added in a later migration must degrade to least privilege, not
    // crash a members list — and must never accidentally outrank an owner.
    for (const junk of [undefined, null, "", "superuser", 42, {}]) {
      expect(rank(junk)).toBe(0);
      expect(outranks(junk, "viewer")).toBe(false);
    }
  });

  it("is case-insensitive, because roles arrive as text", () => {
    expect(rank("OWNER")).toBe(4);
  });
});

describe("who may invite, and to what", () => {
  it("editors and viewers cannot invite at all", () => {
    expect(canInvite("editor")).toBe(false);
    expect(canInvite("viewer")).toBe(false);
    expect(grantableBy("editor")).toEqual([]);
  });

  it("an admin may grant BELOW admin only — not admin, not owner", () => {
    // Corrected in 027. An admin who can mint admins can mint one out of their own second address, and
    // from there every other check in the schema is decorative. Only an owner appoints admins.
    expect(grantableBy("admin")).toEqual(["viewer", "editor"]);
  });

  it("an owner may appoint another owner", () => {
    // The one place equal-rank granting is allowed: a company with a single owner needs some way to
    // gain a second, and only an owner can be trusted with that.
    expect(mayGrant("owner", "owner")).toBe(true);
    expect(mayGrant("admin", "admin")).toBe(false);
  });

  it("an owner may grant anything", () => {
    expect(grantableBy("owner")).toEqual(["viewer", "editor", "admin", "owner"]);
  });
});

describe("changing a role", () => {
  const ok = (o) => roleChangeRefusal(o) === null;

  it("an owner may promote an editor to admin", () => {
    expect(ok({ actorRole: "owner", subjectRole: "editor", next: "admin", ownerCount: 1 })).toBe(true);
  });

  it("an admin may not create an owner OR another admin", () => {
    for (const next of ["owner", "admin"]) {
      expect(roleChangeRefusal({ actorRole: "admin", subjectRole: "editor", next, ownerCount: 1 }))
        .toBe("role_too_high");
    }
  });

  it("an advisor cannot be given any role but viewer", () => {
    expect(roleChangeRefusal({ actorRole: "owner", subjectRole: "viewer", next: "editor",
                               ownerCount: 1, subjectIsAdvisor: true })).toBe("advisor_is_viewer");
    expect(roleChangeRefusal({ actorRole: "owner", subjectRole: "viewer", next: "viewer",
                               ownerCount: 1, subjectIsAdvisor: true })).toBeNull();
  });

  it("agrees with may_grant() in migration 027", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/027_role_grants.sql", "utf8");
    const fn = sql.slice(sql.indexOf("function may_grant"), sql.indexOf("$$;", sql.indexOf("function may_grant")));
    expect(fn).toContain("p_mine = 'owner'");
    expect(fn).toContain("role_rank(p_target) < role_rank(p_mine)");
  });

  it("an admin may not demote an owner", () => {
    expect(roleChangeRefusal({ actorRole: "admin", subjectRole: "owner", next: "editor", ownerCount: 2 }))
      .toBe("forbidden");
  });

  it("an editor may not change anybody", () => {
    expect(roleChangeRefusal({ actorRole: "editor", subjectRole: "viewer", next: "editor", ownerCount: 1 }))
      .toBe("forbidden");
  });

  it("THE LAST OWNER CANNOT BE DEMOTED", () => {
    // A company with no owner cannot invite, cannot be deleted, and cannot be repaired by the customer.
    expect(roleChangeRefusal({ actorRole: "owner", subjectRole: "owner", next: "admin", ownerCount: 1 }))
      .toBe("last_owner");
    expect(ok({ actorRole: "owner", subjectRole: "owner", next: "admin", ownerCount: 2 })).toBe(true);
  });
});

describe("removing somebody", () => {
  const ok = (o) => removalRefusal(o) === null;

  it("anybody may leave, whatever their role", () => {
    for (const role of ROLES) {
      const owners = role === "owner" ? 2 : 1;
      expect(ok({ actorRole: role, subjectRole: role, isSelf: true, ownerCount: owners })).toBe(true);
    }
  });

  it("but the last owner cannot leave", () => {
    expect(removalRefusal({ actorRole: "owner", subjectRole: "owner", isSelf: true, ownerCount: 1 }))
      .toBe("last_owner");
  });

  it("an admin may remove an editor but NOT an owner or another admin", () => {
    // 029. An admin who cannot appoint an admin but can remove one has a lateral attack: take out the
    // other admins and you are the only one left holding a role you could not have granted yourself.
    expect(ok({ actorRole: "admin", subjectRole: "editor", isSelf: false, ownerCount: 1 })).toBe(true);
    for (const subjectRole of ["admin", "owner"]) {
      expect(removalRefusal({ actorRole: "admin", subjectRole, isSelf: false, ownerCount: 2 }))
        .toBe("forbidden");
    }
  });

  it("an owner may remove an admin", () => {
    expect(ok({ actorRole: "owner", subjectRole: "admin", isSelf: false, ownerCount: 1 })).toBe(true);
  });

  it("appointment and removal use the SAME rank rule, so they cannot drift", () => {
    for (const actorRole of ROLES) for (const subjectRole of ROLES) {
      const mayAppoint = roleChangeRefusal({ actorRole, subjectRole: "viewer", next: subjectRole,
                                             ownerCount: 2 }) === null;
      const mayRemove = removalRefusal({ actorRole, subjectRole, isSelf: false, ownerCount: 2 }) === null;
      expect(mayRemove, `${actorRole} on ${subjectRole}`).toBe(mayAppoint);
    }
  });

  it("an editor may remove nobody but themselves", () => {
    expect(removalRefusal({ actorRole: "editor", subjectRole: "viewer", isSelf: false, ownerCount: 1 }))
      .toBe("forbidden");
    expect(ok({ actorRole: "editor", subjectRole: "editor", isSelf: true, ownerCount: 1 })).toBe(true);
  });
});

describe("the refusal messages", () => {
  it("cover every reason the rules can return", () => {
    const reasons = new Set();
    for (const actorRole of ROLES) for (const subjectRole of ROLES) for (const next of ROLES) {
      for (const ownerCount of [1, 2]) {
        const a = roleChangeRefusal({ actorRole, subjectRole, next, ownerCount });
        const b = removalRefusal({ actorRole, subjectRole, isSelf: false, ownerCount });
        if (a) reasons.add(a);
        if (b) reasons.add(b);
      }
    }
    for (const r of reasons) expect(REFUSALS[r], `no message for "${r}"`).toBeTruthy();
  });

  it("says what to DO about the last owner, not just that it is refused", () => {
    expect(REFUSALS.last_owner).toMatch(/make somebody else an owner/i);
  });

  it("tells somebody with the wrong email what their options are", () => {
    // They are a real person holding a real invitation. "Invalid" would be a dead end.
    expect(REFUSALS.wrong_email).toMatch(/sign in as that address|ask for an invitation/i);
  });
});

describe("the SQL and this module agree", () => {
  it("uses the same rank order as role_rank() in migration 021", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/021_invitations.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function role_rank"), sql.indexOf("$$;", sql.indexOf("create or replace function role_rank")));
    // owner 4, admin 3, editor 2, else 1 — the one place a divergence would silently permit escalation.
    expect(fn).toMatch(/'owner'\s+then\s+4/);
    expect(fn).toMatch(/'admin'\s+then\s+3/);
    expect(fn).toMatch(/'editor'\s+then\s+2/);
    for (const role of ROLES) expect(rank(role)).toBeGreaterThan(0);
  });

  it("names the same refusal codes the SQL raises", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/021_invitations.sql", "utf8");
    for (const code of ["role_too_high", "last_owner", "already_member", "invalid_email",
                        "invalid_invitation", "wrong_email"]) {
      expect(sql, `SQL never raises ${code}`).toContain(`'${code}'`);
      expect(REFUSALS[code], `no message for ${code}`).toBeTruthy();
    }
  });
});

describe("seats", () => {
  it("matches plan_seats() in migration 022", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/022_company_subscriptions.sql", "utf8");
    const fn = sql.slice(sql.indexOf("function plan_seats"), sql.indexOf("end $$", sql.indexOf("function plan_seats")));
    expect(fn).toMatch(/'solo'\s+then\s+1/);
    expect(fn).toMatch(/'collaborative'\s+then\s+3/);
    expect(fn).toMatch(/'connected'\s+then\s+5/);
    expect(seatsForPlan("solo")).toBe(1);
    expect(seatsForPlan("collaborative")).toBe(3);
    expect(seatsForPlan("connected")).toBe(5);
  });

  it("gives an unpaid or unknown plan NO seats", () => {
    for (const p of [undefined, null, "", "enterprise", 7]) expect(seatsForPlan(p)).toBe(0);
  });

  it("keeps the retired advisor tier on 3, so a live subscriber is not zeroed by a rename", () => {
    expect(seatsForPlan("advisor")).toBe(3);
  });

  it("counts a pending invitation as a taken seat", () => {
    expect(seatsLeft({ seats: 3, used: 1, pending: 1 })).toBe(1);
    expect(inviteRefusal({ actorRole: "owner", usage: { seats: 3, used: 2, pending: 1 } }))
      .toBe("no_seats_left");
  });

  it("never reports negative seats after a downgrade", () => {
    // Three members on a plan that now has one seat is legitimate and non-destructive; "-2 remaining"
    // would read as a bug in the app rather than as a billing state.
    expect(seatsLeft({ seats: 1, used: 3, pending: 0 })).toBe(0);
  });

  it("lets an advisor be invited into a full company", () => {
    expect(inviteRefusal({ actorRole: "owner", usage: { seats: 1, used: 1 }, asAdvisor: true })).toBeNull();
  });

  it("still refuses an editor, seats or not", () => {
    expect(inviteRefusal({ actorRole: "editor", usage: { seats: 5, used: 0 } })).toBe("forbidden");
  });

  it("explains an over-capacity company without implying anybody was removed", () => {
    const msg = seatSummary({ seats: 1, used: 3, pending: 0 });
    expect(msg).toMatch(/owner can still save/i);
    expect(msg).toMatch(/nobody has been removed/i);
  });

  it("says plainly when a company has no subscription at all", () => {
    expect(seatSummary({ seats: 0, used: 2 })).toMatch(/no subscription/i);
  });
});

describe("the seat refusals reach a person", () => {
  it("names a fix for a full company rather than just the state", () => {
    expect(REFUSALS.no_seats_left).toMatch(/remove somebody|cancel an invitation|larger plan/i);
  });

  it("tells somebody without a seat what they CAN still do", () => {
    // They are a member of a company they can no longer save to. "Permission denied" would send them
    // to the wrong person; this sends them to an owner.
    expect(REFUSALS.no_seat).toMatch(/read it but not save/i);
    expect(REFUSALS.no_seat).toMatch(/ask an owner/i);
  });

  it("matches the SQLSTATEs 022, 023 and 025 raise", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = ["022_company_subscriptions", "023_save_seat_check", "025_invite_seats"]
      .map(f => readFileSync(`supabase/migrations/${f}.sql`, "utf8")).join("\n");
    for (const code of ["no_seat", "no_seats_left"]) {
      expect(sql, `SQL never raises ${code}`).toContain(`'${code}'`);
      expect(REFUSALS[code], `no message for ${code}`).toBeTruthy();
    }
  });
});

describe("tab visibility — the first rules that gate READING", () => {
  const vis = (view, o) => tabIsVisible(view, o);

  it("shows Scenarios to owners and admins, not to editors or viewers", () => {
    expect(canSeeTab("scn", { role: "owner" })).toBe(true);
    expect(canSeeTab("scn", { role: "admin" })).toBe(true);
    expect(canSeeTab("scn", { role: "editor" })).toBe(false);
    expect(canSeeTab("scn", { role: "viewer" })).toBe(false);
  });

  it("shows Scenarios to an ADVISOR, who is a viewer", () => {
    // Modelling "what if we cut two roles" is most of what an advisor is for. Their work lands in
    // their own layer (028), not the company's document.
    expect(canSeeTab("scn", { role: "viewer", isAdvisor: true })).toBe(true);
  });

  it("gates nothing else", () => {
    for (const view of ["dash", "flow", "pay", "proj", "sales", "inv", "hist", "ms"]) {
      expect(canSeeTab(view, { role: "viewer" })).toBe(true);
    }
  });

  it("the OWNER's company setting removes a tab for everybody", () => {
    expect(vis("inv", { role: "owner", companyHidden: ["inv"] })).toBe(false);
    expect(vis("inv", { role: "editor", companyHidden: ["inv"] })).toBe(false);
  });

  it("a member cannot un-hide what the owner turned off", () => {
    // The personal layer is subtractive only. There is no personal setting that adds a tab back.
    expect(vis("sales", { role: "editor", companyHidden: ["sales"], personalHidden: [] })).toBe(false);
  });

  it("and the owner cannot force a tab onto somebody's own screen", () => {
    // The two layers answer different questions and neither overrides the other.
    expect(vis("sales", { role: "owner", companyHidden: [], personalHidden: ["sales"] })).toBe(false);
  });

  it("a locked tab survives every layer", () => {
    // The Dashboard is the fallback whenever the current view disappears. A company that hid it would
    // leave members landing on nothing.
    expect(vis("dash", { role: "viewer", companyHidden: ["dash"], personalHidden: ["dash"], locked: true }))
      .toBe(true);
  });

  it("the role gate wins over both layers, in the direction that hides", () => {
    expect(vis("scn", { role: "editor", companyHidden: [], personalHidden: [] })).toBe(false);
  });
});

describe("an unknown role does not hide anything", () => {
  it("shows a gated tab when the role has not loaded yet", () => {
    // Caught by an existing tabprefs test. A tab missing because a role had not arrived is worse than
    // one briefly present, because this gate protects nothing — it is focus, not access control.
    for (const role of [undefined, null, ""]) expect(canSeeTab("scn", { role })).toBe(true);
    expect(tabIsVisible("scn", {})).toBe(true);
  });

  it("but hides it once the role is actually known", () => {
    expect(canSeeTab("scn", { role: "editor" })).toBe(false);
  });
});
