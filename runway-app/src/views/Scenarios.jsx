import React, { useMemo, useState } from "react";
import { applyScenario, explainPatch, emptyScenario, duplicateScenario, scenarioImpact,
         PATCH_SCHEMA, TOP_LEVEL_FIELDS, TOGGLE_FIELDS, itemLabel } from "../engine/scenario";
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
  { id: "raise",  title: "Move a raise",        blurb: "Bring a round forward or back", coll: "rounds",  field: "closeMonth" },
  { id: "subs",   title: "Change churn or growth", blurb: "Subscription assumptions", coll: "saas",      field: "churnPct" },
  { id: "other",  title: "Something else",      blurb: "Any field, by hand",          other: true },
];

const MONTHS = Array.from({ length: HORIZON + 1 }, (_, i) => i);

function ChangePicker({ baseDoc, ctx, onAdd }) {
  const [intent, setIntent] = useState(INTENTS[0]);
  const [itemId, setItemId] = useState("");
  const [value, setValue] = useState("");
  // "Something else" keeps the original generic path: pick a collection and a field by hand.
  const [otherColl, setOtherColl] = useState("");
  const [otherField, setOtherField] = useState("");

  // "Something else" can also reach the two NON-collection targets the old builder had — cash and the
  // revenue toggles. Dropping them because they didn't fit the intent tiles would be losing capability
  // to a redesign, which is the worst way to lose it.
  const special = intent.other && (otherColl === "field:cash" || otherColl === "toggle") ? otherColl : null;
  const coll = special ? null : (intent.other ? otherColl : intent.coll);
  const field = special ? null : (intent.other ? otherField : intent.field);
  const items = coll ? (baseDoc[coll] || []) : [];
  const def = coll && field ? PATCH_SCHEMA[coll]?.fields?.[field] : null;
  const current = items.find(x => x.id === itemId);

  const pick = (i) => { setIntent(i); setItemId(""); setValue(""); setOtherColl(""); setOtherField(""); };

  const ready = special ? (special === "toggle" ? !!(otherField && value !== "") : value !== "")
    : intent.remove ? !!itemId
    : !!(itemId && field && value !== "");

  const add = () => {
    if (special === "field:cash") { onAdd({ kind: "field", path: "cash", value: Number(value) }); setValue(""); return; }
    if (special === "toggle") { onAdd({ kind: "toggle", path: otherField, value: value === "on" }); setValue(""); return; }
    if (intent.remove) onAdd({ kind: "remove", collection: coll, id: itemId });
    else {
      const v = def?.type === "select"
        ? (def.options.find(o => String(o[0]) === String(value)) || [value])[0]
        : def?.type === "money" || def?.type === "months" || def?.type === "number" || def?.type === "percent"
          ? Number(value) : value;
      onAdd({ kind: "item", collection: coll, id: itemId, field, value: v });
    }
    setItemId(""); setValue("");
  };

  const valueField = () => {
    if (!def) return null;
    if (def.type === "months") {
      return <select className="sel" value={value} onChange={e => setValue(e.target.value)} aria-label={def.label}>
        <option value="" disabled>Choose…</option>
        {MONTHS.map(m => <option key={m} value={m}>{monthLabel(ctx.START_Y, ctx.START_M, m)}</option>)}
      </select>;
    }
    if (def.type === "select") {
      return <select className="sel" value={value} onChange={e => setValue(e.target.value)} aria-label={def.label}>
        <option value="" disabled>Choose…</option>
        {def.options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>;
    }
    return <input className="inp num" type="number" value={value} aria-label={def.label}
                  placeholder={def.type === "percent" ? "%" : ""} onChange={e => setValue(e.target.value)} />;
  };

  return (
    <div className="scn-picker">
      <div className="scn-intents">
        {INTENTS.map(i => (
          <button key={i.id} className={"scn-intent" + (i.id === intent.id ? " on" : "")} onClick={() => pick(i)}>
            <b>{i.title}</b><span>{i.blurb}</span>
          </button>
        ))}
      </div>

      <div className="scn-form">
        {intent.other && (
          <>
            <label className="scn-f"><span>Where</span>
              <select className="sel" value={otherColl} aria-label="Where"
                      onChange={e => { setOtherColl(e.target.value); setOtherField(""); setItemId(""); }}>
                <option value="" disabled>Choose…</option>
                <optgroup label="Company">
                  {Object.entries(TOP_LEVEL_FIELDS).map(([k, d]) => <option key={k} value={"field:" + k}>{d.label}</option>)}
                  <option value="toggle">Revenue toggle</option>
                </optgroup>
                <optgroup label="Items">
                  {Object.entries(PATCH_SCHEMA).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
                </optgroup>
              </select>
            </label>
            {special === "toggle" && (
              <label className="scn-f"><span>Which</span>
                <select className="sel" value={otherField} onChange={e => { setOtherField(e.target.value); setValue(""); }} aria-label="Which toggle">
                  <option value="" disabled>Choose…</option>
                  {TOGGLE_FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}
            {special === "toggle" && otherField && (
              <label className="scn-f"><span>Set to</span>
                <select className="sel" value={value} onChange={e => setValue(e.target.value)} aria-label="On or off">
                  <option value="" disabled>Choose…</option><option value="on">On</option><option value="off">Off</option>
                </select>
              </label>
            )}
            {special === "field:cash" && (
              <label className="scn-f"><span>Cash on hand</span>
                <input className="inp num" type="number" value={value} aria-label="Cash on hand"
                       onChange={e => setValue(e.target.value)} />
              </label>
            )}
            {otherColl && !special && (
              <label className="scn-f"><span>Change what</span>
                <select className="sel" value={otherField} aria-label="Change what"
                        onChange={e => { setOtherField(e.target.value); setValue(""); }}>
                  <option value="" disabled>Choose…</option>
                  {Object.entries(PATCH_SCHEMA[otherColl]?.fields || {}).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
                </select>
              </label>
            )}
          </>
        )}

        {coll && (
          <label className="scn-f"><span>Which</span>
            <select className="sel" value={itemId} onChange={e => setItemId(e.target.value)} aria-label="Which one">
              <option value="" disabled>Choose…</option>
              {items.map(it => <option key={it.id} value={it.id}>{itemLabel(it)}</option>)}
            </select>
          </label>
        )}

        {!intent.remove && def && <label className="scn-f"><span>{def.label}</span>{valueField()}</label>}

        {/* The old value, in place, so a change is a decision rather than a bare fact. */}
        {current && field && !intent.remove && (
          <span className="scn-was">was {explainPatch({ kind: "item", collection: coll, id: itemId, field, value: current[field] }, baseDoc, ctx).text.replace(`${itemLabel(current)} `, "")}</span>
        )}

        <button className="addbtn scn-addch" disabled={!ready} onClick={add}>Add this change</button>
      </div>

      {items.length === 0 && coll && (
        <div className="scn-none">Nothing to change here yet — add {PATCH_SCHEMA[coll].label.toLowerCase()} on its own tab first.</div>
      )}
    </div>
  );
}

// ---- one scenario, as a card ------------------------------------------------------------------------
function ScenarioCard({ scn, impact, ctx, baseDoc, comparing, onCompare, onEdit, onDuplicate, onApply, onDelete }) {
  const chips = (scn.patches || []).slice(0, 4).map((p, i) => {
    const e = explainPatch(p, baseDoc, ctx);
    return <span className="scn-ch" key={i}>{e.text}{e.was != null && e.was !== e.text && <em> , was {e.was}</em>}</span>;
  });
  const more = (scn.patches || []).length - chips.length;

  return (
    <div className={"scn-card" + (comparing ? " on" : "")}>
      <div className="scn-card-h">
        <span className="scn-card-nm">{scn.name}</span>
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
        <button className="linkbtn scn-apply" onClick={onApply}>Apply to plan</button>
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
      if (scn) out.push(mk(scn.name, CURVE[(i + 1) % CURVE.length], applyScenario(baseDoc, scn)));
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
                  style={{ stroke: s.color, strokeWidth: i === 0 ? 2.4 : 1.8, strokeDasharray: i === 0 ? "none" : "5 3" }} />
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
              onApply={() => setApplying(scn)}
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
                            onAdd={(patch) => upsert({ ...editScn, patches: [...editScn.patches, patch] })} />

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
            <div className="modal-foot">
              <button className="addbtn ghost" onClick={() => setApplying(null)}>Cancel</button>
              <button className="addbtn" disabled={applying.patches.length === 0}
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
