// Roles, and who may do what to whom.
//
// These rules exist in SQL — `role_rank`, `invite_member`, `set_member_role`, `remove_member` in
// migration 021 — and the database is the enforcement. This module exists so the UI can offer only the
// roles a person may actually grant, rather than offering all four and letting the server refuse.
//
// TWO COPIES OF A RULE IS A RISK, and this codebase has been bitten by it (three CORS header lists, two
// isolation suites). It is accepted here for one reason: the alternative is a UI that presents choices
// which fail on submit, and a permissions dropdown that lies is worse than a duplicated comparison.
// The tests below encode the SQL's behaviour so a divergence shows up as a failure rather than as a
// confusing error in production.

export const ROLES = Object.freeze(["viewer", "editor", "admin", "owner"]);

const RANK = Object.freeze({ viewer: 1, editor: 2, admin: 3, owner: 4 });

/** Unknown roles rank lowest rather than throwing: this is fed by a server response, and a role added
 *  in a later migration must degrade to "least privilege" rather than crash a members list. */
export const rank = (role) => RANK[String(role || "").toLowerCase()] ?? 0;

export const outranks = (a, b) => rank(a) > rank(b);
export const atLeast = (role, floor) => rank(role) >= rank(floor);

/** May this role invite anybody at all? Admin and above, matching `invite_member`. */
export const canInvite = (role) => atLeast(role, "admin");

/** The roles this role may hand out — never above its own. An admin able to mint owners can promote
 *  themselves by inviting their own second address, which makes every other check decorative. */
export const grantableBy = (role) => (canInvite(role) ? ROLES.filter(r => rank(r) <= rank(role)) : []);

/** May `actor` change `subject`'s role, and to `next`? Mirrors `set_member_role`.
 *  Returns null when allowed, or a reason code matching the SQL's SQLSTATEs. */
export function roleChangeRefusal({ actorRole, subjectRole, next, ownerCount }) {
  if (!canInvite(actorRole)) return "forbidden";
  if (rank(next) > rank(actorRole)) return "role_too_high";
  // An admin may not touch an owner. Otherwise the junior role can take the company.
  if (rank(subjectRole) > rank(actorRole)) return "forbidden";
  // The last owner cannot be demoted: a company with no owner cannot invite, cannot be deleted, and
  // cannot be repaired by the customer.
  if (subjectRole === "owner" && next !== "owner" && (ownerCount ?? 0) <= 1) return "last_owner";
  return null;
}

/** May `actor` remove `subject`? Mirrors `remove_member`. Leaving is always allowed except for the
 *  last owner, because nobody should need permission to stop being in a company. */
export function removalRefusal({ actorRole, subjectRole, isSelf, ownerCount }) {
  if (!isSelf) {
    if (!canInvite(actorRole)) return "forbidden";
    if (rank(subjectRole) > rank(actorRole)) return "forbidden";
  }
  if (subjectRole === "owner" && (ownerCount ?? 0) <= 1) return "last_owner";
  return null;
}

/** What to put on screen. The SQLSTATE names are the server's; these are the sentences. */
export const REFUSALS = Object.freeze({
  no_seats_left: "Every seat on this plan is taken, including any pending invitations. " +
                 "Remove somebody, cancel an invitation, or move to a larger plan.",
  no_seat: "This company's seats are all taken, so you can read it but not save changes. " +
           "Ask an owner for a seat.",
  forbidden: "You do not have permission to do that.",
  role_too_high: "You cannot give somebody a role above your own.",
  last_owner: "A company needs at least one owner. Make somebody else an owner first.",
  already_member: "They are already in this company.",
  invalid_email: "That does not look like an email address.",
  invalid_invitation: "That invitation link is not valid any more. Ask for a new one.",
  wrong_email: "That invitation was sent to a different email address. Sign in as that address, " +
               "or ask for an invitation to this one.",
});

// ---- seats -------------------------------------------------------------------
// Mirrors `plan_seats()` and `company_seat_usage()` in migration 022, for the same reason as the role
// rules above: a members screen that offers an invitation the server will refuse is worse than one that
// tells you the seats are full.

export const PLAN_SEATS = Object.freeze({ solo: 1, collaborative: 3, connected: 5, advisor: 3 });

/** Unknown or absent plan means NO seats, matching the SQL's `else 0` — an unpaid company has none.
 *  `advisor` is the retired tier, mapped to 3 so a live subscriber is never reduced to zero by a rename. */
export const seatsForPlan = (plan) => PLAN_SEATS[String(plan || "").toLowerCase()] ?? 0;

/** Seats left, counting pending invitations as taken — because they are. Never negative: a downgrade
 *  legitimately leaves more members than seats, and reporting "-2 remaining" would read as a bug. */
export const seatsLeft = ({ seats = 0, used = 0, pending = 0 }) => Math.max(0, seats - used - pending);

/** Why an invitation cannot be sent, or null. Advisors are exempt and never consume one. */
export function inviteRefusal({ actorRole, usage, asAdvisor = false }) {
  if (!canInvite(actorRole)) return "forbidden";
  if (asAdvisor) return null;
  if (seatsLeft(usage || {}) <= 0) return "no_seats_left";
  return null;
}

/** What the members screen says about capacity. Plain, and it names the fix rather than the state. */
export function seatSummary(usage = {}) {
  const { seats = 0, used = 0, pending = 0 } = usage;
  if (seats === 0) return "This company has no subscription, so nobody can save changes to it.";
  const left = seatsLeft(usage);
  const over = used + pending - seats;
  if (over > 0) {
    return `${used + pending} people for ${seats} seats. The owner can still save; everybody else is ` +
           "read-only until a seat frees up or the plan changes. Nobody has been removed.";
  }
  const pendingBit = pending ? `, ${pending} held by pending invitation${pending === 1 ? "" : "s"}` : "";
  return `${used} of ${seats} seats used${pendingBit}. ${left} left.`;
}
