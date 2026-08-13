// The alerts and the chart, in the order the layout settled on.
//
// ALERTS SIT ABOVE THE CHART, and that is the whole reason this component exists rather than the two
// being placed separately. A picture is easier to look at than a sentence, so a chart placed first gets
// read first and the sentence underneath gets skipped — which for "one order is awaiting a target
// review" means the review does not happen.
//
// TILES STAY ABOVE BOTH, in each view's own markup. A tile is the state; an alert is an exception to
// it. "Runway 5.6 months" then "spend has been over plan for six months" is a story; the reverse is a
// warning about a figure nobody has seen yet.
//
// IT READS THE DOCUMENT FROM CONTEXT. Threading `doc` and `parts` through six view signatures to reach
// one component would be six prop chains maintained forever, and `tabprefs.js` already established the
// pattern for exactly this.
import React, { createContext, useContext, useMemo, useState } from "react";
import { buildCustom } from "../../engine/buildcustom";
import { MEASURES } from "../../engine/measures";
import { savedFor, saveChart, setDefaultChart, defaultChartId, resolveSaved } from "../../engine/savedcharts";
import { ChartBuilder, SaveChartBar } from "./ChartBuilder";
import { buildChart, chartsForTab, defaultChartFor, chartById } from "../../engine/charts";
import { alertsFor } from "../../engine/alerts";
import { lensFor, chartIdFor, applyLens } from "../../engine/lenses";
import { Chart } from "./Chart";

const InsightCtx = createContext(null);

/** Provided once, by the app shell. */
export function InsightProvider({ doc, parts, onGo, setDoc, isOwner = false, userName = null, children }) {
  // ⚠️ `setDoc`, `isOwner` AND `userName` ARE NEW, and all three are optional. Without `setDoc` the
  // builder still works and simply cannot save; without `isOwner` nobody sees "Set as default". A
  // missing prop degrades to a narrower feature rather than a crash — which is what the four `ctx.x`
  // reads in the menu below depend on.
  const value = useMemo(() => ({ doc, parts, onGo, setDoc, isOwner, userName }),
                        [doc, parts, onGo, setDoc, isOwner, userName]);
  return <InsightCtx.Provider value={value}>{children}</InsightCtx.Provider>;
}

const KEY = "runway:chart";
const read = (tab) => {
  try { return globalThis.localStorage?.getItem(`${KEY}:${tab}`) || null; } catch { return null; }
};
const write = (tab, id) => {
  try { globalThis.localStorage?.setItem(`${KEY}:${tab}`, id); } catch { /* nothing to remember with */ }
};

