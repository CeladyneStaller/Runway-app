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
import { buildChart, chartsForTab, defaultChartFor, chartById } from "../../engine/charts";
import { alertsFor } from "../../engine/alerts";
import { lensFor, chartIdFor, applyLens } from "../../engine/lenses";
import { Chart } from "./Chart";

const InsightCtx = createContext(null);

/** Provided once, by the app shell. */
export function InsightProvider({ doc, parts, onGo, children }) {
  const value = useMemo(() => ({ doc, parts, onGo }), [doc, parts, onGo]);
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

  const options = useMemo(() => chartsForTab(tab), [tab]);
  const alerts = useMemo(
    () => (ctx ? alertsFor(tab, ctx.doc, ctx.parts) : []), [ctx, tab]);

  const lens = lensFor(tab, subtab);
  const id = chartIdFor(tab, subtab, options.some(o => o.id === chosen) ? chosen : null,
                        defaultChartFor(tab));

  const spec = useMemo(() => {
    if (!ctx || !id) return null;
    return applyLens(buildChart(id, ctx.doc, ctx.parts), lens, ctx.doc);
  }, [ctx, id, lens]);

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
            {options.length > 1 && (
              <button className="linkbtn" onClick={() => setPicking(p => !p)}>
                {picking ? "Close" : "Change chart"}
              </button>
            )}
          </div>

          {picking ? (
            <div className="ch-pick">
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
