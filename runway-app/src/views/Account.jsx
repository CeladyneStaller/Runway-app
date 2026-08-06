import React, { useEffect, useState } from "react";
import { getAccountApi, getAuthAdapter, getSessionProvider } from "../state/sync";
import { switchCompany, abandonCompany, flush } from "../state/storage";
import { passwordRules, passwordScore } from "../engine/password";
import { toJSON } from "../state/document";
import { DeleteCompany } from "./chrome/DeleteCompany";
import { Members } from "./chrome/Members";
import { CompanyTabs } from "./chrome/CompanyTabs";
import { QuickBooks } from "./chrome/QuickBooks";
import { SettingsShell, LockedNotice } from "./chrome/SettingsShell";
import { CompanyGeneral } from "./chrome/CompanyGeneral";
import { CompanyData } from "./chrome/CompanyData";
import { LandingSetting } from "./chrome/LandingSetting";
import { Portfolio } from "./chrome/Portfolio";
import { AdvisorBilling } from "./chrome/AdvisorBilling";
import { TAB_REGISTRY, isLocked } from "../state/tabprefs";
import { PLANS, planSummary, unpaidMessage, TRIAL_DAYS } from "../state/plans";

/** A date somebody can act on. `toLocaleDateString` and not a relative "in 12 days": the point of
 *  showing this is that the reader can put it in a calendar. */
const fmtDay = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

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
/** Plan, trial, seats, and the way to pay — FOR ONE COMPANY.
 *
 *  Reads `company_plan()`. The comment here used to say the opposite: that a plan is a property of an
 *  account and putting it on company rows was "exactly the confusion migration 009 existed to remove".
 *  024 reversed that, because per-account pricing could not express an advisor — `company_entitled`
 *  only ever consulted OWNERS, and an advisor is invited as an admin. A person can now be in several
 *  companies on several plans, so this panel is scoped to the active one. */
