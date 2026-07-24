import React, { useEffect, useState } from "react";
import { getAccountApi, getAuthAdapter, getSessionProvider } from "../state/sync";
import { switchCompany, flush } from "../state/storage";
import { passwordRules, passwordScore } from "../engine/password";
import { toJSON } from "../state/document";

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

function CompaniesSection({ account, companies, activeId, onReload, onSwitched, doc }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameTo, setRenameTo] = useState("");

  const create = async () => {
    setError(null); setBusy(true);
    try {
      const id = await account.createCompany(name);
      await onSwitched(id);            // switching flushes first — see storage.switchCompany
      setAdding(false); setName("");
    } catch (e) { setError(e?.message || "Could not create it."); }
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
              </div>
              <div className="acct-row-a">
                {c.id !== activeId && (
                  <button className="linkbtn" disabled={busy} onClick={() => onSwitched(c.id)}>Switch to</button>
                )}
                <button className="linkbtn" onClick={() => { setRenaming(c.id); setRenameTo(c.name); }}>Rename</button>
              </div>
            </>
          )}
        </div>
      ))}

      {error && <div className="signin-error" role="alert">{error}</div>}

      {adding ? (
        <div style={{ marginTop: 12 }}>
          <p className="signin-fine">Starts empty — no cash, no people, no history. You'll switch to it once it's made.</p>
          <label className="signin-label" htmlFor="acct-newco">Name</label>
          <input id="acct-newco" className="signin-input" value={name} placeholder="Northwind Labs"
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && !busy) create(); }} />
          <button className="addbtn signin-go" disabled={busy || !name.trim()} onClick={create}>
            {busy ? "Creating…" : "Create and switch"}
          </button>
          <button className="linkbtn pw-cancel" onClick={() => { setAdding(false); setError(null); }}>Cancel</button>
        </div>
      ) : (
        <button className="addbtn ghost signin-go" onClick={() => setAdding(true)}>Add company</button>
      )}
    </div>
  );
}

export function Account({ doc, onSwitched, onClose }) {
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

      <CompaniesSection
        account={account} companies={companies} activeId={activeId}
        onReload={reload} onSwitched={doSwitch} doc={doc}
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
      </div>
    </div>
  );
}
