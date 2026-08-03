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

/** May this role hand out that one? STRICTLY BELOW YOUR OWN, unless you are the owner.
 *
 *  An owner may appoint another owner, because a company with a single owner needs some way to gain a
 *  second and only an owner can be trusted with that. Everybody else grants strictly downwards: an
 *  admin who can mint admins can mint one out of their own second address, and from there every other
 *  check is decorative. Mirrors `may_grant()` in migration 027. */
export const mayGrant = (mine, target) => mine === "owner" || rank(target) < rank(mine);

export const grantableBy = (role) => (canInvite(role) ? ROLES.filter(r => mayGrant(role, r)) : []);

/** An advisor is a viewer, always. The attribute exists so somebody can be in a company without
 *  occupying a seat; a seat-free editor would be the seat model with a hole in it. */
export const roleForAdvisor = () => "viewer";

/** May `actor` change `subject`'s role, and to `next`? Mirrors `set_member_role`.
 *  Returns null when allowed, or a reason code matching the SQL's SQLSTATEs. */
export function roleChangeRefusal({ actorRole, subjectRole, next, ownerCount, subjectIsAdvisor = false }) {
  // An advisor's role is not a choice — refused rather than quietly ignored, so a UI offering the
  // dropdown at all is told why.
  if (subjectIsAdvisor && next !== "viewer") return "advisor_is_viewer";
  if (!canInvite(actorRole)) return "forbidden";
  if (!mayGrant(actorRole, next)) return "role_too_high";
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
    // SAME RANK RULE AS GRANTING (029). An admin who cannot appoint an admin but can remove one has a
    // lateral attack: take out the other admins and you are the only one left holding a role you could
    // not have granted yourself. The two rules only work as a pair.
    if (!canInvite(actorRole) || !mayGrant(actorRole, subjectRole)) return "forbidden";
  }
  if (subjectRole === "owner" && (ownerCount ?? 0) <= 1) return "last_owner";
  return null;
}

/** What to put on screen. The SQLSTATE names are the server's; these are the sentences. */
export const REFUSALS = Object.freeze({
  advisor_is_viewer: "Advisors are always viewers — they hold no seat, and plan in their own scenarios " +
                     "rather than in the company's model.",
  advisor_limit: "Your advisor plan covers a limited number of companies and is full. " +
                 "Upgrade to Advisor Unlimited, or leave a company first.",
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

// ---- what a role may SEE -----------------------------------------------------
// The first rules in this product that gate READING rather than writing. Everything before this asked
// "may you change it"; a tab gate asks "may you look at it", which is a different axis and needs
// saying out loud: today every member can read the whole document, so this is a UI decision about
// clutter and focus, NOT access control. The engine ships to the browser and anybody with devtools can
// run a projection. `plans.js` already carries the same reasoning about features.
//
// Enforceable read restrictions need the document split into addressable parts — task 3.8.

/** Tabs that only some roles are shown. Anything not listed is shown to everybody. */
export const ROLE_GATED_TABS = Object.freeze({
  // Scenarios is planning, not record. Owners and admins run it; an ADVISOR is a viewer who runs it
  // too, because modelling "what if we cut two roles" is most of what they are for.
  scn: ({ role, isAdvisor }) => isAdvisor || atLeast(role, "admin"),
});

/** May this person see this tab at all?
 *
 *  FAILS OPEN WHEN THE ROLE IS UNKNOWN, and that is deliberate. This gate is a UI decision about focus,
 *  not access control — the engine ships to the browser and anybody with devtools can run a projection,
 *  so hiding a tab protects nothing. Given that, a tab missing because a role had not loaded yet is a
 *  worse failure than a tab briefly present: `tabprefs.js` makes the same call for the same reason,
 *  defaulting to everything visible so a new tab appears for everyone rather than silently vanishing
 *  for anybody.
 *
 *  Real read restrictions need the document split into addressable parts (task 3.8) and will not be
 *  built on this. */
export function canSeeTab(view, { role, isAdvisor = false } = {}) {
  const rule = ROLE_GATED_TABS[view];
  if (!rule) return true;
  if (role == null || role === "") return true;
  return !!rule({ role, isAdvisor });
}

/** Company-level availability, personal decluttering, and the role gate, applied in that order.
 *
 *  THREE LAYERS, and the order is the design. The OWNER decides which tabs this company uses; each
 *  person then hides what they do not want from what remains; the role gate removes what they may not
 *  see regardless. A person cannot un-hide something the owner turned off, and the owner cannot force
 *  a tab back onto somebody's own screen — the two layers answer different questions and neither
 *  overrides the other.
 */
export function tabIsVisible(view, { companyHidden = [], personalHidden = [], role, isAdvisor = false,
                                     advisorFocus = null, locked = false } = {}) {
  if (locked) return true;                       // the Dashboard is the fallback and cannot vanish
  if (!canSeeTab(view, { role, isAdvisor })) return false;
  if (companyHidden.includes(view)) return false;

  // ADVISOR FOCUS — the owner deciding which tabs this advisor works on. A FOURTH layer, and the order
  // here is the rule: `companyHidden` is checked FIRST and is a floor. Focus can take away further,
  // never add back, so an advisor focused onto a tab the company has turned off still does not see it.
  //
  // `null` means no focus set, which is different from an empty list. An empty list would mean "no
  // tabs", and an advisor with no tabs is a removed advisor — the server refuses to store one.
  //
  // ⚠️ PRESENTATION ONLY. The document is delivered whole; this hides the tab and not the data. Every
  // label above this says "what they work on", never "what they can access".
  if (Array.isArray(advisorFocus) && !advisorFocus.includes(view)) return false;

  return !personalHidden.includes(view);
}