export function BillingSection({ account, companyId, onError }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!companyId) return () => { alive = false; };
    account?.companyPlan?.(companyId).then(p => { if (alive) setRow(p); }).catch(() => {});
    return () => { alive = false; };
  }, [account, companyId]);

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
                        onClick={() => go(() => account.checkout(companyId, p.id), p.id)}>
                  {busy === p.id ? "Opening…" : `Choose ${p.name}`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {(s.state === "active" || s.state === "past_due") && (
        <button className="linkbtn" disabled={!!busy}
                onClick={() => go(() => account.billingPortal(companyId), "portal")}>
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
  const [binned, setBinned] = useState([]);

  // What is still recoverable. Loaded alongside the live list rather than behind a disclosure, because
  // somebody who has just deleted the wrong thing should not have to discover that a way back exists.
  useEffect(() => {
    let alive = true;
    account.listDeletedCompanies?.()
      .then(rows => { if (alive) setBinned(rows || []); })
      .catch(() => { if (alive) setBinned([]); });   // an older server simply has no such RPC
    return () => { alive = false; };
  }, [account, companies]);

  const restore = async (id) => {
    setError(null); setBusy(true);
    try {
      await account.restoreCompany(id);
      setBinned(b => b.filter(c => c.id !== id));
      await onReload();
    } catch (e) { setError(e?.message || "Could not restore that company."); }
    setBusy(false);
  };

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

      {binned.length > 0 && (
        <div className="acct-binned">
          <div className="acct-binned-h">Recently deleted</div>
          {binned.map(c => (
            <div key={c.id} className="acct-row">
              <div>
                <div className="acct-row-t">{c.name}</div>
                {/* The DATE it stops being recoverable, not "30 days" — a window somebody has to do
                    arithmetic on is one they will get wrong on the last day of it. */}
                <div className="acct-row-s">
                  Deleted {fmtDay(c.deleted_at)} · recoverable until {fmtDay(c.purges_at)}
                  {c.restores_in_window > 1 && (
                    <span className="acct-warn"> · restored {c.restores_in_window} times recently</span>
                  )}
                </div>
              </div>
              <div className="acct-row-a">
                <button className="linkbtn" disabled={busy} onClick={() => restore(c.id)}>Restore</button>
              </div>
            </div>
          ))}
        </div>
      )}

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

/** Which pages live under which entry point.
 *
 *  THE RULE IS ONE QUESTION: does changing it affect anybody else? Password, appearance, your advisor
 *  plan and your data follow YOU across every company. Name, plan, people, tabs and connections belong
 *  to THIS company and are shared.
 */
export const PROFILE_PAGES = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "advisor", label: "Advisor plan" },
  { id: "data", label: "Your data" },
];

export const COMPANY_PAGES = [
  { id: "general", label: "General", owner: true },
  { id: "plan", label: "Plan & seats", owner: true },
  { id: "people", label: "People" },
  { id: "tabs", label: "Tabs", owner: true },
  { id: "connections", label: "Connections", owner: true },
  // OWNER-ONLY, INCLUDING EXPORT. An export is a complete copy of this company's payroll, grants and
  // cash position — reading it on screen and walking out with the file are different acts.
  { id: "data", label: "Data", owner: true },
];

export function Account({ doc, onSwitched, onClose, onNewCompany, tabPrefs, onTabPrefs,
                          scope = "profile", page = null, onGo, onExport, onImport , setDoc = () => {} }) {
  const account = getAccountApi();
  const session = getSessionProvider();
  const auth = getAuthAdapter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [err, setErr] = useState(null);
  const [deletingCo, setDeletingCo] = useState(null);
  // WHETHER THE PORTFOLIO EXISTS FOR THIS PERSON, which the landing setting needs to know before it can
  // offer it. Fetched rather than assumed from `companies` — advising is a flag on the profile, not a
  // count of memberships.
  const [advisorPlan, setAdvisorPlan] = useState(null);
  useEffect(() => {
    let alive = true;
    // `?.()` GUARDS THE CALL, NOT THE CHAIN AFTER IT. Without the second `?.`, an account object
    // without `advisorPlan` returns undefined and `.then` throws DURING RENDER — which React reports as
    // "rendered more hooks than during the previous render", a message pointing nowhere near the cause.
    // 31 tests failed on this and none of them named it.
    account?.advisorPlan?.()?.then(p => { if (alive) setAdvisorPlan(p); })?.catch(() => {});
    return () => { alive = false; };
  }, [account]);

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

  // Which page, defaulting to the first in the chosen scope.
  const purgeWindow = 30;
  const pages = scope === "company" ? COMPANY_PAGES : PROFILE_PAGES;
  const at = pages.some(p => p.id === page) ? page : pages[0].id;
  const myRole = companies.find(c => c.id === activeId)?.role;
  // KNOWN, NOT ASSUMED. Before the company list loads — or if it fails — `myRole` is undefined, and
  // treating that as "not the owner" made every page show "only the owner can change this". That is a
  // false and unhelpful answer to a load failure: it tells somebody to go and ask a person who cannot
  // help them. Locking only when the role is KNOWN and not owner.
  const roleKnown = !!myRole;
  const isOwner = myRole === "owner";
  const activeCo = companies.find(c => c.id === activeId);

  // OWNER-ONLY PAGES ARE SHOWN AND DISABLED, NOT HIDDEN. A member who cannot find billing assumes it is
  // broken; one who sees it greyed with a reason knows who to ask.
  const marked = pages.map(p => ({ ...p, locked: !!p.owner && roleKnown && !isOwner }));
  const locked = !!marked.find(p => p.id === at)?.locked;

  const shell = (children) => (
    <SettingsShell
      section={scope === "company" ? (activeCo?.name || "This company") : "Your account"}
      title={pages.find(p => p.id === at)?.label || "Settings"}
      badge={scope === "company" && isOwner ? <span className="chip pro">You are the owner</span> : null}
      pages={marked} active={at} onGo={(id) => onGo?.(scope, id)} onBack={onClose}>
      {err && <div className="signin-error" role="alert">{err}</div>}
      {locked && <LockedNotice what={pages.find(p => p.id === at)?.label.toLowerCase()} />}
      <fieldset className="setfields" disabled={locked}>{children}</fieldset>
    </SettingsShell>
  );

  if (scope === "company") {
    return shell(<>
      {at === "general" && activeCo && (
        <>
          <CompanyGeneral company={activeCo} account={account} onRenamed={reload}
                          doc={doc} setDoc={setDoc} />

          {/* A TRIGGER AND A MODAL, not a panel. `DeleteCompany` is the confirmation dialog — it takes
              `onConfirm`/`onCancel` and renders only while a deletion is pending. Dropping it inline as
              though it were a section threw on `company.name` before the company list had loaded,
              which is why this page came up blank rather than half-drawn. */}
          <section className="panel danger">
            <div className="panel-h">
              <div>
                <h3>Delete this company</h3>
                <p>
                  Recoverable for {purgeWindow} days, then permanently removed. Everybody here loses
                  access immediately.
                </p>
              </div>
            </div>
            <div className="acct-row">
              <div>
                <div className="acct-row-t">{activeCo.name}</div>
                <div className="acct-row-s">Export first if you want a copy of the model</div>
              </div>
              <div className="acct-row-a">
                <button className="addbtn ghost danger" onClick={() => setDeletingCo(activeCo)}>
                  Delete company
                </button>
              </div>
            </div>
          </section>

          {deletingCo && (
            <DeleteCompany
              company={deletingCo}
              isActive={deletingCo.id === activeId}
              isLast={companies.length === 1}
              doc={doc}
              onCancel={() => setDeletingCo(null)}
              onConfirm={async () => { await doDelete(deletingCo); setDeletingCo(null); }}
            />
          )}
        </>
      )}
      {at === "plan" && <BillingSection account={account} companyId={activeId} onError={setErr} />}
      {at === "people" && <Members account={account} companyId={activeId} />}
      {at === "tabs" && <CompanyTabs account={account} companyId={activeId} role={myRole} />}
      {at === "connections" && <QuickBooks account={account} companyId={activeId} mode="settings" />}
      {at === "data" && (
        <CompanyData company={activeCo} doc={doc} canWrite={isOwner}
                     onExport={onExport} onImport={onImport} />
      )}
    </>);
  }

  return shell(<>
    {at === "profile" && (
      <PasswordSection account={account} session={session} email={email}
                       hasPassword={!!profile?.password_set_at} onChanged={reload} />
    )}
    {at === "appearance" && (
      <>
        <LandingSetting account={account} companies={companies}
                        isAdvisor={(advisorPlan?.allowed ?? 0) > 0}
                        value={profile?.landing || ""} onSaved={reload} />
        <LayoutSection prefs={tabPrefs} onChange={onTabPrefs} />
      </>
    )}
    {at === "advisor" && (
      <>
        <AdvisorBilling account={account} onError={setErr} />
        <Portfolio account={account} onOpen={async (id) => {
          try { await doSwitch(id); onSwitched?.(); } catch (e) { setErr(e?.message || String(e)); }
        }} />
      </>
    )}
    {at === "data" && (
      <>
      {/* EXPORT AND IMPORT OF A COMPANY'S MODEL MOVED TO COMPANY SETTINGS. Importing replaces what
          every member of a company sees, and a company picker on a page called "Your data" is a page
          title lying about the blast radius. What stays here is account-level: the companies you have,
          and deleting the account. */}
      <CompaniesSection
        account={account} companies={companies} activeId={activeId}
        onReload={reload} onSwitched={doSwitch} onDeleted={doDelete} doc={doc}
        onNewCompany={onNewCompany} />

      {/* LAST ON THE PAGE, deliberately. Deleting the account is the most destructive control in the
          product and belongs at the end, after everything somebody might have come here to do. */}
      <div className="acct-card">
        <DeleteAccount account={account} session={session} companies={companies} doc={doc} />
      </div>
      </>
    )}
  </>);

}
