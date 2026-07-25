import React, { useMemo, useState } from "react";
import { applyScenario, describePatch, emptyScenario, newScenarioId,
         PATCH_SCHEMA, TOP_LEVEL_FIELDS, TOGGLE_FIELDS } from "../engine/scenario";
import { buildProjection, zeroInfo } from "../engine/projection";
import { money, moneyFull } from "../engine/money";
import { HORIZON, monthLabel } from "../engine/time";
import { useStart } from "../state/StartCtx";
import { I } from "./chrome/icons";

// Colors for base + scenario curves in the compare chart.
const CURVE_COLORS = ["var(--ink-2)", "var(--signal)", "var(--caution)", "#7c5cbf"];

// The generic patch builder: collection → item → field → value. Produces one patch and hands it up.
function PatchBuilder({ baseDoc, onAdd }) {
  const [target, setTarget] = useState("");     // "field:cash" | "toggle" | "coll:employees"
  const [itemId, setItemId] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");

  // build the target menu: top-level fields, toggles, then each collection
  const reset = () => { setItemId(""); setField(""); setValue(""); };

  const kind = target.startsWith("field:") ? "field" : target.startsWith("coll:") ? "item" : target === "toggle" ? "toggle" : "";
  const collection = kind === "item" ? target.slice(5) : null;
  const schema = collection ? PATCH_SCHEMA[collection] : null;
  const items = collection ? (baseDoc[collection] || []) : [];
  const fieldDef = kind === "field" ? TOP_LEVEL_FIELDS[target.slice(6)]
    : kind === "item" && field ? schema?.fields[field] : null;

  const itemName = (it) => it.name || it.title || it.role || it.customer || it.po || it.id;

  const canAdd = kind === "toggle" ? (field && value !== "")
    : kind === "field" ? (value !== "")
    : kind === "item" ? (itemId && field && value !== "") : false;

  const coerce = (raw, def) => {
    if (!def) return raw;
    if (def.type === "money" || def.type === "months" || def.type === "number") return Number(raw);
    if (def.type === "select") {
      const opt = def.options.find(o => String(o[0]) === String(raw));
      return opt ? opt[0] : raw;
    }
    return raw;
  };

  const add = () => {
    let patch;
    if (kind === "field") patch = { kind: "field", path: target.slice(6), value: coerce(value, fieldDef) };
    else if (kind === "toggle") patch = { kind: "toggle", path: field, value: value === "on" };
    else patch = { kind: "item", collection, id: itemId, field, value: coerce(value, fieldDef) };
    onAdd(patch);
    setTarget(""); reset();
  };

  const valueInput = () => {
    const def = fieldDef;
    if (kind === "toggle") {
      return <select className="sel" value={value} onChange={e => setValue(e.target.value)}>
        <option value="" disabled>on/off…</option><option value="on">On</option><option value="off">Off</option>
      </select>;
    }
    if (def?.type === "select") {
      return <select className="sel" value={value} onChange={e => setValue(e.target.value)}>
        <option value="" disabled>Choose…</option>
        {def.options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>;
    }
    const suffix = def?.type === "money" ? "$" : def?.type === "months" ? "month #" : "";
    return <div className="scn-inwrap">
      {suffix === "$" && <em>$</em>}
      <input className="inp" type="number" value={value} placeholder={def?.type === "months" ? "0" : ""} onChange={e => setValue(e.target.value)} />
      {suffix === "month #" && <em>month #</em>}
    </div>;
  };

  return (
    <div className="scn-builder">
      <select className="sel" value={target} onChange={e => { setTarget(e.target.value); reset(); }}>
        <option value="" disabled>What to change…</option>
        <optgroup label="Company">
          {Object.entries(TOP_LEVEL_FIELDS).map(([k, d]) => <option key={k} value={"field:" + k}>{d.label}</option>)}
          <option value="toggle">Revenue toggle</option>
        </optgroup>
        <optgroup label="Items">
          {Object.entries(PATCH_SCHEMA).map(([k, d]) => <option key={k} value={"coll:" + k}>{d.label}</option>)}
        </optgroup>
      </select>

      {kind === "toggle" && (
        <select className="sel" value={field} onChange={e => setField(e.target.value)}>
          <option value="" disabled>Which…</option>
          {TOGGLE_FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}

      {kind === "item" && (
        <>
          <select className="sel" value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="" disabled>Which {schema.label.toLowerCase()}…</option>
            {items.map(it => <option key={it.id} value={it.id}>{itemName(it)}</option>)}
          </select>
          <select className="sel" value={field} onChange={e => { setField(e.target.value); setValue(""); }}>
            <option value="" disabled>Change what…</option>
            {Object.entries(schema.fields).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
        </>
      )}

      {(kind === "field" || (kind === "item" && field) || (kind === "toggle" && field)) && valueInput()}
      <button className="addbtn" disabled={!canAdd} onClick={add}>{I.plus} Add change</button>
    </div>
  );
}

// A small runway curve for the compare chart.
function compareRows(doc) {
  const model = { cashOnHand: doc.cash, horizon: HORIZON, lineItems: doc._lines || [] };
  return model;
}

export function Scenarios({ baseDoc, buildModel, scenarios, setScenarios }) {
  const { START_Y, START_M } = useStart();
  const [activeIds, setActiveIds] = useState(scenarios.filter(s => s.saved).map(s => s.id).slice(0, 2));
  const [editing, setEditing] = useState(null);   // scenario id being edited, or null

  const editScn = scenarios.find(s => s.id === editing);

  const upsert = (scn) => setScenarios(list => {
    const others = list.filter(s => s.id !== scn.id);
    return [...others, scn];
  });
  const remove = (id) => { setScenarios(list => list.filter(s => s.id !== id)); setActiveIds(a => a.filter(x => x !== id)); };
  const startNew = () => { const s = emptyScenario(); setScenarios(list => [...list, s]); setEditing(s.id); };
  const toggleActive = (id) => setActiveIds(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id].slice(-3));

  // Build base + each active scenario's projection. buildModel(doc) turns a document into the engine
  // model (line items etc) exactly as App does — so a scenario runs through the identical pipeline.
  const series = useMemo(() => {
    const mk = (name, color, doc) => {
      const model = buildModel(doc);
      const rows = buildProjection(model, doc.settings.toggles);
      return { name, color, rows, zero: zeroInfo(rows) };
    };
    const out = [mk("Base", CURVE_COLORS[0], baseDoc)];
    activeIds.forEach((id, i) => {
      const scn = scenarios.find(s => s.id === id);
      if (scn) out.push(mk(scn.name, CURVE_COLORS[(i + 1) % CURVE_COLORS.length], applyScenario(baseDoc, scn)));
    });
    return out;
  }, [baseDoc, activeIds, scenarios, buildModel]);

  // zeroInfo returns NULL — not `{ months: null }` — when the balance never crosses zero, which happens
  // whenever the plan is cash-positive or simply outlives the horizon. `engine/labor.js` says so in a
  // comment; this view was written believing the other thing and dereferenced `.months` on it, which is
  // a white screen for anybody whose model has cash and no burn yet. That is not an exotic state: it is
  // EVERY brand-new account between entering cash and adding the first expense.
  //
  // Collapse both "never crosses" shapes into one nullable number so no caller has to know the difference.
  const monthsOf = (z) => (z && z.months != null ? z.months : null);
  const baseMonths = monthsOf(series[0]?.zero);

  // chart geometry
  const W = 720, H = 260, PADL = 60, PADR = 16, PADT = 16, PADB = 30;
  const allBal = series.flatMap(s => s.rows.map(r => r.end));
  const vMax = Math.max(0, ...allBal), vMin = Math.min(0, ...allBal);
  const span = (vMax - vMin) || 1;
  const x = (t) => PADL + (t / HORIZON) * (W - PADL - PADR);
  const y = (v) => PADT + (1 - (v - vMin) / span) * (H - PADT - PADB);
  const path = (rows) => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(r.end).toFixed(1)}`).join(" ");

  return (
    <div className="view">
      <div className="vhead">
        <div><h2>Scenarios</h2><p>Model what-ifs against your base plan. Each scenario overlays changes; nothing here touches your real numbers.</p></div>
        <button className="addbtn" onClick={startNew}>{I.plus} New scenario</button>
      </div>

      {/* compare chart */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><div><h3>Runway comparison</h3><p>Base plus up to three scenarios. Toggle scenarios on the right to include them.</p></div></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="scn-svg" preserveAspectRatio="xMidYMid meet">
          <line x1={PADL} x2={W - PADR} y1={y(0)} y2={y(0)} className="scn-zero" />
          {[vMax, 0, vMin].filter((v, i, a) => a.indexOf(v) === i).map((v, i) => (
            <text key={i} x={PADL - 8} y={y(v) + 3} className="scn-ytick">{money(v)}</text>
          ))}
          {Array.from({ length: HORIZON + 1 }, (_, m) => m).filter(m => m % 3 === 0).map(m => (
            <text key={m} x={x(m)} y={H - 10} className="scn-xtick">{monthLabel(START_Y, START_M, m)}</text>
          ))}
          {series.map((s, i) => (
            <path key={i} d={path(s.rows)} fill="none" style={{ stroke: s.color, strokeWidth: i === 0 ? 2.4 : 1.8, strokeDasharray: i === 0 ? "none" : "5 3" }} />
          ))}
        </svg>
        <div className="scn-legend">
          {series.map((s, i) => {
            const m = monthsOf(s.zero);
            return (
              <span key={i}><i className="scn-sw" style={{ background: s.color }} />{s.name}
                <b className="num">{m == null ? "cash-positive" : `${m.toFixed(1)} mo`}</b>
                {i > 0 && m != null && baseMonths != null && (
                  <em className={"scn-delta" + (m >= baseMonths ? " up" : " down")}>
                    {m >= baseMonths ? "+" : ""}{(m - baseMonths).toFixed(1)} mo
                  </em>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* scenario list */}
      <div className="panel">
        <div className="panel-h"><div><h3>Your scenarios</h3><p>Check to compare. Saved scenarios persist; unsaved ones vanish on reload.</p></div></div>
        {scenarios.length === 0 ? (
          <div className="scn-empty">No scenarios yet. Create one to model a what-if.</div>
        ) : (
          <table className="tbl">
            <thead><tr><th /><th>Name</th><th>Changes</th><th>Runway</th><th /></tr></thead>
            <tbody>{scenarios.map(scn => {
              const applied = applyScenario(baseDoc, scn);
              const rows = buildProjection(buildModel(applied), applied.settings.toggles);
              const zm = monthsOf(zeroInfo(rows));
              return (
                <tr key={scn.id}>
                  <td><input type="checkbox" checked={activeIds.includes(scn.id)} onChange={() => toggleActive(scn.id)} /></td>
                  <td style={{ fontWeight: 600 }}>{scn.name}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{scn.patches.length === 0 ? "—" : scn.patches.length + " change" + (scn.patches.length > 1 ? "s" : "")}</td>
                  <td className="num" style={{ fontSize: 12.5 }}>{zm == null ? "cash+" : zm.toFixed(1) + " mo"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="linkbtn" onClick={() => setEditing(scn.id)}>Edit</button>
                    <button className="iconbtn" onClick={() => remove(scn.id)} aria-label={`Delete ${scn.name}`}>{I.trash}</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      {/* editor */}
      {editScn && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" style={{ width: "min(640px,100%)" }} onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <div><div className="modal-title">Edit scenario</div><div className="modal-sub">Add changes; each overlays the base plan.</div></div>
              <button className="modal-x" onClick={() => setEditing(null)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <label className="scn-namef"><span>Name</span>
                <input className="inp" style={{ textAlign: "left" }} value={editScn.name} onChange={e => upsert({ ...editScn, name: e.target.value })} />
              </label>

              <div className="imp-section" style={{ marginTop: 16 }}>Changes</div>
              {editScn.patches.length > 0 ? (
                <div className="scn-patches">
                  {editScn.patches.map((p, i) => (
                    <div className="scn-patch" key={i}>
                      <span>{describePatch(p, baseDoc)}</span>
                      <button className="iconbtn" onClick={() => upsert({ ...editScn, patches: editScn.patches.filter((_, j) => j !== i) })} aria-label="Remove change">{I.trash}</button>
                    </div>
                  ))}
                </div>
              ) : <div className="scn-nochange">No changes yet — add one below.</div>}

              <div className="imp-section" style={{ marginTop: 16 }}>Add a change</div>
              <PatchBuilder baseDoc={baseDoc} onAdd={(patch) => upsert({ ...editScn, patches: [...editScn.patches, patch] })} />
            </div>
            <div className="modal-foot">
              <button className="addbtn ghost" onClick={() => { upsert({ ...editScn, saved: false }); setEditing(null); }}>Keep unsaved</button>
              <button className="addbtn" onClick={() => { upsert({ ...editScn, saved: true }); setEditing(null); }}>Save scenario</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
