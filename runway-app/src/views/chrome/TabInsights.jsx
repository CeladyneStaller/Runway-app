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
import { savedFor, saveChart, updateChart, setDefaultChart, defaultChartId, resolveSaved } from "../../engine/savedcharts";
import { ChartBuilder, SaveChartBar } from "./ChartBuilder";
import { buildChart, chartsForTab, defaultChartFor, chartById } from "../../engine/charts";
import { alertsFor } from "../../engine/alerts";
import { lensFor, chartIdFor, applyLens } from "../../engine/lenses";
import { Chart } from "./Chart";

const InsightCtx = createContext(null);

/** Provided once, by the app shell. */
export function InsightProvider({ doc, parts, onGo, setDoc, isOwner = true, userName = null, children }) {
  // ⚠️ `isOwner` DEFAULTS TO TRUE, AND THAT IS THE CORRECT DEFAULT HERE. It defaulted to false, so
  // **a solo local document — which has no membership at all — hid "Set as default" from the only
  // person who could ever press it.** The rest of the app already reads it this way: views default
  // `canWrite = true` when no membership prop arrives, because no membership means no sharing, which
  // means the person holding the document owns it.
  //
  // `setDoc` and `userName` stay optional: without `setDoc` the builder works and cannot save.
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
  // ⚠️ THE COMPANY DEFAULT WAS SETTABLE AND NEVER READ. `setDefaultChart` wrote it, the badge showed
  // it, the owner-only button hid itself for it — and nothing consulted it when deciding what to draw.
  // **A preference that is stored, displayed, and ignored is the most convincing kind of broken**,
  // because every visible signal says it worked.
  //
  // ORDER: this device's own choice, then the company default, then the curated one. A person who has
  // picked a chart on this tab keeps their pick — the company default is where you LAND, not a
  // instruction that overrides a decision you already made.
  const [chosen, setChosen] = useState(() => read(tab));

  // ⚠️ A useState INITIALISER RUNS ONCE, AND THE DOCUMENT MAY ARRIVE AFTER MOUNT. Reading the company
  // default there would have worked on a warm reload and silently missed it on a cold one — an
  // intermittent failure, which is worse than a consistent one because it looks like the person
  // misremembered.
  //
  // Derived at render instead: no state to fall out of step, and it recomputes if an owner changes the
  // default while somebody is looking at the tab. **It applies on their next tab load, not mid-read**,
  // because `chosen` wins once they have picked anything themselves.
  // ⚠️ ONE BINDING FOR THE COMPANY DEFAULT. It was read in three places by two different expressions,
  // and every bug in this area today has been one consumer disagreeing with another about the same
  // fact. Declared once, above everything that needs it.
  const companyDefault = ctx ? defaultChartId(ctx.doc, tab) : null;
  const effective = chosen ?? companyDefault;
  const [picking, setPicking] = useState(false);
  const [building, setBuilding] = useState(false);
  const [naming, setNaming] = useState(false);
  const [editing, setEditing] = useState(null);   // the saved chart a draft came from, if any
  // ⚠️ THE UNSAVED CONFIG IS COMPONENT STATE AND IS NEVER WRITTEN. Changing the chart replaces the
  // default in THIS view and nowhere else — experimenting has to be free or nobody experiments.
  const [cfg, setCfg] = useState({ measures: [], by: null, across: "month" });

  const options = useMemo(() => chartsForTab(tab), [tab]);
  const alerts = useMemo(
    () => (ctx ? alertsFor(tab, ctx.doc, ctx.parts) : []), [ctx, tab]);

  const lens = lensFor(tab, subtab);
  // The curated fallback also honours a company default that names a CURATED chart — one field holding
  // either kind of id, so this asks once rather than branching on which kind it turned out to be.
  const id = chartIdFor(tab, subtab, options.some(o => o.id === effective) ? effective : null,
                        options.some(o => o.id === companyDefault) ? companyDefault
                                                                   : defaultChartFor(tab));

  // A SAVED CHART IS SELECTED BY THE SAME `chosen` FIELD as a curated one — one field holding either
  // kind of id, so the two cannot disagree the first time somebody deletes a saved chart.
  const saved = ctx ? savedFor(ctx.doc, tab) : [];
  const pickedSaved = saved.find(c => c.id === effective) || null;

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

  // ⚠️ THE HEADER ONLY EVER NAMED A CURATED CHART. A saved chart is selected by the same `chosen`
  // field, so the panel kept the previous chart's title and `why` while drawing something else
  // entirely — the header describing one chart and the canvas showing another.
  const curated = chartById(id);
  const current = cfg.measures.length
    ? { name: "Unsaved chart", why: "Yours until you save it. Nobody else sees this." }
    : pickedSaved
    ? { name: pickedSaved.name,
        // A SAVED CHART HAS NO `why` — a builder cannot write one — so it says what it plots and who
        // saved it, which is the honest substitute.
        why: `${pickedSaved.measures.map(m => m.id).join(", ")}`
             + (pickedSaved.by ? ` by ${pickedSaved.by}` : "")
             + (pickedSaved.savedBy ? ` · saved by ${pickedSaved.savedBy}` : "") }
    : curated;
  /** ⚠️ PICKING A CHART MUST CLEAR THE UNSAVED DRAFT.
   *
   *  The spec path tries `cfg.measures.length` FIRST, so a draft outranked every selection — choosing
   *  another chart changed `chosen` and nothing on screen, and only a refresh cleared it. **A control
   *  that appears to do nothing is worse than one that is absent**, because the person tries it twice
   *  and then distrusts the menu.
   *
   *  It ASKS FIRST when there is work to lose, and only then — the same rule as deleting a thrust: a
   *  confirmation on every switch is friction, a confirmation on the one that discards something is
   *  the question being answered rather than discovered.
   */
  const pick = (next) => {
    if (cfg.measures.length &&
        !confirm("Discard your unsaved chart and switch? It has not been saved for the company.")) return;
    setCfg({ measures: [], across: "month", orient: "x" });
    setBuilding(false); setEditing(null);
    setChosen(next); write(tab, next); setPicking(false);
  };

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
              {cfg.measures.length > 0 && (
                <p className="ch-note">
                  {/* SAYS WHY NOTHING IS TICKED, rather than leaving an empty radio group to look
                      broken. Choosing any chart below discards the draft, and will ask first. */}
                  You are looking at an unsaved chart. Picking one below will discard it.
                </p>
              )}
              {saved.length > 0 && <div className="ch-grp">Saved by your company</div>}
              {saved.map(c => (
                <label key={c.id} className={"ch-opt" + (c.id === chosen ? " on" : "")}>
                  <input type="radio" name={`chart-${tab}`} checked={!cfg.measures.length && c.id === effective}
                         onChange={() => pick(c.id)} aria-label={c.name} />
                  <span>
                    <span className="ch-opt-n">
                      {c.name}
                      {companyDefault === c.id && <span className="chip on">default</span>}
                    </span>
                    {/* A SAVED CHART CANNOT HAVE A `why` — a builder cannot write one. So it shows what
                        it plots and who saved it, which is the honest substitute. */}
                    <span className="ch-opt-w">
                      {c.measures.map(m => m.id).join(", ")}
                      {/* `by` MOVED ONTO EACH DATASET, so the summary reads them rather than a
                          chart-level field that no longer exists. */}
                      {c.measures?.some(m => m.by) ? ` by ${[...new Set(c.measures.filter(m => m.by).map(m => m.by))].join(", ")}` : ""}
                      {c.savedBy ? ` · saved by ${c.savedBy}` : ""}
                    </span>
                  </span>
                  {/* ⚠️ OWNER ONLY. It is the one control here that changes what another person sees —
                      and it applies on THEIR next tab load, never mid-read. */}
                  {/* ⚠️ EDIT LOADS IT INTO THE BUILDER AS AN UNSAVED DRAFT. It does not modify the
                      saved chart in place — the person may be exploring, and a saved chart everybody
                      else is looking at should not change under them mid-edit. Saving again writes a
                      new one; that is deliberate and the save bar says so. */}
                  <button className="linkbtn" onClick={(e) => {
                    e.preventDefault();
                    // THE WHOLE DATASET SURVIVES INTO THE DRAFT — shape, stacking, axis, negation and
                    // sign colouring, all of which live on the measure now rather than on the chart.
                    setCfg({ measures: c.measures.map(m => ({ ...m })),
                             across: c.across, orient: c.orient || "x" });
                    setEditing(c.id); setBuilding(true);
                  }}>Edit</button>
                  {ctx.isOwner && companyDefault !== c.id && (
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
                  {/* ⚠️ `id` FALLS BACK TO THE CURATED DEFAULT WHENEVER A SAVED CHART IS CHOSEN, because
                      a saved id is not in `options` — so `chartIdFor` discards it. Checking `o.id === id`
                      alone therefore ticked a standard chart WHILE a saved one was drawn, and both radios
                      read as selected. The picker has to answer "what is on screen", and `pickedSaved` is
                      the only thing that knows. */}
                  <input type="radio" name={`chart-${tab}`}
                         checked={!cfg.measures.length && !pickedSaved && o.id === id}
                         onChange={() => pick(o.id)} aria-label={o.name} />
                  <span>
                    <span className="ch-opt-n">
                      {o.name}
                      {companyDefault === o.id && <span className="chip on">default</span>}
                    </span>
                    <span className="ch-opt-w">{o.why}</span>
                  </span>
                  {/* ⚠️ THE STANDARD CHARTS HAD NO "SET AS DEFAULT", AND THERE WAS NO REASON FOR IT.
                      `chartDefault[tab]` holds EITHER kind of id — that was the point of one field —
                      and `setDefaultChart` never cared which. The control simply was not offered here,
                      so a company could land on a chart it built but not on one it was given. */}
                  {ctx.isOwner && companyDefault !== o.id && (
                    <button className="linkbtn" onClick={(e) => {
                      e.preventDefault();
                      const r = setDefaultChart(ctx.doc, tab, o.id, { isOwner: true });
                      if (!r.error) ctx.setDoc?.(r.doc);
                    }}>Set as default</button>
                  )}
                </label>
              ))}
              {chosen && (
                <button className="linkbtn" onClick={() => { setChosen(null); write(tab, ""); setPicking(false); }}>
                  Follow the sub-tab instead
                </button>
              )}
              <p className="ch-note">Kept on this device, like hidden tabs.</p>

              {/* ⚠️ THE WAY INTO THE BUILDER, at the foot of the menu. My first attempt at this edit
                  targeted `) : null}` — a closing this block does not have — so it matched nothing and
                  the whole builder was unreachable while lint stayed clean. A replacement that matches
                  nothing is the quietest failure in this codebase and it has now happened four times. */}
              <div className="ch-build">
                <span className="meta">Or plot something else</span>
                <button className="addbtn" onClick={() => setBuilding(true)}>Build a chart</button>
              </div>
            </div>
          ) : picking && building ? (
            <>
              <ChartBuilder tab={tab} cfg={cfg} setCfg={setCfg} canSave={!!ctx.setDoc}
                            onClose={() => { setBuilding(false); setPicking(false); setEditing(null); }}
                            onSave={() => setNaming(true)} />
              {naming && (
                <SaveChartBar onCancel={() => setNaming(false)}
                              editingName={editing ? savedFor(ctx.doc, tab).find(c => c.id === editing)?.name : null}
                              onSave={(name) => {
                                // AN EDIT UPDATES IN PLACE; ANYTHING ELSE ADDS. A chart that is the
                                // company default stays the default through an edit, which is what
                                // somebody correcting a mistake in it expects.
                                const r = editing
                                  ? updateChart(ctx.doc, editing, cfg, { name })
                                  : saveChart(ctx.doc, tab, cfg, { name, savedBy: ctx.userName });
                                if (r.error) return;
                                ctx.setDoc?.(r.doc);
                                // SAVING ADDS IT TO THE MENU; IT DOES NOT SET THE DEFAULT. Two acts,
                                // because they are two decisions.
                                setNaming(false); setBuilding(false); setPicking(false); setEditing(null);
                                setCfg({ measures: [], by: null, across: "month" });
                                pick(r.chart.id);
                              }} />
              )}
              {/* THE CHART STAYS VISIBLE WHILE YOU BUILD IT. A builder that hides its own output makes
                  you close it to see whether the last change helped. */}
              <Chart spec={spec} />
            </>
          ) : <Chart spec={spec} />}
        </section>
      )}
    </>
  );
}