export function TabInsights({ tab, subtab }) {
  const ctx = useContext(InsightCtx);
  const [chosen, setChosen] = useState(() => read(tab));
  const [picking, setPicking] = useState(false);
  const [building, setBuilding] = useState(false);
  const [naming, setNaming] = useState(false);
  // ⚠️ THE UNSAVED CONFIG IS COMPONENT STATE AND IS NEVER WRITTEN. Changing the chart replaces the
  // default in THIS view and nowhere else — experimenting has to be free or nobody experiments.
  const [cfg, setCfg] = useState({ measures: [], by: null, across: "month" });

  const options = useMemo(() => chartsForTab(tab), [tab]);
  const alerts = useMemo(
    () => (ctx ? alertsFor(tab, ctx.doc, ctx.parts) : []), [ctx, tab]);

  const lens = lensFor(tab, subtab);
  const id = chartIdFor(tab, subtab, options.some(o => o.id === chosen) ? chosen : null,
                        defaultChartFor(tab));

  // A SAVED CHART IS SELECTED BY THE SAME `chosen` FIELD as a curated one — one field holding either
  // kind of id, so the two cannot disagree the first time somebody deletes a saved chart.
  const saved = ctx ? savedFor(ctx.doc, tab) : [];
  const pickedSaved = saved.find(c => c.id === chosen) || null;

  const spec = useMemo(() => {
    if (!ctx) return null;
    // ⚠️ THREE SOURCES, ONE SPEC SHAPE. An unsaved build, a saved chart, or a curated one — all three
    // produce `{ kind, x, ticks, series, format }`, which is why the lens and renderer below need to
    // know nothing about which it is.
    const live = cfg.measures.length
      ? buildCustom(cfg, ctx.doc, ctx.parts, ctx.parts?.rows || [])
      : pickedSaved
      ? buildCustom(resolveSaved(pickedSaved, MEASURES.map(m => m.id)), ctx.doc, ctx.parts, ctx.parts?.rows || [])
      : id ? buildChart(id, ctx.doc, ctx.parts) : null;
    return live ? applyLens(live, lens, ctx.doc) : null;
  }, [ctx, id, lens, cfg, pickedSaved]);

  if (!ctx) return null;

  const current = chartById(id);
  const pick = (next) => { setChosen(next); write(tab, next); setPicking(false); };

  return (
    <>
      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map(a => (
            <div className={"alert " + a.tone} key={a.id}>
              <span>{a.text}</span>
              {a.action && (
                <button className="linkbtn" onClick={() => ctx.onGo?.(a.to)}>{a.action}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {current && (
        <section className="panel ch-panel">
          <div className="panel-h">
            <div>
              <h3>{current.name}{lens?.label ? ` · ${lens.label}` : ""}</h3>
              <p>{current.why}</p>
            </div>
            {/* ALWAYS OFFERED NOW — even with one curated chart, there is a builder behind it. */}
            <button className="linkbtn" onClick={() => { setPicking(p => !p); setBuilding(false); }}>
              {picking ? "Close" : "Change chart"}
            </button>
          </div>

          {picking && !building ? (
            <div className="ch-pick">
              {/* ⚠️ SAVED CHARTS SIT ABOVE THE STANDARD ONES. They are the company's own and were made
                  deliberately; a list that buries them under the built-ins teaches everybody to scroll
                  past their own work. */}
              {saved.length > 0 && <div className="ch-grp">Saved by your company</div>}
              {saved.map(c => (
                <label key={c.id} className={"ch-opt" + (c.id === chosen ? " on" : "")}>
                  <input type="radio" name={`chart-${tab}`} checked={c.id === chosen}
                         onChange={() => pick(c.id)} aria-label={c.name} />
                  <span>
                    <span className="ch-opt-n">
                      {c.name}
                      {defaultChartId(ctx.doc, tab) === c.id && <span className="chip on">default</span>}
                    </span>
                    {/* A SAVED CHART CANNOT HAVE A `why` — a builder cannot write one. So it shows what
                        it plots and who saved it, which is the honest substitute. */}
                    <span className="ch-opt-w">
                      {c.measures.map(m => m.id).join(", ")}
                      {c.by ? ` by ${c.by}` : ""}{c.savedBy ? ` · saved by ${c.savedBy}` : ""}
                    </span>
                  </span>
                  {/* ⚠️ OWNER ONLY. It is the one control here that changes what another person sees —
                      and it applies on THEIR next tab load, never mid-read. */}
                  {ctx.isOwner && defaultChartId(ctx.doc, tab) !== c.id && (
                    <button className="linkbtn" onClick={(e) => {
                      e.preventDefault();
                      const r = setDefaultChart(ctx.doc, tab, c.id, { isOwner: true });
                      if (!r.error) ctx.setDoc?.(r.doc);
                    }}>Set as default</button>
                  )}
                </label>
              ))}

              {saved.length > 0 && <div className="ch-grp">Standard charts</div>}
              {options.map(o => (
                <label key={o.id} className={"ch-opt" + (o.id === id ? " on" : "")}>
                  <input type="radio" name={`chart-${tab}`} checked={o.id === id}
                         onChange={() => pick(o.id)} aria-label={o.name} />
                  <span>
                    <span className="ch-opt-n">{o.name}</span>
                    <span className="ch-opt-w">{o.why}</span>
                  </span>
                </label>
              ))}
              {chosen && (
                <button className="linkbtn" onClick={() => { setChosen(null); write(tab, ""); setPicking(false); }}>
                  Follow the sub-tab instead
                </button>
              )}
              <p className="ch-note">Kept on this device, like hidden tabs.</p>
            </div>
          ) : <Chart spec={spec} />}
        </section>
      )}
    </>
  );
}
