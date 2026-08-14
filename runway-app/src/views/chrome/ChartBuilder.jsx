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

      <div className="cb-row">
        <span className="cb-l">Broken down by</span>
        <select className="sel cb-sel" value={cfg.by || ""} disabled={ids.length > 1}
                onChange={e => setCfg(c => ({ ...c, by: e.target.value || null }))}>
          <option value="">Nothing — one series each</option>
          {dims.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        {ids.length > 1 && (
          <span className="meta">unavailable with {ids.length} measures — pick one to break down</span>
        )}
      </div>

      <div className="cb-row">
        <span className="cb-l">Across</span>
        <select className="sel cb-sel" value={cfg.across || "month"}
                onChange={e => setCfg(c => ({ ...c, across: e.target.value }))}>
          <option value="month">Month</option>
          <option value="category">Category — no time axis</option>
        </select>
      </div>

      {/* ⚠️ TYPE IS PER MEASURE, NOT PER CHART. Two flows as bars with a balance as a line over them is
          the most useful chart in the product, and a single global switch cannot express it. */}
      {/* ⚠️ ORIENTATION IS CHART-LEVEL; SHAPE AND STACKING ARE PER MEASURE. That split is what lets
          obligations stack while cash rides over them as a line — one chart, two shapes. */}
      {ids.length > 0 && canOrientY(cfg.across) && (
        <div className="cb-row">
          <span className="cb-l">Categories on</span>
          <div className="seg3">
            {[["x", "X axis"], ["y", "Y axis"]].map(([k, l]) => (
              <button key={k} className={(cfg.orient || "x") === k ? "on" : ""}
                      onClick={() => setCfg(c => ({ ...c, orient: k }))}>{l}</button>
            ))}
          </div>
          <span className="meta">vertical bars, or horizontal — better for long names</span>
        </div>
      )}
      {ids.length > 0 && !canOrientY(cfg.across) && (
        <p className="cb-note">
          {/* TIME READS LEFT TO RIGHT AND THAT IS NOT A PREFERENCE. Months down the Y axis is legal
              SVG and unreadable to anybody, so the control is absent rather than present and refused. */}
          Categories run along the X axis while the chart is across months.
        </p>
      )}

      {ids.length > 0 && (
        <table className="cb-types">
          <tbody>
            {cfg.measures.map(m => {
              const def = measureById(m.id);
              const refusal = stackRefusal([def], over.filter(o => o.outer === m.id || o.inner === m.id));
              const ax = axesFor(cfg.measures.map(x => ({ ...measureById(x.id), axis: x.axis })))
                .find(a => a.id === m.id);
              return (
                <tr key={m.id}>
                  <td>{def?.label}</td>
                  <td>
                    <span className="seg3 mini">
                      {SHAPES.map(([k, l]) => (
                        <button key={k} className={(m.shape || "lines") === k ? "on" : ""}
                                onClick={() => setType(m.id, { shape: k })}>{l}</button>
                      ))}
                    </span>
                  </td>
                  <td>
                    {/* ⚠️ STACKING REFUSES IN BOTH SHAPES WHERE THE PARTS DO NOT SUM. A stacked LINE
                        asserts the same falsehood as a stacked bar. */}
                    <label className={"cb-tog" + (m.stacked ? " on" : "")} title={refusal || undefined}>
                      <input type="checkbox" checked={!!m.stacked} disabled={!!refusal}
                             onChange={e => setType(m.id, { stacked: e.target.checked })} />
                      Stacked
                    </label>
                  </td>
                  <td>
                    {/* THE SECOND UNIT GOES RIGHT BY DEFAULT — a good default and a poor rule, since
                        two money measures at very different magnitudes want the choice too. */}
                    <span className="seg3 mini">
                      {[["left", "L"], ["right", "R"]].map(([k, l]) => (
                        <button key={k} className={ax?.axis === k ? "on" : ""}
                                title={`${k} value axis`}
                                onClick={() => setType(m.id, { axis: k })}>{l}</button>
                      ))}
                    </span>
                    <span className="meta"> {def?.unit}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

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
