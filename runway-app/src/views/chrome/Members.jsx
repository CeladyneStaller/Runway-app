// Who is in this company, how many seats are used, and how to invite somebody.
//
// The rules are enforced in the database (021, 022, 025). This screen exists so it offers only what
// the server will accept: roles above your own are not in the dropdown, and a full company says so
// before you type an address rather than after.
import React, { useCallback, useEffect, useState } from "react";
import { I } from "./icons";
import { ROLES, grantableBy, canInvite, roleChangeRefusal, removalRefusal,
         seatSummary, seatsLeft, REFUSALS } from "../../engine/roles";

const label = (r) => r.charAt(0).toUpperCase() + r.slice(1);

/** Server refusals arrive as a message string; map the known codes to a sentence and pass anything
 *  else through. A raw SQLSTATE on screen helps nobody, and inventing a friendly message for an error
 *  we did not anticipate hides the one thing worth reporting. */
const explain = (e) => {
  const raw = String(e?.message || e || "");
  for (const code of Object.keys(REFUSALS)) if (raw.includes(code)) return REFUSALS[code];
  return raw || "That did not work.";
};

export function Members({ account, companyId, canManage }) {
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [usage, setUsage] = useState(null);
  const [mine, setMine] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [link, setLink] = useState(null);

  const load = useCallback(async () => {
    if (!account?.listMembers || !companyId) return;
    try {
      const [ms, plan] = await Promise.all([
        account.listMembers(companyId),
        account.companyPlan?.(companyId).catch(() => null),
      ]);
      setMembers(ms);
      setMine(ms.find(m => m.is_me)?.role ?? null);
      setUsage(plan ? { seats: plan.seats, used: plan.used, pending: plan.pending } : null);
      if (canInvite(ms.find(m => m.is_me)?.role)) {
        setInvites(await account.listInvitations(companyId).catch(() => []));
      }
    } catch (e) { setMsg({ bad: true, text: explain(e) }); }
  }, [account, companyId]);

  useEffect(() => { void load(); }, [load]);

  if (!account?.listMembers || !companyId) return null;

  const owners = members.filter(m => m.role === "owner").length;
  const manage = canManage !== false && canInvite(mine);
  const full = usage ? seatsLeft(usage) <= 0 : false;

  const run = async (fn) => {
    setBusy(true); setMsg(null);
    try { await fn(); await load(); }
    catch (e) { setMsg({ bad: true, text: explain(e) }); }
    setBusy(false);
  };

  const invite = () => run(async () => {
    const { url } = await account.inviteMember(companyId, email, role);
    // THE LINK IS SHOWN ONCE AND CANNOT BE FETCHED AGAIN — `list_invitations` deliberately cannot
    // return it. So it stays on screen until dismissed rather than disappearing on the next render.
    setLink({ url, email });
    setEmail("");
  });

  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h3>People</h3>
          <p>{usage ? seatSummary(usage) : "Loading…"}</p>
        </div>
      </div>

      <div>
        {members.map(m => {
          const refusal = roleChangeRefusal({ actorRole: mine, subjectRole: m.role,
                                              next: m.role, ownerCount: owners });
          // An advisor is always a viewer (027), so the dropdown would be a control whose every option
          // the server rejects.
          const mayEdit = manage && !refusal && !m.is_me && !m.is_advisor;
          const mayRemove = !removalRefusal({ actorRole: mine, subjectRole: m.role,
                                              isSelf: m.is_me, ownerCount: owners })
                            && (manage || m.is_me);
          return (
            <div className="acct-row" key={m.user_id}>
              <div>
                <div className="acct-row-t">{m.email}{m.is_me && <span className="acct-badge">you</span>}</div>
                <div className="acct-row-s">
                  {m.is_advisor
                    ? "Advisor · holds no seat"
                    : `Joined ${new Date(m.joined_at).toLocaleDateString()}`}
                </div>
              </div>
              <div className="acct-row-a">
                {/* THREE FACTS, THREE SHAPES. Role is one family because the four are the same kind of
                    thing; advisor is a different axis and gets its own colour, or people read it as a
                    fifth role ranking above or below Admin; over-capacity is a STATE rather than an
                    identity, so it sits beside the role instead of replacing it. */}
                {m.is_advisor && <span className="chip chip-advisor">Advisor</span>}
                {!m.is_advisor && m.has_seat === false && (
                  <span className="chip bad" title="This company has more people than seats">
                    No seat
                  </span>
                )}
                {mayEdit ? (
                  <select className="sel" value={m.role} disabled={busy}
                          aria-label={`Role for ${m.email}`}
                          onChange={e => run(() => account.setMemberRole(companyId, m.user_id, e.target.value))}>
                    {/* Only what this person may actually grant. Offering `owner` to an admin would be a
                        dropdown that fails on selection. */}
                    {grantableBy(mine).map(r => <option key={r} value={r}>{label(r)}</option>)}
                  </select>
                ) : <span className="chip">{label(m.role)}</span>}
                {mayRemove && (
                  <button className="linkbtn" disabled={busy}
                          onClick={() => run(() => account.removeMember(companyId, m.user_id))}>
                    {m.is_me ? "Leave" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {manage && (
        <div className="members-invite">
          <div className="acct-binned-h">Invite somebody</div>
          {/* SAID BEFORE THEY TYPE AN ADDRESS, not after they submit one. */}
          {full && <p className="acct-row-s">{REFUSALS.no_seats_left}</p>}
          <div className="members-form">
            <input className="inp" type="email" placeholder="name@example.com" value={email}
                   aria-label="Email to invite" disabled={busy || full}
                   onChange={e => setEmail(e.target.value)} />
            <select className="sel" value={role} aria-label="Role to invite as" disabled={busy || full}
                    onChange={e => setRole(e.target.value)}>
              {grantableBy(mine).map(r => <option key={r} value={r}>{label(r)}</option>)}
            </select>
            <button className="addbtn ghost" disabled={busy || full || !email.trim()} onClick={invite}>
              {I.plus} Invite
            </button>
          </div>

          {link && (
            <div className="members-link">
              <div className="acct-row-s">
                <b>Send this link to {link.email}.</b> It works once, only for that address, and expires
                in 14 days. It is not shown again — re-invite to issue a new one.
              </div>
              <input className="inp" readOnly value={link.url} aria-label="Invitation link"
                     onFocus={e => e.target.select()} />
              <button className="linkbtn" onClick={() => setLink(null)}>Done</button>
            </div>
          )}

          {invites.length > 0 && (
            <div className="members-pending">
              <div className="acct-binned-h">Invited, not yet joined</div>
              {invites.map(i => (
                <div className="acct-row" key={i.id}>
                  <div>
                    <div className="acct-row-t">{i.email}</div>
                    <div className="acct-row-s">
                      {label(i.role)} · holding a seat until {new Date(i.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="acct-row-a">
                    <button className="linkbtn" disabled={busy}
                            onClick={() => run(() => account.revokeInvitation(i.id))}>Cancel</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <p className={"acct-row-s " + (msg.bad ? "acct-warn" : "")}>{msg.text}</p>}
    </section>
  );
}

/** The other end of the link. Shown when the app opens with `?invite=…`.
 *
 *  It does NOT accept automatically. Joining a company is a decision, and a link that acts on being
 *  opened is a link that acts when it is scanned by a mail client. */
export function AcceptInvite({ account, token, onDone }) {
  const [state, setState] = useState("asking");
  const [msg, setMsg] = useState(null);
  const [joined, setJoined] = useState(null);

  const accept = async () => {
    setState("working"); setMsg(null);
    try {
      const row = await account.acceptInvitation(token);
      setJoined(row); setState("joined");
    } catch (e) { setMsg(explain(e)); setState("asking"); }
  };

  const decline = async () => {
    setState("working");
    try { await account.declineInvitation(token); } catch { /* declining twice is not an error */ }
    setState("declined");
  };

  if (state === "joined") {
    return (
      <div className="invite-card">
        <h3>You have joined {joined?.company_name || "the company"}.</h3>
        <button className="rvbtn go" onClick={() => onDone(joined)}>Open it</button>
      </div>
    );
  }
  if (state === "declined") {
    return (
      <div className="invite-card">
        <h3>Invitation declined.</h3>
        <p>Nothing was shared with you, and the person who invited you can see that you declined.</p>
        <button className="linkbtn" onClick={() => onDone(null)}>Continue</button>
      </div>
    );
  }

  return (
    <div className="invite-card">
      <h3>You have been invited to a company</h3>
      <p>
        Accepting gives you access to its cash model — salaries, runway and funding. You must be signed
        in as the address the invitation was sent to.
      </p>
      {msg && <p className="acct-warn">{msg}</p>}
      <div className="members-form">
        <button className="rvbtn go" disabled={state === "working"} onClick={accept}>Accept</button>
        <button className="linkbtn" disabled={state === "working"} onClick={decline}>Decline</button>
      </div>
    </div>
  );
}
