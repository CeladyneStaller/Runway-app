// Where an advisor lands.
//
// AN ADVISOR'S HOME IS THE PORTFOLIO, NOT A COMPANY. Everybody else signs in to one model; an advisor
// signs in to a list of them, and the question they open the app with is "who do I call today" — which
// is why the rail is their client list and the landing is sorted by who runs out first.
//
// EVERY CLIENT'S MODEL IS LOADED IN FULL. That is not laziness avoided, it is required: the runway is
// computed from the document by the same function the dashboard uses, so no client can show one number
// here and another there. The tiles are then free.
//
// Loading is PROGRESSIVE and per-company. Twenty models is twenty round trips, and a screen that waits
// for the slowest one is a screen that looks broken for the nineteen that already arrived.
import React, { useEffect, useMemo, useState } from "react";
import mark from "../../assets/waterline-mark.svg";
import { money } from "../../engine/money";
import { runwayMonths } from "./docsummary";
import { buildModelParts, buildModelFromDoc } from "../../engine/buildmodel";
import { buildProjection } from "../../engine/projection";
import { alertsFor } from "../../engine/alerts";
import { AdvisorCompany } from "./AdvisorCompany";
import { ProfileMenu } from "./ProfileMenu";

/** Above this many clients the rail stops listing them all and shows only what needs attention.
 *  A rail with twenty entries is a scrollbar, which is not navigation. */
const RAIL_MAX = 8;

const clean = (n) => (Number.isFinite(n) ? n : null);

function useClients(account) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let list = [];
      try { list = (await account?.listAdvisedCompanies?.()) || []; }
      catch (e) { if (alive) { setErr(e?.message || "Could not list your clients."); setLoading(false); } return; }

      if (!alive) return;
      setRows(list.map(c => ({ ...c, state: "loading" })));
      setLoading(false);

      // One at a time, updating as each arrives. A client whose model fails is marked, NOT dropped —
      // silently omitting it would tell an advisor they have fewer clients than they do.
      for (const c of list) {
        // ON THE ACCOUNT API, not a module export — `Portfolio` already reads it this way, and it goes
        // through `load_document` plus `assembleFromStorage` because the blob no longer carries
        // projects. Reading the table directly was a silent wrong-runway bug once already.
        let doc = null, failed = null;
        if (c.has_document === false) {
          failed = null;                       // an empty company is not a broken one
        } else {
          try { doc = await account.readCompanyDocument(c.id); }
          catch (e) { failed = e?.message || "Could not read this model."; }
        }
        if (!alive) return;

        let parts = null, months = null, cash = null, attention = 0;
        if (doc) {
          try {
            parts = buildModelParts(doc);
            const rows2 = buildProjection(buildModelFromDoc(doc), doc.settings?.toggles || {});
            parts = { ...parts, rows: rows2 };
            months = clean(runwayMonths(doc));
            cash = clean(doc.cash);
            attention = (alertsFor("dash", doc, parts) || []).length;
          } catch (e) { failed = e?.message || "This model could not be read."; doc = null; }
        }
        setRows(prev => prev.map(r => (r.id === c.id
          ? { ...r, doc, parts, months, cash, attention, failed,
              state: failed ? "failed" : "ready" }
          : r)));
      }
    })();
    return () => { alive = false; };
  }, [account]);

  return { rows, loading, err };
}

const toneOf = (m) => (m == null ? "" : m < 6 ? "bad" : m < 12 ? "warn" : "");

