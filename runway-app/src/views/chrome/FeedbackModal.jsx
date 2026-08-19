import { useState } from "react";
import { TAB_REGISTRY, subtabsOf } from "../../state/tabprefs";
import { FEEDBACK_KINDS, hintFor, collectContext } from "../../state/feedback";

/** Send feedback.
 *
 *  ⚠️ THE MESSAGE IS THE ONLY REQUIRED FIELD. Everything else is offered, and the two that make a
 *  report actionable are offered already ticked — **ticked and visible is consent; unticked is a field
 *  most people never find.**
 */
export function FeedbackModal({ where = {}, who = {}, onSend, onClose }) {
  const [kind, setKind] = useState("broken");
  const [tab, setTab] = useState(where.view || "");
  const [subtab, setSubtab] = useState(where.subtab || "");
  const [body, setBody] = useState("");
  const [withEmail, setWithEmail] = useState(true);
  const [email, setEmail] = useState(who.email || "");
  const [withContext, setWithContext] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(null);

  const ctx = collectContext({ view: tab || where.view, subtab: subtab || where.subtab }, who);
  const subs = tab ? subtabsOf(tab) : [];

  // Changing the tab invalidates the sub-tab: keeping "Fringe" after switching to Sales would file a
  // report against a pair that does not exist.
  const pickTab = (v) => { setTab(v); setSubtab(""); };

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true); setFailed(null);
    const r = await onSend({
      kind, body: body.trim(),
      tab: tab || null, subtab: subtab || null,
      reply_email: withEmail && email.trim() ? email.trim() : null,
      context: withContext ? ctx : {},
      company_id: who.companyId || null,
    });
    setBusy(false);
    if (r?.ok) setDone(true);
    else if (r?.error === "rate_limited")
      setFailed("That is a lot of feedback in one hour — try again shortly.");
    // The code is shown only when there is one: a person does not need it, but the person DEBUGGING
    // it does, and today those are the same person.
    else setFailed("That did not send. Your message is still here; try again in a moment."
      + (r?.code ? ` (${r.code})` : ""));
  };

  // ⚠️ THE CONFIRMATION SHOWS WHAT WAS SENT. The failure mode of a form is silence, and silence reads
  // as a void — but "thanks!" alone is the same void with a smile. Showing the message back is proof.
  if (done) return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card fb-card" role="dialog" aria-label="Feedback sent"
           onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <span className="modal-t">Sent — thank you</span>
          <span className="modal-s">
            {withEmail && email.trim() ? `We will reply to ${email.trim()}.` : "No reply address given, so we cannot write back."}
          </span>
        </div>
        <div className="modal-b">
          <div className="ctx fb-sent">{body.trim()}</div>
        </div>
        <div className="fb-foot">
          <span className="meta">Recorded, whatever happens to the email.</span>
          <span className="foot-btns"><button className="addbtn" onClick={onClose}>Close</button></span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card fb-card" role="dialog" aria-label="Send feedback"
           onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <span className="modal-t">Send feedback</span>
          <span className="modal-s">Read by a person. We reply if you leave an email.</span>
        </div>

        <div className="modal-b">
          <span className="fieldlab">What kind of thing is this?</span>
          <div className="fb-kinds">
            {FEEDBACK_KINDS.map(k => (
              <button key={k.id} className={"fb-kind" + (kind === k.id ? " on" : "")}
                      onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>

          <span className="fieldlab">Where in the app? <span className="opt">— optional</span></span>
          <div className="fb-row2">
            <select className="sel" value={tab} onChange={e => pickTab(e.target.value)}>
              <option value="">Choose a tab</option>
              {/* Hidden tabs are still listed — see `subtabChoices`. */}
              {TAB_REGISTRY.map(t => <option key={t.view} value={t.view}>{t.label}</option>)}
            </select>
            <select className="sel" value={subtab} disabled={!subs.length}
                    onChange={e => setSubtab(e.target.value)}>
              <option value="">{subs.length ? "Choose a sub-tab" : "—"}</option>
              {subs.map(st => <option key={st.id} value={st.id}>{st.label}</option>)}
            </select>
          </div>
          <div className="fieldhint">Sub-tab follows the tab you pick.</div>

          <span className="fieldlab fieldlab-gap">Tell us</span>
          <textarea className="fb-text fb-body" value={body} placeholder={hintFor(kind)}
                    onChange={e => setBody(e.target.value)} />

          <div className="tickblock">
            <label className="tickrow">
              <input type="checkbox" checked={withEmail}
                     onChange={e => setWithEmail(e.target.checked)} />
              <span>Include my email so we can reply</span>
            </label>
            {withEmail && (
              <div className="tickbody">
                <input className="fb-text" type="email" value={email}
                       placeholder="you@example.com"
                       onChange={e => setEmail(e.target.value)} />
              </div>
            )}
          </div>

          <div className="tickblock">
            <label className="tickrow">
              <input type="checkbox" checked={withContext}
                     onChange={e => setWithContext(e.target.checked)} />
              <span>Include details about my session</span>
            </label>
            {withContext && (
              <div className="tickbody">
                {/* ⚠️ SHOWN, NOT DESCRIBED. "Include diagnostics" asks for trust; showing the lines
                    earns it — and this audience is finance staff at institutions, who read. */}
                <div className="ctx">
                  tab: {ctx.tab || "—"} · sub-tab: {ctx.subtab || "—"} · plan: {ctx.plan || "—"}<br />
                  app {ctx.app} · {ctx.viewport || "—"}<br />
                  {ctx.company ? <>company: {ctx.company} <span className="dim">(name only)</span></>
                                : <span className="dim">no company</span>}
                </div>
                <div className="tickfine">No figures from your model are ever sent.</div>
              </div>
            )}
          </div>

          {failed && <div className="signin-error fb-err" role="alert">{failed}</div>}
        </div>

        <div className="fb-foot">
          <span className="meta">Nothing is sent until you press Send.</span>
          <span className="foot-btns">
            <button className="addbtn ghost" onClick={onClose}>Cancel</button>
            <button className="addbtn" disabled={!body.trim() || busy} onClick={submit}>
              {busy ? "Sending…" : "Send"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
