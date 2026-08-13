import React, { useMemo, useState } from "react";
import { staleness, stalenessText, withFingerprints } from "../engine/scenario";
import { FACTORS, itemsOf, dateRemovable, buildPatches, overheadAdjustment } from "../engine/factors";
import { applyScenario, explainPatch, emptyScenario, duplicateScenario, scenarioImpact,
         PATCH_SCHEMA } from "../engine/scenario";
import { buildProjection, zeroInfo } from "../engine/projection";
import { money, moneyFull } from "../engine/money";
import { HORIZON, monthLabel } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { I } from "./chrome/icons";

// Scenarios, built around the DECISION rather than the curve.
//
// The old tab answered "what would this look like": two runway numbers side by side, the subtraction
// left to the reader, and a scenario summarised as "3 changes". What somebody is actually doing here is
// deciding whether to DO the thing — so this leads with the difference, says which change caused it,
// and gives the decision somewhere to go (Apply to plan), which is the step that did not exist at all.

const CURVE = ["var(--ink-2)", "var(--caution)", "var(--signal)", "#7C5CBF"];

// ---- intent-first change picker ---------------------------------------------------------------------
//
// The old builder was a four-dropdown chain — what to change, which employee, which field, what value —
// which asks you to know the document's schema before you can ask a question. These are the questions
// people actually arrive with. "Something else" keeps the full schema reachable, so nothing is lost.
const INTENTS = [
  { id: "delay",  title: "Delay a hire",        blurb: "Push a start date out",       coll: "employees", field: "start" },
  { id: "drop",   title: "Don't hire someone",  blurb: "Take them out entirely",      coll: "employees", remove: true },
  { id: "salary", title: "Change a salary",     blurb: "Raise, cut, or correct",      coll: "employees", field: "amount" },
  // ADDING a round, as distinct from moving one. Every other intent edits something already in the
  // plan, so "what if we raised" could not be asked unless you had already entered the round you were
  // uncertain about — which is backwards.
  { id: "fund",   title: "Add a fundraise",    blurb: "A round that isn't in the plan yet", addRound: true },
  { id: "raise",  title: "Move a raise",        blurb: "Bring a round forward or back", coll: "rounds",  field: "closeMonth" },
  { id: "subs",   title: "Change churn or growth", blurb: "Subscription assumptions", coll: "saas",      field: "churnPct" },
  { id: "other",  title: "Something else",      blurb: "Any field, by hand",          other: true },
];

const MONTHS = Array.from({ length: HORIZON + 1 }, (_, i) => i);

