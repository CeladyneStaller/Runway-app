// The chart at the top of a tab's overview, and the choice of which one.
//
// PER DEVICE, LIKE HIDDEN TABS, and stored beside them for the same reason: it is a preference about
// what you want to look at, not a fact about the company. `tabprefs.js` already says why one person
// tidying their own screen must not rearrange somebody else's.
//
// THE DEFAULT MATTERS MORE THAN THE PICKER. Most people never open a picker, so most people get the
// first chart in the registry — which is why the registry is ordered and why the picker is a small
// disclosure rather than a panel.
import React, { useMemo, useState } from "react";
import { buildChart, chartsForTab, defaultChartFor } from "../../engine/charts";
import { Chart } from "./Chart";

const KEY = "runway:chart";

const read = (tab) => {
  try { return globalThis.localStorage?.getItem(`${KEY}:${tab}`) || null; } catch { return null; }
};
const write = (tab, id) => {
  try { globalThis.localStorage?.setItem(`${KEY}:${tab}`, id); } catch { /* nothing to remember with */ }
};

export function TabChart({ tab, doc, parts }) {
  const options = useMemo(() => chartsForTab(tab), [tab]);
  const [chosen, setChosen] = useState(() => read(tab) || defaultChartFor(tab));
  const [picking, setPicking] = useState(false);

  // A chart id saved before an option was renamed or removed must not leave a blank space.
  const id = options.some(o => o.id === chosen) ? chosen : defaultChartFor(tab);
  const spec = useMemo(() => (id ? buildChart(id, doc, parts) : null), [id, doc, parts]);
  if (!id) return null;

  const pick = (next) => { setChosen(next); write(tab, next); setPicking(false); };
  const current = options.find(o => o.id === id);

  return (
    <section className="panel ch-panel">
      <div className="panel-h">
        <div>
          <h3>{current?.name}</h3>
          <p>{current?.why}</p>
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
          <p className="ch-note">Kept on this device, like hidden tabs.</p>
        </div>
      ) : <Chart spec={spec} />}
    </section>
  );
}
