import React, { useEffect, useState } from "react";
import { getAccountApi, getAuthAdapter, getSessionProvider } from "../state/sync";
import { switchCompany, abandonCompany, flush } from "../state/storage";
import { passwordRules, passwordScore } from "../engine/password";
import { toJSON } from "../state/document";
import { DeleteCompany } from "./chrome/DeleteCompany";
import { TAB_REGISTRY, isLocked } from "../state/tabprefs";
import { PLANS, planSummary, unpaidMessage, TRIAL_DAYS } from "../state/plans";

// Account-level settings, as distinct from the model. Reached from the email in the top bar rather than
// the main nav — it is about you, not about your runway.
//
// The password section is the reason this page exists at all: signing in with a magic link creates an
// account with no password, and "reset your password" is a strange door to walk through when you never
// had one. `profiles.password_set_at` is what lets this say something true rather than hedging.

function PasswordSection({ account, session, hasPassword, email, onChanged }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const rules = passwordRules(password, { email, confirm });
  const { passed, total } = passwordScore(password, { email, confirm });
  const ready = rules.every(r => r.ok) && (!hasPassword || current.length > 0);

  const submit = async () => {
    setError(null); setDone(false); setBusy(true);
    // Verifying the old password by attempting a sign-in needs no server support, and protects against
    // someone changing it on a borrowed laptop. Skipped entirely when there is nothing to verify.
    if (hasPassword) {
      const check = await session.signInWithPassword(email, current);
      if (!check.ok) { setBusy(false); setError("That current password isn't right."); return; }
    }
    const r = await session.updatePassword(password);
    if (!r.ok) { setBusy(false); setError(r.message); return; }
    try { await account.markPasswordSet(); } catch { /* the password is set either way */ }
    setBusy(false); setDone(true); setCurrent(""); setPassword(""); setConfirm("");
    onChanged?.();
  };

  return (
    <div className="acct-card">
      <h3>Password</h3>
      <p>{hasPassword
        ? "Change it here. You'll need the current one."
        : "You signed in with a link, so you don't have one yet. Setting one lets you sign in without email."}</p>

      {hasPassword && (<>
        <label className="signin-label" htmlFor="acct-current">Current password</label>
        <input id="acct-current" className="signin-input" type="password" autoComplete="current-password"
               value={current} onChange={(e) => setCurrent(e.target.value)} />
      </>)}

      <label className="signin-label" htmlFor="acct-new">{hasPassword ? "New password" : "Password"}</label>
      <input id="acct-new" className="signin-input" type="password" autoComplete="new-password"
             value={password} onChange={(e) => setPassword(e.target.value)} />

      <div className="pw-bar" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <span key={i} className={i < passed ? "on" : ""} />)}
      </div>
      <ul className="pw-rules">
        {rules.map(r => (
          <li key={r.id} className={r.ok ? "ok" : ""}><span aria-hidden="true">{r.ok ? "✓" : "○"}</span>{r.label}</li>
        ))}
      </ul>

      <label className="signin-label" htmlFor="acct-confirm">Confirm</label>
      <input id="acct-confirm" className="signin-input" type="password" autoComplete="new-password"
             value={confirm} onChange={(e) => setConfirm(e.target.value)} />

      {error && <div className="signin-error" role="alert">{error}</div>}
      {done && <div className="acct-ok">Password saved.</div>}

      <button className="addbtn signin-go" disabled={!ready || busy} onClick={submit}>
        {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
      </button>
    </div>
  );
}

/** Which tabs and sub-tabs to show.
 *
 *  A VIEW PREFERENCE ONLY: nothing here changes a number, and hiding a tab hides it from the nav, not
 *  from the app. A hash pointing at a hidden view still opens it, because this is decluttering rather
 *  than access control and a broken bookmark would be the bigger surprise. */
/** Plan, trial, and the way to pay.
 *
 *  Reads `my_plan()` — ONE call, so nothing has to be assembled from company rows. Plan is a property
 *  of an account, not a company, and putting it on company rows is exactly the confusion migration
 *  009 existed to remove. */
