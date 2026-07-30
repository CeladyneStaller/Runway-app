// Every company you advise, ordered by who runs out of money first.
//
// THE ONE QUESTION A FRACTIONAL CFO WAKES UP WITH. Not a dashboard of everything — a sorted list
// answering "who do I call today", which is the whole reason the advisor tier is worth paying for.
//
// RUNWAY IS COMPUTED HERE, IN THE BROWSER, from each document. There is no server-side projection and
// there must not be: a second implementation is a second answer to the number this product exists to
// state. `runwayMonths` is the same function the dashboard headline uses.
//
// THAT MEANS N DOCUMENT LOADS, at 40–300KB each, which is fine to roughly twenty companies and is why
// rows appear AS THEY ARRIVE rather than after the slowest one. Past that it needs a cached summary,
// which would mean storing a derived number that can disagree with the document — worth hitting the
// limit first and knowing it is real.
import React, { useCallback, useEffect, useState } from "react";
import { runwayMonths } from "./docsummary";
import { money } from "../../engine/money";
import { HORIZON } from "../../engine/time";

const label = (m) => (m == null ? `${HORIZON}+ mo` : `${m.toFixed(1)} mo`);
const tone = (m) => (m == null ? "" : m < 6 ? "down" : m < 12 ? "warn" : "");

export function Portfolio({ account, onOpen }) {
  const [rows, setRows] = useState(null);
  const [advisor, setAdvisor] = useState(null);

  const load = useCallback(async () => {
    if (!account?.listAdvisedCompanies) { setRows([]); return; }
    const [companies, usage] = await Promise.all([
      account.listAdvisedCompanies().catch(() => []),
      account.advisorUsage?.().catch(() => null) ?? null,
    ]);
    setAdvisor(usage);
    setRows(companies.map(c => ({ ...c, state: "loading" })));

    // Sequential rather than parallel: twenty documents at once is twenty large bodies competing for
    // the same connection, and the first row arriving quickly matters more than the last row arriving
    // slightly sooner.
    for (const c of companies) {
      let patch;
      try {
        const doc = c.has_document ? await account.readCompanyDocument(c.id) : null;
        patch = doc
          ? { state: "ok", months: runwayMonths(doc), cash: doc.cash || 0,
              people: (doc.employees || []).length }
          : { state: "empty" };
      } catch { patch = { state: "failed" }; }
      setRows(rs => (rs || []).map(r => (r.id === c.id ? { ...r, ...patch } : r)));
    }
  }, [account]);

  useEffect(() => { void load(); }, [load]);

  if (rows === null) return null;
  // Somebody in one company is not running a portfolio. Showing them a list of one would be a screen
  // that exists to justify a price.
  if (rows.length < 2) return null;

  const done = rows.filter(r => r.state === "ok");
  const urgent = done.filter(r => r.months != null && r.months < 6).length;
  const sorted = [...rows].sort((a, b) => {
    if (a.state !== "ok" || b.state !== "ok") return a.state === "ok" ? -1 : 1;
    // Unknown runway means the model never reaches zero inside the horizon — the opposite of urgent,
    // so it sorts last rather than being treated as a missing value.
    const av = a.months ?? Infinity, bv = b.months ?? Infinity;
    return av - bv;
  });

  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h3>Your clients</h3>
          <p>
            Sorted by who runs out first.
            {advisor?.allowed ? ` ${advisor.companies} of ${advisor.allowed} companies on your plan.` : ""}
          </p>
        </div>
      </div>

      <div className="pf-stats">
        <div><span>Clients</span><b>{rows.length}</b></div>
        <div><span>Under 6 months</span><b className={urgent ? "down" : ""}>{urgent}</b></div>
        <div><span>Still loading</span><b>{rows.filter(r => r.state === "loading").length}</b></div>
      </div>

      {sorted.map(c => (
        <div className="acct-row" key={c.id}>
          <div>
            <button className="linkbtn pf-name" onClick={() => onOpen?.(c.id)}>{c.name}</button>
            <div className="acct-row-s">
              {c.state === "ok" && <>{money(c.cash)} · {c.people} {c.people === 1 ? "person" : "people"}</>}
              {c.state === "loading" && "Loading…"}
              {c.state === "empty" && "No model yet"}
              {/* A company that failed to load is NOT reported as healthy. Silence here would be a row
                  that looks fine and is unknown, which is the failure this whole panel guards against. */}
              {c.state === "failed" && <span className="acct-warn">Could not read this model</span>}
            </div>
          </div>
          <div className="acct-row-a">
            <span className={"pf-runway " + tone(c.months)}>
              {c.state === "ok" ? label(c.months) : "—"}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
