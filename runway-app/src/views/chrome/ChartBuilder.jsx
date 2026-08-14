import { useState } from "react";
import { measuresFor, measureById, overlaps, unitsOf, allowedTypes } from "../../engine/measures";
import { dimensionsFor } from "../../engine/dimensions";
import { SHAPES, canOrientY, stackRefusal, axesFor } from "../../engine/charttype";

// ⚠️ THE RENDERER'S NAMES. `lines` is plural, and there is no `area` renderer at all — offering one
// would be offering a chart type that draws nothing.

/** The four choices: Plot, Broken down by, Across, and a type per measure.
 *
 *  ⚠️ UNSAVED AND PRIVATE. Everything here is component state. Changing the chart replaces the default
 *  IN THIS VIEW and nowhere else — no save, no confirmation, no effect on anybody. **Experimenting has
 *  to be free or nobody experiments**, and saving is a separate, deliberate act.
 *
 *  The engine computes; this explains. Every refusal below is `buildCustom`'s decision, surfaced with a
 *  reason rather than shown as a control that quietly does nothing.
 */
export function ChartBuilder({ tab, cfg, setCfg, onClose, onSave, canSave = true }) {
  const measures = measuresFor(tab);
  const dims = dimensionsFor(tab);
  const ids = (cfg.measures || []).map(m => m.id);
  const over = overlaps(ids);
  const units = unitsOf(ids);

  const toggle = (id) => setCfg(c => {
    const has = (c.measures || []).some(m => m.id === id);
    const next = has ? c.measures.filter(m => m.id !== id)
                     : [...(c.measures || []), { id, type: null }];
    // ⚠️ A BREAKDOWN AND SEVERAL MEASURES CANNOT BOTH APPLY. Three measures by eight codes is
    // twenty-four series from two reasonable choices, so picking a second measure drops the breakdown
    // rather than producing a chart nobody can read.
    return { ...c, measures: next, by: next.length > 1 ? null : c.by };
  });

  const setType = (id, patch) =>
    setCfg(c => ({ ...c, measures: c.measures.map(m => (m.id === id ? { ...m, ...patch } : m)) }));

  return (
    <div className="cb">
      <div className="cb-row">
        <span className="cb-l">Plot</span>
        <div className="cb-pills">
          {measures.map(m => {
            const on = ids.includes(m.id);
            const clash = over.find(o => (o.outer === m.id || o.inner === m.id));
            return (
              <button key={m.id} className={"cb-pill" + (on ? " on" : "") + (on && clash ? " warn" : "")}
                      onClick={() => toggle(m.id)}>
                {m.label}{on && clash ? " ⚠" : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* ⚠️ SHOWN, NOT ENFORCED. "Money out, and how much of it is payroll" is a legitimate chart of
          exactly this shape. Only STACKING is refused, because a stack asserts the parts sum to the
          whole — and that refusal happens in the type control below, where it is visible. */}
      {over.length > 0 && (
        <p className="cb-warn">
          {over.map(o => `${measureById(o.inner)?.label} is already counted inside ${measureById(o.outer)?.label}`)
               .join("; ")}. Plotted together they will not sum to your total.
        </p>
      )}

      {units.length > 2 && (
        <p className="cb-warn hard">
          Three different units cannot share a chart. Drop one — two is already a compromise.
        </p>
      )}
      {units.length === 2 && (
        <p className="cb-note">{measureById(ids.find(i => measureById(i)?.unit === units[1]))?.label} is
          measured in {units[1]}, so it uses the right-hand axis.</p>
      )}

      {/* ⚠️ CHART-LEVEL FIRST, THEN A BLOCK PER DATASET. Breakdown moved DOWN here, which is the
          change with the most reach: it makes "spend split by project, with cash over it" expressible —
          the chart the old builder could not describe, because one breakdown applied to everything. */}
      <div className="cb-row">
        <span className="cb-l">Across</span>
        <select className="sel cb-sel" value={cfg.across || "month"}
                onChange={e => setCfg(c => ({ ...c, across: e.target.value }))}>
          <option value="month">Month</option>
          {dims.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        {canOrientY(cfg.across) && (
          <>
            <span className="cb-l" style={{ minWidth: 0 }}>on</span>
            <div className="seg3">
              {[["x", "X axis"], ["y", "Y axis"]].map(([k, l]) => (
                <button key={k} className={(cfg.orient || "x") === k ? "on" : ""}
                        onClick={() => setCfg(c => ({ ...c, orient: k }))}>{l}</button>
              ))}
            </div>
          </>
        )}
      </div>

      {cfg.measures.map(m => {
        const def = measureById(m.id);
        const refusal = stackRefusal([def], over.filter(o => o.outer === m.id || o.inner === m.id));
        const ax = axesFor(cfg.measures.map(x => ({ ...measureById(x.id), axis: x.axis })))
          .find(a => a.id === m.id);
        // A BALANCE HAS NO PARTS, so it cannot be broken down — stated in its own block, beside the
        // control, rather than as a chart-wide warning naming a measure the reader has to go find.
        const splittable = !def?.position;
        return (
          <div className="cb-ds" key={m.id}>
            <div className="cb-ds-h">
              <span className="cb-ds-n">{def?.label}</span>
              <span className="chip">{def?.unit}</span>
            </div>
            <div className="cb-ds-g">
              <label className="fl">Broken down by
                <select className="sel" value={m.by || ""} disabled={!splittable}
                        onChange={e => setType(m.id, { by: e.target.value || null })}>
                  <option value="">Nothing — one series</option>
                  {dims.filter(d => d.id !== cfg.across)
                       .map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                {!splittable && <span className="meta">a balance has no parts</span>}
              </label>
              <label className="fl">Plot type
                <span className="seg3 mini">
                  {SHAPES.map(([k, l]) => (
                    <button key={k} className={(m.shape || "lines") === k ? "on" : ""}
                            onClick={() => setType(m.id, { shape: k })}>{l}</button>
                  ))}
                </span>
              </label>
              <label className="fl">Stacked
                <span className={"cb-tog" + (m.stacked ? " on" : "")} title={refusal || undefined}>
                  <input type="checkbox" checked={!!m.stacked} disabled={!!refusal}
                         onChange={e => setType(m.id, { stacked: e.target.checked })} />
                  {refusal ? "No" : m.stacked ? "Yes" : "No"}
                </span>
              </label>
              <label className="fl">Value axis
                <span className="seg3 mini">
                  {[["left", "Left"], ["right", "Right"]].map(([k, l]) => (
                    <button key={k} className={ax?.axis === k ? "on" : ""}
                            onClick={() => setType(m.id, { axis: k })}>{l}</button>
                  ))}
                </span>
              </label>
            </div>
            {refusal && <p className="meta cb-ref">{refusal}</p>}
          </div>
        );
      })}

      <div className="cb-acts">
        <button className="linkbtn" onClick={onClose}>Done</button>
        <span className="meta" style={{ marginRight: "auto" }}>
          Yours until you save it. Nobody else sees this.
        </span>
        {canSave && (
          <button className="addbtn" disabled={!ids.length} onClick={onSave}>Save for the company</button>
        )}
      </div>
    </div>
  );
}

/** Naming it is the last step, and the only place typing is required.
 *
 *  ⚠️ NOT FOR TIDINESS — being made to name what a chart shows is the cheapest available check that the
 *  person knows. An unsaved view needs no name because nobody else will read it.
 */
export function SaveChartBar({ onSave, onCancel, editingName = null }) {
  // AN EDIT ARRIVES WITH ITS NAME ALREADY IN THE BOX, so the common case is one click. Renaming is
  // still possible; it is simply not required to fix a chart.
  const [name, setName] = useState(editingName || "");
  return (
    <div className="cb-save">
      <input className="inp" aria-label="Chart name" value={name} autoFocus
             placeholder="Name this chart" onChange={e => setName(e.target.value)} />
      <span className="meta">{editingName ? "Updates it for everyone on this company" : "Adds it to Change chart for everyone on this company"}</span>
      <button className="addbtn ghost" onClick={onCancel}>Cancel</button>
      <button className="addbtn" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button>
    </div>
  );
}