export function BillingSection({ account, onError }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    account?.myPlan?.().then(p => { if (alive) setRow(p); }).catch(() => {});
    return () => { alive = false; };
  }, [account]);

  const s = planSummary(row);
  const staff = row?.plan === "staff";

  const go = async (fn, key) => {
    setBusy(key);
    try { window.location.href = await fn(); }
    catch (e) { onError?.(e?.message || "Could not open billing."); setBusy(null); }
  };

  return (
    <section className="acct-sec">
      <h3>Billing</h3>

      {staff ? (
        <p className="signin-fine">This account is exempt from billing. Every company you own is
          editable regardless of plan.</p>
      ) : s.state === "trialing" ? (
        <p className="signin-fine">
          <b>{s.daysLeft} day{s.daysLeft === 1 ? "" : "s"} left</b> of your {TRIAL_DAYS}-day trial.
          No card needed until you choose a plan — and your model stays exportable whatever you decide.
        </p>
      ) : s.state === "active" || s.state === "past_due" ? (
        <p className="signin-fine">
          You're on <b>{s.plan?.name}</b>, ${s.plan?.price}/month.
          {s.lapsing
            ? ` Cancelled — access continues until ${s.periodEnd?.toLocaleDateString()}.`
            : s.periodEnd ? ` Renews ${s.periodEnd.toLocaleDateString()}.` : ""}
          {s.state === "past_due" && " Your last payment didn't go through; update your card to avoid interruption."}
        </p>
      ) : (
        // The message is shared with the save-refused banner so the two can never contradict.
        <p className="signin-fine">{unpaidMessage(s)}</p>
      )}

      {!staff && (
        <div className="plancards">
          {PLANS.map(p => (
            <div className={"plancard" + (s.plan?.id === p.id ? " on" : "")} key={p.id}>
              <div className="plancard-h">
                <b>{p.name}</b>
                <span className="plancard-price">${p.price}<em>/mo</em></span>
              </div>
              <p>{p.blurb}</p>
              <ul>{p.features.map((f, i) => <li key={i}>{f}</li>)}</ul>
              {p.comingSoon ? (
                <span className="plancard-soon">Not available yet</span>
              ) : s.plan?.id === p.id ? (
                <span className="plancard-soon">Your plan</span>
              ) : (
                <button className="addbtn plancard-go" disabled={!!busy}
                        onClick={() => go(() => account.checkout(p.id), p.id)}>
                  {busy === p.id ? "Opening…" : `Choose ${p.name}`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {(s.state === "active" || s.state === "past_due") && (
        <button className="linkbtn" disabled={!!busy}
                onClick={() => go(() => account.billingPortal(), "portal")}>
          {busy === "portal" ? "Opening…" : "Manage billing, card and invoices"}
        </button>
      )}
    </section>
  );
}

export function LayoutSection({ prefs, onChange }) {
  const hiddenViews = prefs?.views || [];
  const hiddenSubs = prefs?.subs || {};

  const toggleView = (view) => {
    const next = hiddenViews.includes(view)
      ? hiddenViews.filter(v => v !== view)
      : [...hiddenViews, view];
    onChange({ ...prefs, views: next, subs: hiddenSubs });
  };

  const toggleSub = (view, key, subs) => {
    const cur = hiddenSubs[view] || [];
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    // NEVER HIDE THE LAST ONE. A view whose sub-tabs are all hidden is a screen with an empty tab row
    // and no content. `visibleTabs` guarantees this at render time too; refusing here means the
    // checkbox does not appear to work and then silently not work.
    if (next.length >= subs.length) return;
    onChange({ ...prefs, views: hiddenViews, subs: { ...hiddenSubs, [view]: next } });
  };

  const hiddenCount = hiddenViews.length + Object.values(hiddenSubs).reduce((a, v) => a + v.length, 0);

  return (
    <section className="acct-sec">
      <h3>Layout</h3>
      <p className="signin-fine">
        Hide anything you don't use. This only affects what you see — nothing is deleted, no number
        changes, and you can bring it all back. Saved in this browser.
      </p>

      <div className="tabprefs">
        {TAB_REGISTRY.map(({ view, label, subs }) => {
          const off = hiddenViews.includes(view);
          return (
            <div className={"tabpref" + (off ? " off" : "")} key={view}>
              <label className="tabpref-h">
                <input type="checkbox" checked={!off} disabled={isLocked(view)}
                       onChange={() => toggleView(view)} aria-label={label} />
                <b>{label}</b>
                {isLocked(view) && <em>always shown</em>}
              </label>
              {subs.length > 0 && !off && (
                <div className="tabpref-subs">
                  {subs.map(([key, subLabel]) => {
                    const subOff = (hiddenSubs[view] || []).includes(key);
                    return (
                      <label className="tabpref-sub" key={key}>
                        <input type="checkbox" checked={!subOff}
                               onChange={() => toggleSub(view, key, subs)}
                               aria-label={`${label}: ${subLabel}`} />
                        {subLabel}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button className="linkbtn" onClick={() => onChange({ views: [], subs: {} })}>
          Show everything again ({hiddenCount} hidden)
        </button>
      )}
    </section>
  );
}

function CompaniesSection({ account, companies, activeId, onReload, onSwitched, onDeleted, onNewCompany, doc }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameTo, setRenameTo] = useState("");
  const [deleting, setDeleting] = useState(null);

  /** Excluding a company is applied in the job's QUERY, so its document is never read at all. */
  const optout = async (id, value) => {
    setError(null); setBusy(true);
    try { await account.setStatsOptout(id, value); await onReload(); }
    catch (e) { setError(e?.message || "Could not change that."); }
    setBusy(false);
  };

  const rename = async (id) => {
    setError(null); setBusy(true);
    try { await account.renameCompany(id, renameTo); setRenaming(null); await onReload(); }
    catch (e) { setError(e?.message || "Could not rename it."); }
    setBusy(false);
  };

  return (
    <div className="acct-card">
      <h3>Companies</h3>
      <p>Each has its own model, history and forecast journal. Nothing is shared between them.</p>

      {companies.map(c => (
        <div key={c.id} className="acct-row">
          {renaming === c.id ? (
            <>
              <input className="signin-input" style={{ marginBottom: 0 }} value={renameTo}
                     onChange={(e) => setRenameTo(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") rename(c.id); }} />
              <button className="linkbtn" disabled={busy} onClick={() => rename(c.id)}>Save</button>
            </>
          ) : (
            <>
              <div>
                <div className="acct-row-t">{c.name}{c.id === activeId && <span className="acct-badge">current</span>}</div>
                <div className="acct-row-s">{c.role}{c.has_document ? "" : " · empty"}</div>
                {/* AGGREGATE STATISTICS OPT-OUT. Per company, because the statistics are per
                    company and somebody may want one counted and not another. Owner-only: the RPC
                    enforces that too, but disabling it here means the control is not a lie. */}
                <label className="acct-optout" title="Published statistics never include anything about individual people">
                  <input type="checkbox" checked={!c.stats_optout} disabled={busy || c.role !== "owner"}
                         aria-label={`Include ${c.name} in published statistics`}
                         onChange={(e) => optout(c.id, !e.target.checked)} />
                  Include in published statistics
                </label>
              </div>
              <div className="acct-row-a">
                {c.id !== activeId && (
                  <button className="linkbtn" disabled={busy} onClick={() => onSwitched(c.id)}>Switch to</button>
                )}
                <button className="linkbtn" onClick={() => { setRenaming(c.id); setRenameTo(c.name); }}>Rename</button>
                {c.role === "owner" && (
                  <button className="linkbtn danger" onClick={() => setDeleting(c)}>Delete</button>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {error && <div className="signin-error" role="alert">{error}</div>}

      {/* NO NAME BOX HERE ANY MORE. Asking for a name, creating the company, and THEN opening a wizard
          whose own first question is the name meant typing it twice — and worse, the company row was
          written before the wizard ran, so cancelling out of it left an empty orphan company behind.
          The wizard now runs first and the company is created from what it collected, which means
          backing out creates nothing at all. */}
      <button className="addbtn ghost signin-go" onClick={onNewCompany}>Add company</button>

      {deleting && (
        <DeleteCompany
          company={deleting}
          isActive={deleting.id === activeId}
          isLast={companies.length === 1}
          doc={doc}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { await onDeleted(deleting); setDeleting(null); }}
        />
      )}
    </div>
  );
}

function DeleteAccount({ account, session, companies, doc }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const soleOwned = companies.filter(c => c.role === "owner");
  const shared = companies.length - soleOwned.length;
  const matches = typed.trim().toLowerCase() === "delete my account";

  const exportModel = () => {
    const blob = new Blob([toJSON(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runway-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const go = async () => {
    setError(null); setBusy(true);
    try {
      await account.deleteAccount();
      await session.signOut();       // the token is dead anyway; this clears it locally too
      window.location.reload();
    } catch (e) {
      setError(e?.message || "Could not delete the account.");
      setBusy(false);
    }
  };

  if (!open) return (
    <div className="acct-row">
      <div>
        <div className="acct-row-t" style={{ color: "var(--danger)" }}>Delete your account</div>
        <div className="acct-row-s">Your companies, your models, and your sign-in</div>
      </div>
      <button className="linkbtn danger" onClick={() => setOpen(true)}>Delete</button>
    </div>
  );

  return (
    <div className="del-account">
      <div className="del-facts">
        <div><b>Goes:</b> your sign-in, and {soleOwned.length === 1 ? "your company" : `all ${soleOwned.length} companies you own`} — every
          model, spend history and forecast journal in them.</div>
        {shared > 0 && (
          <div><b>Stays:</b> {shared === 1 ? "one company" : `${shared} companies`} you share with someone else.
            You'll simply stop being a member — closing your account shouldn't destroy their data.</div>
        )}
        <div><b>Cannot be undone.</b> There is no restore for this.</div>
      </div>

      <div className="cf-fine" style={{ borderLeft: "3px solid var(--caution)", paddingLeft: 10, margin: "12px 0" }}>
        This is the last moment you can take a copy.{" "}
        <button className="linkbtn" onClick={exportModel}>Export your model</button>
      </div>

      <label className="signin-label" htmlFor="del-acct">Type <b className="num">delete my account</b> to confirm</label>
      <input id="del-acct" className="signin-input" value={typed} autoComplete="off"
             onChange={(e) => setTyped(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Enter" && matches && !busy) go(); }} />

      {error && <div className="signin-error" role="alert">{error}</div>}

      <div className="cf-actions" style={{ marginTop: 12 }}>
        <button className="addbtn danger" disabled={!matches || busy} onClick={go}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
        <button className="addbtn ghost" disabled={busy} onClick={() => { setOpen(false); setTyped(""); setError(null); }}>
          Keep my account
        </button>
      </div>
    </div>
  );
}

export function Account({ doc, onSwitched, onClose, onNewCompany, tabPrefs, onTabPrefs }) {
  const account = getAccountApi();
  const session = getSessionProvider();
  const auth = getAuthAdapter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [err, setErr] = useState(null);

  const reload = async () => {
    if (!account) return;
    try {
      const [p, cs] = await Promise.all([account.profile(), account.listCompanies()]);
      setProfile(p); setCompanies(cs);
    } catch (e) { setErr(e?.message || "Could not load your account."); }
  };

  useEffect(() => { session?.current().then(setUser); reload(); /* eslint-disable-next-line */ }, []);

  const email = user?.user?.email || user?.email || "";
  const activeId = auth?.activeCompany?.() || profile?.last_company_id || null;

  const exportModel = () => {
    const blob = new Blob([toJSON(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runway-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doDelete = async (company) => {
    const remaining = companies.filter(c => c.id !== company.id);
    const next = remaining[0]?.id || null;

    await account.deleteCompany(company.id);

    if (company.id === activeId) {
      // abandonCompany deliberately does NOT flush: pending work belongs to the company we just removed,
      // and on a slow connection a flush could land after the delete and leave a document with no company.
      const r = await abandonCompany(auth, next);
      try { if (next) await account.setLastCompany(next); } catch { /* device choice already saved */ }
      await reload();
      onSwitched?.(r);
    } else {
      await reload();
    }
  };

  const doSwitch = async (id) => {
    const r = await switchCompany(auth, id);
    try { await account.setLastCompany(id); } catch { /* device choice already saved */ }
    await reload();
    onSwitched?.(r);
  };

  if (!account || !session) return null;

  return (
    <div className="rw acct-page">
      <div className="acct-head">
        <div>
          <span className="eyebrow">Account</span>
          <h2>{email}</h2>
        </div>
        <button className="addbtn ghost" onClick={onClose}>Back to your model</button>
      </div>

      {err && <div className="signin-error" role="alert">{err}</div>}

      <PasswordSection
        account={account} session={session} email={email}
        hasPassword={!!profile?.password_set_at}
        onChanged={reload}
      />

      <BillingSection account={account} onError={setErr} />

      <LayoutSection prefs={tabPrefs} onChange={onTabPrefs} />

      <CompaniesSection
        account={account} companies={companies} activeId={activeId}
        onReload={reload} onSwitched={doSwitch} onDeleted={doDelete} doc={doc}
        onNewCompany={onNewCompany}
      />

      <div className="acct-card">
        <h3>Your data</h3>
        <div className="acct-row">
          <div>
            <div className="acct-row-t">Download your model</div>
            <div className="acct-row-s">JSON, re-importable</div>
          </div>
          <button className="linkbtn" onClick={exportModel}>Export</button>
        </div>
        <div className="acct-row">
          <div>
            <div className="acct-row-t">Sign out</div>
            <div className="acct-row-s">Unsaved work is saved first</div>
          </div>
          <button className="linkbtn" onClick={async () => { await flush(); await session.signOut(); }}>Sign out</button>
        </div>
        <DeleteAccount account={account} session={session} companies={companies} doc={doc} />
      </div>
    </div>
  );
}