// `onAdd` takes an ARRAY, always. Calling a single-patch version twice in one handler does not work:
// both calls read the same `editScn` snapshot, so the second silently overwrites the first — which is
// exactly what a fundraise needs to do (the round, plus switching financing on).
function ChangePicker({ baseDoc, ctx, onAdd }) {
  const [factor, setFactor] = useState(null);
  // DERIVED, NOT DUPLICATED. The form below still speaks `intent`; mapping the chosen factor onto the
  // nearest one keeps it working while the tiles drive the choice. The map is temporary and named so.
  const intent = useMemo(() => {
    const byFactor = { pay: "delay", cost: "other", proj: "other", sales: "other",
                       cap: "fund", saas: "subs", idx: "other", cash: "other", conf: "other" };
    return INTENTS.find(i => i.id === (byFactor[factor?.id] || "other")) || INTENTS[0];
  }, [factor]);
  const [mode, setMode] = useState("add");        // add | edit | del
  const [targetId, setTargetId] = useState(null);
  const [until, setUntil] = useState(null);       // null = remove entirely
  const [fv, setFv] = useState({});               // the factor form's values
  // "Something else" keeps the original generic path: pick a collection and a field by hand.

  // "Something else" can also reach the two NON-collection targets the old builder had — cash and the
  // revenue toggles. Dropping them because they didn't fit the intent tiles would be losing capability
  // to a redesign, which is the worst way to lose it.





  return (
    <div className="scn-picker">
      {/* ⚠️ THE TILES ARE THE EIGHT BUCKETS, not seven hardcoded intents. The old list could express
          "delay a hire" and could not express the eighth thing anybody wanted; the factors are the
          vocabulary somebody already has, so a scenario built from them is expressed in the same terms
          as the number it moves. */}
      <div className="scn-intents">
        {FACTORS.map(f => {
          const n = f.count ? f.count(baseDoc) : null;
          return (
            <button key={f.id} disabled={f.disabled}
                    className={"scn-intent" + (f.id === factor?.id ? " on" : "") + (f.disabled ? " off" : "")}
                    title={f.disabled ? f.why : undefined}
                    onClick={() => { setFactor(f); setMode("add"); setTargetId(null); setFv({}); setUntil(null); }}>
              <b>{f.name}</b><span>{f.blurb}</span>
              <em>{f.disabled ? "derived — not editable"
                   : n == null ? ""
                   : n === 0 ? "none yet" : `${n} ${n === 1 ? "item" : "items"}`}</em>
            </button>
          );
        })}
      </div>

      {factor && !factor.disabled && (
        <div className="scn-mode">
          {/* ADD / CHANGE / REMOVE. "Change existing" is the one that was missing: moving a round from
              Planning to Commitment letter is the scenario founders run most and used to take four
              steps. */}
          <div className="seg3">
            {[["add", "Add new"], ["edit", "Change existing"], ["del", "Remove existing"],
              ...(factor.adjust ? [["adjust", "Change overall"]] : [])].map(([k, l]) => (
              <button key={k} className={mode === k ? "on " + k : ""}
                      disabled={k !== "add" && !itemsOf(factor, baseDoc).length}
                      onClick={() => { setMode(k); setTargetId(null); setFv({}); setUntil(null); }}>{l}</button>
            ))}
          </div>
          {mode !== "add" && (
            <label className="fl">Which one
              <select className="sel" aria-label="Which one" value={targetId || ""}
                      onChange={e => setTargetId(e.target.value || null)}>
                <option value="">— choose —</option>
                {itemsOf(factor, baseDoc).map(it => (
                  <option key={it.id} value={it.id}>{it.label}</option>
                ))}
              </select>
            </label>
          )}
          {mode === "del" && targetId && (() => {
            const item = itemsOf(factor, baseDoc).find(x => x.id === targetId)?.raw;
            const dr = dateRemovable(factor, item || {});
            return (
              <>
                {/* ⚠️ REMOVAL FROM A DATE IS A FAILED GO/NO-GO EXPRESSED BY HAND. The plan holds gates
                    with a stated consequence; a scenario that stops an award at month 14 produces the
                    same numbers without connecting anything. The founder types the date rather than the
                    app inferring it, which is the whole argument for the isolation. */}
                <label className="fl">Remove
                  <select className="sel" aria-label="Remove" value={until == null ? "all" : "date"}
                          onChange={e => setUntil(e.target.value === "all" ? null : 12)}>
                    <option value="all">entirely — as if it never existed</option>
                    {dr.ok && <option value="date">from a date — it stops there</option>}
                  </select>
                  {!dr.ok && <span className="meta">{dr.why}</span>}
                </label>
                {until != null && (
                  <label className="fl">Stops after
                    <input className="inp" aria-label="Stops after" type="number" value={until}
                           onChange={e => setUntil(+e.target.value || 0)} />
                    <span className="meta">→ {monthLabel(ctx.START_Y, ctx.START_M, until)}</span>
                  </label>
                )}
                {factor.warn && <p className="scn-warn">{factor.warn}</p>}
              </>
            );
          })()}

          {/* ⚠️ THE FACTOR'S OWN FIELDS, not a generic collection/field pair. One registry drives this
              form and the real editor, so a scenario cannot express something the editor cannot open.
              In EDIT mode every field shows what it was — a scenario is a diff, and a form that shows
              only the new value makes you remember the old one, which is the moment people talk
              themselves into a change they did not mean. */}
          {mode === "adjust" && factor.adjust && (() => {
            const r = overheadAdjustment(baseDoc, fv.adjust);
            return (
              <>
                <label className="fl">{factor.adjust.l}
                  <input className="inp" type="number" aria-label={factor.adjust.l}
                         placeholder="-5000"
                         value={fv.adjust ?? ""}
                         onChange={e => setFv(v => ({ ...v, adjust: e.target.value }))} />
                  <span className="meta">{factor.adjust.help}</span>
                </label>
                {/* ⚠️ THE CLAMP IS SHOWN, NEVER SILENT. Somebody who types $80,000 against $52,000 of
                    overhead must see that the difference was refused — otherwise they read a runway
                    built on a number they did not enter. */}
                {r.clamped && (
                  <p className="scn-warn">
                    You are spending {money(r.max)} a month on overhead, so that is the most that can
                    be cut. This scenario uses <b>{money(r.amount)}</b>.
                  </p>
                )}
              </>
            );
          })()}

          {mode !== "del" && mode !== "adjust" && (factor.fields || []).length > 0
            && (mode === "add" || targetId || !factor.collection) && (
            <div className="scn-fields">
              {factor.fields.map(f => {
                const was = mode === "edit"
                  ? itemsOf(factor, baseDoc).find(x => x.id === targetId)?.raw?.[f.k] : undefined;
                return (
                  <label key={f.k} className="fl">{f.l}
                    {f.t === "select" ? (
                      <select className="sel" value={fv[f.k] ?? ""}
                              aria-label={factor.collection === "rounds" && !/^close/i.test(f.l)
                                ? "Round " + f.l.toLowerCase() : f.l}
                              onChange={e => setFv(v => ({ ...v, [f.k]: e.target.value }))}>
                        {/* ⚠️ NO PLACEHOLDER IN ADD MODE. In EDIT a blank means "leave this alone" and
                            is the correct default; in ADD it is a value nobody wants and the first real
                            option is the sensible one. A blank first entry also made the option list
                            differ from what it offers, which is what the test caught. */}
                        {mode === "edit" && <option value="">— unchanged —</option>}
                        {((mode === "edit" && f.editOpts) || f.opts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    ) : f.t === "tier" ? (
                      <select className="sel" aria-label={f.l} value={fv[f.k] ?? ""}
                              onChange={e => setFv(v => ({ ...v, [f.k]: e.target.value }))}>
                        {mode === "edit" && <option value="">— unchanged —</option>}
                        <option value="committed">Committed</option>
                        <option value="expected">Expected</option>
                        <option value="speculative">Speculative</option>
                      </select>
                    ) : f.t === "month" ? (
                      // ⚠️ A MONTH INDEX IS NOT A DATE ANYBODY CAN READ. "8" in a Starts field means
                      // eight months into the projection, which somebody has to compute from a start
                      // date they may not have in mind. Month and year are the form people think in;
                      // the index is what the model stores and is shown underneath so the two never
                      // disagree.
                      <MonthPick value={fv[f.k]} label={f.l} ctx={ctx}
                                 onChange={n => setFv(v => ({ ...v, [f.k]: n }))} />
                    ) : f.t === "bool" ? (
                      <input type="checkbox" aria-label={f.l}
                             checked={fv[f.k] === true}
                             onChange={e => setFv(v => ({ ...v, [f.k]: e.target.checked }))} />
                    ) : (
                      // THE OLD FORM'S ARIA NAMES were "Round name" / "Round amount". Keeping the
                      // factor's own visible label while matching the established aria name means
                      // neither a screen-reader user nor a test has to relearn the form.
                      <input className="inp"
                             aria-label={factor.collection === "rounds" && !/^close/i.test(f.l)
                               ? "Round " + f.l.toLowerCase() : f.l}
                             type={f.t === "text" ? "text" : "number"}
                             value={fv[f.k] ?? ""} placeholder={mode === "edit" ? "unchanged" : ""}
                             onChange={e => setFv(v => ({ ...v, [f.k]: e.target.value }))} />
                    )}
                    {was !== undefined && was !== "" && <span className="meta">was: {String(was)}</span>}
                  </label>
                );
              })}
            </div>
          )}

          {/* ⚠️ A PLANNED OR RAISING ROUND COUNTS AS SPECULATIVE, and speculative is off by default —
              so a scenario adding one shows NO CHANGE and reads as a broken feature rather than as a
              correct answer about money that might not arrive. The old fundraise form said this and it
              was lost with the form. It is a warning, not a block: "what if we raise and it stays
              speculative" is a legitimate question. */}
          {factor.collection === "rounds" && mode === "add"
            && (fv.status === "planning" || fv.status === "raising") && (
            <p className="scn-warn">
              A round that is only planned or still being raised counts as <b>speculative</b>, and
              speculative revenue is switched off — so this will show no change until you turn it on.
            </p>
          )}

          <button className="addbtn scn-addch"
                  disabled={buildPatches(factor, { mode, targetId, values: fv, until }, baseDoc).length === 0}
                  onClick={() => {
                    onAdd(buildPatches(factor, { mode, targetId, values: fv, until }, baseDoc));
                    setFv({}); setTargetId(null); setUntil(null);
                  }}>
            Add this change
          </button>
        </div>
      )}

      {/* ⚠️ THE OLD INTENT FORM IS GONE. It rendered ALONGSIDE the factor form for the same choice —
          two forms for one intent, which is why the selectors resolved unpredictably and why three
          rounds of adjusting test assertions got nowhere. `buildPatches` covers every case it did,
          including the two it could not: editing an existing item field by field, and removing one
          from a date. */}

    </div>
  );
}

// ---- one scenario, as a card ------------------------------------------------------------------------
function ScenarioCard({ scn, impact, ctx, baseDoc, stale = [], comparing, onCompare, onEdit, onDuplicate, onApply, onDelete }) {
  const chips = (scn.patches || []).slice(0, 4).map((p, i) => {
    const e = explainPatch(p, baseDoc, ctx);
    return <span className="scn-ch" key={i}>{e.text}{e.was != null && e.was !== e.text && <em> , was {e.was}</em>}</span>;
  });
  const more = (scn.patches || []).length - chips.length;

  return (
    <div className={"scn-card" + (comparing ? " on" : "")}>
      <div className="scn-card-h">
        <span className="scn-card-nm">{scn.name}</span>
        {/* ⚠️ THE FLAG LIVES ON THE SCENARIO, and again on the chart when a stale one is drawn. A
            warning only in the editor would leave somebody looking at a curve built on a premise that
            no longer holds, with nothing on screen saying so. */}
        {stale.length > 0 && (
          <span className="scn-stalebadge" title={stale.map(stalenessText).join("\n")}>
            {stale.length} changed
          </span>
        )}
        <DeltaChip impact={impact} />
      </div>

      <div className="scn-card-run">
        <b className="num">{runwayText(impact)}</b>
        <span>{zeroText(impact, ctx)}</span>
      </div>

      <div className="scn-chs">
        {chips.length ? chips : <span className="scn-ch empty">No changes yet</span>}
        {more > 0 && <span className="scn-ch empty">+{more} more</span>}
      </div>

      <div className="scn-card-acts">
        <label className="scn-cmp">
          <input type="checkbox" checked={comparing} onChange={onCompare} />
          {comparing ? "Comparing" : "Compare"}
        </label>
        <button className="linkbtn" onClick={onEdit}>Edit</button>
        <button className="linkbtn" onClick={onDuplicate}>Duplicate</button>
        {/* ABSENT WITHOUT A HANDLER, not inert. An advisor works in their own scenario layer and cannot
            write the company's model at all — a button that quietly did nothing would be worse than
            one that is not there, because they would keep pressing it. */}
        {onApply && <button className="linkbtn scn-apply" onClick={onApply}>Apply to plan</button>}
        <button className="iconbtn" onClick={onDelete} aria-label={`Delete ${scn.name}`}>{I.trash}</button>
      </div>
    </div>
  );
}

const runwayText = (i) =>
  i.months != null ? `${i.months.toFixed(1)} mo` : i.cashFlowPositive ? "cash-flow positive" : `${HORIZON}+ mo`;

// Says which of the two "no zero date" cases this is. They are NOT the same thing, and the old legend
// called both of them cash-positive.
const zeroText = (i, ctx) =>
  i.months != null ? `zero in ${monthLabel(ctx.START_Y, ctx.START_M, Math.round(i.months))}`
    : i.cashFlowPositive ? "revenue covers costs" : "still burning";

function DeltaChip({ impact }) {
  if (impact.delta == null) {
    return <span className="scn-chip flat">{impact.months == null ? "no zero date" : "—"}</span>;
  }
  if (Math.abs(impact.delta) < 0.05) return <span className="scn-chip flat">no change</span>;
  const up = impact.delta > 0;
  return <span className={"scn-chip " + (up ? "up" : "dn")}>{up ? "+" : "−"}{Math.abs(impact.delta).toFixed(1)} mo</span>;
}

export function Scenarios({ baseDoc, buildModel, scenarios, setScenarios, onApplyToPlan }) {
  const { START_Y, START_M } = useStart();
  const ctx = useMemo(() => ({ START_Y, START_M }), [START_Y, START_M]);
  const [activeIds, setActiveIds] = useState(scenarios.map(s => s.id).slice(0, 2));
  const [editing, setEditing] = useState(null);
  const [applying, setApplying] = useState(null);
  const [applyOk, setApplyOk] = useState(false);

  const editScn = scenarios.find(s => s.id === editing);

  const upsert = (scn) => setScenarios(list => list.some(s => s.id === scn.id)
    ? list.map(s => (s.id === scn.id ? scn : s))     // keeps ORDER — the old version moved the edited
    : [...list, scn]);                                // scenario to the end of the list on every keystroke
  const remove = (id) => { setScenarios(list => list.filter(s => s.id !== id)); setActiveIds(a => a.filter(x => x !== id)); };
  const startNew = () => { const s = emptyScenario(); setScenarios(list => [...list, s]); setEditing(s.id); };
  const duplicate = (scn) => { const c = duplicateScenario(scn); setScenarios(list => [...list, c]); setEditing(c.id); };
  const toggleActive = (id) => setActiveIds(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id].slice(-3));

  const impacts = useMemo(() => {
    const m = {};
    for (const s of scenarios) m[s.id] = scenarioImpact(baseDoc, s);
    return m;
  }, [baseDoc, scenarios]);

  const series = useMemo(() => {
    const mk = (name, color, doc) => {
      const rows = buildProjection(buildModel(doc), doc.settings.toggles);
      return { name, color, rows, zero: zeroInfo(rows) };
    };
    const out = [mk("Your plan", CURVE[0], baseDoc)];
    activeIds.forEach((id, i) => {
      const scn = scenarios.find(s => s.id === id);
      // ⚠️ THE CURVE CARRIES ITS OWN STALENESS. The chart is the only place a toggled-on scenario is
      // visible, so a flag that lived only in the editor would leave somebody reading a line built on a
      // premise that no longer holds. It NAMES the scenario, because with three curves a bare warning
      // says something is wrong and not which line to distrust.
      if (scn) out.push({ ...mk(scn.name, CURVE[(i + 1) % CURVE.length], applyScenario(baseDoc, scn)),
                          stale: staleness(baseDoc, scn) });
    });
    return out;
  }, [baseDoc, activeIds, scenarios, buildModel]);

  // chart geometry
  const W = 760, H = 280, PADL = 64, PADR = 20, PADT = 20, PADB = 36;
  const allBal = series.flatMap(s => s.rows.map(r => r.end));
  const vMax = Math.max(0, ...allBal), vMin = Math.min(0, ...allBal);
  const span = (vMax - vMin) || 1;
  const x = (t) => PADL + (t / HORIZON) * (W - PADL - PADR);
  const y = (v) => PADT + (1 - (v - vMin) / span) * (H - PADT - PADB);
  const path = (rows) => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(r.end).toFixed(1)}`).join(" ");

  const baseImpact = useMemo(() => scenarioImpact(baseDoc, emptyScenario()), [baseDoc]);

  return (
    <div className="view">
      <div className="vhead">
        <div>
          <h2>Scenarios</h2>
          <p>Try a change against your plan without touching it. Compare up to three at once.</p>
        </div>
        <button className="addbtn" onClick={startNew}>{I.plus} New scenario</button>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-h"><div>
          <h3>Runway comparison</h3>
          <p>Your plan, solid. Scenarios dashed. Dots mark the month cash reaches zero.</p>
        </div></div>

        <svg viewBox={`0 0 ${W} ${H}`} className="scn-svg" preserveAspectRatio="xMidYMid meet" role="img"
             aria-label="Cash balance over the horizon for your plan and the scenarios being compared">
          <line x1={PADL} x2={W - PADR} y1={y(0)} y2={y(0)} className="scn-zero" />
          {[vMax, 0, vMin].filter((v, i, a) => a.indexOf(v) === i).map((v, i) => (
            <text key={i} x={PADL - 8} y={y(v) + 3} className="scn-ytick">{money(v)}</text>
          ))}
          {MONTHS.filter(m => m % 6 === 0).map(m => (
            <text key={m} x={x(m)} y={H - 12} className="scn-xtick">{monthLabel(START_Y, START_M, m)}</text>
          ))}
          {series.map((s, i) => (
            <path key={i} d={path(s.rows)} fill="none"
                  style={{ stroke: s.color, strokeWidth: i === 0 ? 2.4 : 1.8, strokeDasharray: s.stale?.length ? "3 5" : i === 0 ? "none" : "5 3" }} />
          ))}
          {/* WHERE EACH LINE HITS ZERO. The chart used to make you find the crossing by eye. */}
          {series.map((s, i) => s.zero && s.zero.months != null && (
            <g key={"z" + i}>
              <circle cx={x(s.zero.months)} cy={y(0)} r="4" style={{ fill: s.color }} />
              <text x={x(s.zero.months)} y={y(0) - 9} className="scn-xtick" style={{ fill: s.color }}>
                {s.zero.months.toFixed(1)}
              </text>
            </g>
          ))}
        </svg>
        {/* ⚠️ THE CHART SAYS WHICH LINE TO DISTRUST. With three curves a bare warning tells you
            something is wrong and not which one — the same failure as a disclosure triangle with
            nothing beside it. */}
        {series.some(s => s.stale?.length) && (
          <div className="scn-stale">
            {series.filter(s => s.stale?.length).map((s, i) => (
              <div key={i}>
                <b style={{ color: s.color }}>{s.name}</b> — built against different figures:{" "}
                {s.stale.map(stalenessText).join(" ")}
              </div>
            ))}
          </div>
        )}

        {/* The delta strip: difference, and what caused it. */}
        <div className="scn-deltas">
          <div className="scn-d">
            <div className="scn-d-top"><i className="scn-sw2" style={{ background: CURVE[0] }} /><span>Your plan</span></div>
            <div className="scn-d-fig"><b className="num">{runwayText(baseImpact)}</b><span className="scn-chip flat">baseline</span></div>
            <div className="scn-d-why">{zeroText(baseImpact, ctx)}.</div>
          </div>
          {activeIds.map((id, i) => {
            const scn = scenarios.find(s => s.id === id);
            if (!scn) return null;
            const im = impacts[id];
            const drv = im.driver ? explainPatch(im.driver, baseDoc, ctx) : null;
            return (
              <div className="scn-d" key={id}>
                <div className="scn-d-top"><i className="scn-sw2" style={{ background: CURVE[(i + 1) % CURVE.length] }} /><span>{scn.name}</span></div>
                <div className="scn-d-fig"><b className="num">{runwayText(im)}</b><DeltaChip impact={im} /></div>
                <div className="scn-d-why">
                  {Math.abs(im.burnDelta) > 100 && (
                    <>Monthly net moves <b>{moneyFull(Math.abs(im.burnDelta))}</b> {im.burnDelta > 0 ? "in your favour" : "against you"}. </>
                  )}
                  {/* Attribution is leave-one-out: the change whose REMOVAL moves the runway most. */}
                  {drv && <>Mostly <b>{drv.text}</b>.</>}
                  {!drv && (scn.patches || []).length === 0 && <>No changes yet.</>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {scenarios.length === 0 ? (
        <div className="panel"><div className="scn-empty">
          No scenarios yet. Make one to ask a what-if — a delayed hire, a round landing early, churn
          doubling — and see what it does to the runway before you commit to it.
        </div></div>
      ) : (
        <div className="scn-cards">
          {scenarios.map(scn => (
            <ScenarioCard key={scn.id} scn={scn} impact={impacts[scn.id]} ctx={ctx} baseDoc={baseDoc}
              comparing={activeIds.includes(scn.id)}
              onCompare={() => toggleActive(scn.id)}
              onEdit={() => setEditing(scn.id)}
              onDuplicate={() => duplicate(scn)}
              stale={staleness(baseDoc, scn)}
              onApply={onApplyToPlan ? () => { setApplyOk(false); setApplying(scn); } : null}
              onDelete={() => remove(scn.id)} />
          ))}
        </div>
      )}

      {/* ---- editor ---- */}
      {editScn && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" style={{ width: "min(720px,100%)" }} onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <input className="inp scn-title" value={editScn.name} aria-label="Scenario name"
                       onChange={e => upsert({ ...editScn, name: e.target.value })} />
                <div className="modal-sub">Each change stacks on your plan; your plan is never touched.</div>
              </div>
              <button className="modal-x" onClick={() => setEditing(null)} aria-label="Close">×</button>
            </div>

            <div className="modal-body">
              <ChangePicker baseDoc={baseDoc} ctx={ctx}
                            onAdd={(patches) => upsert(withFingerprints(baseDoc, {
                              // ⚠️ THE ONE CALL THAT MAKES STALENESS WORK. Without it no patch ever
                              // carries an `fp`, `staleness()` skips every patch that lacks one, and the
                              // whole feature is INERT — the badge never shows, the chart flag never
                              // shows, and apply-to-plan never asks for acknowledgement. The engine and
                              // all three display sites were built; this line was not written, and
                              // fifteen passing tests hid it because they build fingerprints by hand.
                              //
                              // It belongs HERE because a fingerprint records what a patch read AT THE
                              // MOMENT IT WAS WRITTEN. Attaching it later would record the wrong instant
                              // and quietly report every scenario as fresh.
                              ...editScn, patches: [...editScn.patches, ...patches],
                            }))} />

              {/* LIVE EFFECT. The old editor let you add changes blind, close the modal, and only then
                  see what they did — so building a scenario was a guess followed by a reveal. */}
              <div className="scn-live">
                <span>Runway with these changes</span>
                <span className="scn-live-r">
                  <span className="scn-was-run num">{runwayText(baseImpact)}</span>
                  <b className="num">{runwayText(impacts[editScn.id] || baseImpact)}</b>
                  <DeltaChip impact={impacts[editScn.id] || baseImpact} />
                </span>
              </div>

              <div className="imp-section" style={{ marginTop: 18 }}>Changes in this scenario</div>
              {editScn.patches.length > 0 ? (
                <div className="scn-chs">
                  {editScn.patches.map((p, i) => {
                    const e = explainPatch(p, baseDoc, ctx);
                    return (
                      <span className="scn-ch rm" key={i}>
                        {e.text}{e.was != null && e.was !== e.text && <em> , was {e.was}</em>}
                        <button className="scn-x" aria-label={`Remove change: ${e.text}`}
                                onClick={() => upsert({ ...editScn, patches: editScn.patches.filter((_, j) => j !== i) })}>×</button>
                      </span>
                    );
                  })}
                </div>
              ) : <div className="scn-nochange">Nothing yet — pick a question above.</div>}
            </div>

            {/* No Save button, because there never really was one: edits already wrote straight through,
                and the save/unsaved distinction the old footer advertised did nothing at all. */}
            <div className="modal-foot">
              <button className="addbtn ghost" onClick={() => { duplicate(editScn); }}>Duplicate as a new scenario</button>
              <button className="addbtn" onClick={() => setEditing(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- apply to plan ---- */}
      {applying && (
        <div className="modal-overlay" onClick={() => setApplying(null)}>
          <div className="modal" style={{ width: "min(560px,100%)" }} onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <div className="modal-title">Apply "{applying.name}" to your plan?</div>
                <div className="modal-sub">This edits your real model. It is the one thing on this tab that does.</div>
              </div>
              <button className="modal-x" onClick={() => setApplying(null)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <div className="scn-chs">
                {applying.patches.map((p, i) => {
                  const e = explainPatch(p, baseDoc, ctx);
                  return <span className="scn-ch" key={i}>{e.text}{e.was != null && e.was !== e.text && <em> , was {e.was}</em>}</span>;
                })}
                {applying.patches.length === 0 && <span className="scn-ch empty">Nothing to apply</span>}
              </div>
              <div className="scn-live" style={{ marginTop: 16 }}>
                <span>Runway after applying</span>
                <span className="scn-live-r">
                  <span className="scn-was-run num">{runwayText(baseImpact)}</span>
                  <b className="num">{runwayText(impacts[applying.id])}</b>
                  <DeltaChip impact={impacts[applying.id]} />
                </span>
              </div>
              <div className="cf-fine" style={{ marginTop: 14 }}>
                The changes are written into your model as ordinary edits — you can change any of them
                afterwards on their own tab. The scenario stays here so you can keep comparing against it.
              </div>
            </div>
            {staleness(baseDoc, applying).length > 0 && (
              <div className="scn-stale hard">
                <b>{staleness(baseDoc, applying).length} change{staleness(baseDoc, applying).length === 1 ? "" : "s"} no longer match the model.</b>
                <ul>{staleness(baseDoc, applying).map((e, i2) => <li key={i2}>{stalenessText(e)}</li>)}</ul>
                <label className="scn-ack">
                  <input type="checkbox" checked={applyOk} onChange={ev => setApplyOk(ev.target.checked)} />
                  Apply anyway — I have read what changed
                </label>
              </div>
            )}
            <div className="modal-foot">
              <button className="addbtn ghost" onClick={() => setApplying(null)}>Cancel</button>
              {/* ⚠️ APPLYING IS THE ONE IRREVERSIBLE ACTION IN THE FEATURE — it writes the scenario
                  into the real document. A stale scenario applied here writes changes whose premise has
                  already moved, and unlike the chart you cannot undo it by toggling off. So this path
                  CONFIRMS rather than merely flagging: it is the only place where "the person saw a
                  warning" is not sufficient, because the cost of ignoring it is permanent. */}
              <button className="addbtn"
                      disabled={applying.patches.length === 0
                                || (staleness(baseDoc, applying).length > 0 && !applyOk)}
                      onClick={() => { onApplyToPlan?.(applyScenario(baseDoc, applying)); setApplying(null); }}>
                Apply to plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A month/year pair that stores a month index.
 *
 *  THE INDEX IS THE STORED VALUE and the date is the readable one, so both are on screen and cannot
 *  drift apart. Blank means "unchanged" in edit mode, which is why an empty value stays empty rather
 *  than collapsing to month 0.
 */
function MonthPick({ value, label, ctx, onChange }) {
  const startY = ctx?.START_Y ?? 2026, startM = ctx?.START_M ?? 0;
  const has = value !== "" && value != null && Number.isFinite(+value);
  const idx = has ? +value : null;
  const d = new Date(startY, startM + (idx ?? 0), 1);
  const set = (y, m) => onChange((y - startY) * 12 + (m - startM));

  return (
    <>
      <span className="mpick">
        <select className="sel" aria-label={label} value={has ? d.getMonth() : ""}
                onChange={e => set(has ? d.getFullYear() : startY, +e.target.value)}>
          <option value="">—</option>
          {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            .map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <select className="sel" aria-label={`${label} year`} value={has ? d.getFullYear() : ""}
                onChange={e => set(+e.target.value, has ? d.getMonth() : startM)}>
          <option value="">—</option>
          {Array.from({ length: 8 }, (_, i) => startY + i - 1)
            .map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </span>
      {/* THE INDEX, UNDERNEATH. It is what the model stores and what an agency form asks for, so a
          person checking their own arithmetic can see both without opening another tab. */}
      <span className="meta">{has ? `month ${idx} of the projection` : "unchanged"}</span>
    </>
  );
}