function Portfolio({ rows, onOpen }) {
  const ready = rows.filter(r => r.state === "ready");
  const pending = rows.filter(r => r.state === "loading").length;
  const short = ready.filter(r => r.months != null && r.months < 6);
  const shortest = ready.reduce((a, r) => (r.months != null && (a == null || r.months < a) ? r.months : a), null);
  const attention = ready.reduce((a, r) => a + (r.attention || 0), 0);

  // WHO RUNS OUT FIRST, which is the order that answers the question an advisor opened the app with.
  // A client still loading sorts last rather than to the top: an unknown runway is not an urgent one.
  const sorted = [...rows].sort((a, b) => {
    if (a.months == null && b.months == null) return 0;
    if (a.months == null) return 1;
    if (b.months == null) return -1;
    return a.months - b.months;
  });

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="lab">Clients</div><div className="big">{rows.length}</div>
          <div className="meta">{pending ? `${pending} still loading` : "all loaded"}</div>
        </div>
        <div className="stat">
          <div className="lab">Under 6 months</div>
          <div className="big" style={short.length ? { color: "var(--danger)" } : null}>{short.length}</div>
          <div className="meta">{short.length ? short.map(r => r.name).slice(0, 2).join(", ") : "none"}</div>
        </div>
        <div className="stat">
          <div className="lab">Need attention</div><div className="big">{attention}</div>
          <div className="meta">across your clients</div>
        </div>
        <div className="stat hero">
          <div className="lab">Shortest runway</div>
          <div className="big">{shortest == null ? "—" : `${shortest.toFixed(1)} mo`}</div>
          <div className="meta">of those loaded</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-h">
          <div>
            <h3>Your clients</h3>
            <p>Sorted by who runs out first. Every figure is computed from that client's own model.</p>
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr><th>Company</th><th style={{ textAlign: "right" }}>Runway</th>
              <th style={{ textAlign: "right" }}>Cash</th><th>Attention</th><th></th></tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id}>
                <td><b>{r.name}</b></td>
                <td style={{ textAlign: "right", fontFamily: "var(--fm)",
                             color: r.months != null && r.months < 6 ? "var(--danger)" : undefined }}>
                  {r.state === "loading" ? "…"
                    : r.state === "failed" ? "—"
                    : r.months == null ? "positive" : `${r.months.toFixed(1)} mo`}
                </td>
                <td style={{ textAlign: "right", fontFamily: "var(--fm)" }}>
                  {r.cash == null ? "" : money(r.cash)}
                </td>
                <td>
                  {/* A MODEL THAT WOULD NOT LOAD SAYS SO IN THE ROW. Leaving it blank would read as a
                      client with nothing wrong, which is the one thing it definitely is not. */}
                  {r.state === "failed"
                    ? <span className="chip bad">could not read</span>
                    : r.attention ? <span className="chip warn">{r.attention}</span>
                    : r.state === "ready" ? <span className="chip">—</span> : null}
                </td>
                <td><button className="linkbtn" onClick={() => onOpen(r.id)}>Open →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function AdvisorHome({ account, onEnterCompany, onOpenSettings }) {
  const { rows, loading, err } = useClients(account);
  const [at, setAt] = useState("portfolio");        // "portfolio" | a company id

  const here = rows.find(r => r.id === at) || null;

  // Only what needs attention, once the list is long enough that a rail cannot hold it.
  const railRows = useMemo(() => {
    if (rows.length <= RAIL_MAX) return rows;
    return [...rows]
      .filter(r => r.months != null && r.months < 12)
      .sort((a, b) => a.months - b.months)
      .slice(0, RAIL_MAX);
  }, [rows]);

  const trimmed = rows.length > RAIL_MAX;

  return (
    // `.rw` SCOPES THE ENTIRE STYLESHEET. Every other screen wraps in it — `RunwayApp`, `Account`, the
    // sign-in — and without it this rendered as unstyled HTML: correct structure, no character at all.
    // Nothing failed, which is why it looked like a broken page rather than a missing class.
    <div className="rw">
    <div className="shell">
      <aside className="rail">
        {/* THE MARK, which I dropped when fixing the invented `brandmark` class — I replaced the
            element with text and left the image out, so the rail kept its words and lost its logo. */}
        <div className="brand">
          <img src={mark} alt="Waterline" width={100} />
          <div><b>Waterline</b><span>runway control</span></div>
        </div>

        <div className="railmeta railgrp">Advising{rows.length ? ` · ${rows.length}` : ""}</div>
        {/* NO WRAPPER. `.nav` is the BUTTON class here — App puts them straight in the rail — and a
            container sharing the class matched every selector first, including the tests' clicks. */}
        <button className={"nav" + (at === "portfolio" ? " on" : "")}
                  onClick={() => setAt("portfolio")}>
          Portfolio<span className="navr">{rows.length || ""}</span>
        </button>

        {railRows.length > 0 && (
          <>
            <div className="railmeta railgrp">{trimmed ? "Needs attention" : "Clients"}</div>
            {railRows.map(r => (
                <button key={r.id} className={"nav" + (at === r.id ? " on" : "")}
                        onClick={() => setAt(r.id)}>
                  <span className="navname">{r.name}</span>
                  <span className={"navr " + toneOf(r.months)}>
                    {r.state === "loading" ? "…" : r.months == null ? "" : r.months.toFixed(1)}
                  </span>
                </button>
            ))}
          </>
        )}

        <div className="railfoot">
          <div className="railmeta">
            {trimmed
              ? `${rows.length - railRows.length} more in your portfolio`
              : "Your clients, by runway"}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <span className="eyebrow">{here ? "Advising · read only" : "Advisor"}</span>
            <h1 className="h1">{here ? here.name : "Your portfolio"}</h1>
          </div>
          {/* THE AVATAR IS ON EVERY SCREEN OR IT IS ON NONE. It was in the company app's header and
              missing here — so an advisor, whose home this is, had no route to their own settings
              without first opening a client. The one thing that follows a person across companies was
              reachable only from inside one. */}
          <div className="topright">
            {here && (
              // A BUTTON NAMING THE COMPANY, not a switcher. Switching is what you do to change
              // context; this is what you do to one company you are already looking at.
              <button className="addbtn" onClick={() => onEnterCompany(here.id, "dash")}>
                Open {here.name} →
              </button>
            )}
            <ProfileMenu onGo={(page) => onOpenSettings?.("profile", page)} />
          </div>
        </div>

        {err && <div className="signin-error" role="alert">{err}</div>}
        {loading && <p className="acct-row-s">Loading your clients…</p>}

        {!loading && rows.length === 0 && !err && (
          <section className="panel">
            <div className="panel-h">
              <div>
                <h3>No clients yet</h3>
                <p>
                  A company owner invites you, and it appears here. You hold no seat in their
                  subscription and cannot change their model.
                </p>
              </div>
            </div>
          </section>
        )}

        {at === "portfolio" && rows.length > 0 && (
          <Portfolio rows={rows} onOpen={(id) => setAt(id)} />
        )}

        {here && (
          here.state === "loading"
            ? <p className="acct-row-s">Loading {here.name}…</p>
            : <AdvisorCompany
                account={account}
                company={here} doc={here.doc} parts={here.parts}
                hiddenTabs={here.hiddenTabs || []}
                onOpen={(view) => onEnterCompany(here.id, view)} />
        )}
      </main>
    </div>
    </div>
  );
}
