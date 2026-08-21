import { useState, useRef, useCallback } from "react";
import { formatFor } from "../../engine/measures";
import { valueAt, indexAt, xOfIndex, placeTip, rowAt, rowIndexAt } from "../../engine/hover";
import { moneyFull } from "../../engine/money";

// ⚠️ UNITS AND FORMATS ARE DIFFERENT VOCABULARIES, and this file had its own third version of the
// mapping. A measure declares `percent` meaning 0-100; the renderer's `percent` means a fraction.
// **Three implementations of one translation is three chances to disagree** — which is what produced
// "$24 subscribers" while the axis beside it said 24.
// The unit-to-format translation lives in `measures.js` — see UNIT_FORMAT there.

const fmt = (v, f) => {
  if (!Number.isFinite(v)) return "";
  if (f === "percent") return `${Math.round(v * 100)}%`;
  if (f === "pct100") return `${Math.round(v)}%`;
  if (f === "count" || f === "people") return String(Math.round(v));
  return moneyFull(v);
};

/** A row formats in ITS OWN unit, falling back to the chart's only when it has none. */
const fmtRow = (r, chartFormat) => fmt(r.value, formatFor(r, chartFormat));

/** The values under the pointer.
 *
 *  ⚠️ ONE OVERLAY, ONE HANDLER. Not a listener per series and no hit-testing in the renderers — the
 *  spec holds every value, so this reads the spec and the drawing is left alone.
 */
/** Bar-shaped specs put their values in slots. Everything else places them at points. */
const isBand = (spec) => spec?.kind === "bars";

export function HoverLayer({ spec, box, ctx = {}, format }) {
  const [at, setAt] = useState(null);      // { i, px, py }
  const ref = useRef(null);

  const move = useCallback((e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // ⚠️ `r` IS THE RECT, SO THESE ARE ALREADY RELATIVE TO THE PLOT'S LEFT EDGE. Passing `left: box.x`
    // subtracted the padding a SECOND time — the left third of every chart clamped to index 0 and the
    // last index was unreachable. The offset belongs in one place, and the rect has already applied it.
    const px = ((e.clientX - r.left) / (r.width || 1)) * box.w;
    const py = ((e.clientY - r.top) / (r.height || 1)) * box.h;
    const n = spec?.x?.length || spec?.series?.[0]?.values?.length || 0;
    // ⚠️ BARS OCCUPY SLOTS, LINES SIT AT POINTS. `Bars` lays out `groupW = pw / n` and centres each
    // group half a slot in; the point model reads the centres correctly and every boundary wrong.
    const i = indexAt(px, { left: 0, width: box.w, n, band: isBand(spec) });
    // STORED IN VIEWBOX UNITS, and offset back to the canvas for the guide line and the tooltip.
    if (i != null) setAt({ i, px: box.x + px, py: box.y + py });
  }, [spec, box]);

  // ⚠️ ARROW KEYS MOVE THE MONTH, ESCAPE DISMISSES. The values have to be reachable without a pointer —
  // the accessibility requirements of this customer base are a procurement question, not a preference,
  // and a chart whose numbers are mouse-only fails it.
  const key = useCallback((e) => {
    const n = spec?.x?.length || 0;
    if (!n) return;
    if (e.key === "Escape") { setAt(null); return; }
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    setAt(p => {
      const i = Math.max(0, Math.min(n - 1, (p?.i ?? 0) + d));
      // Same model as the pointer, so an arrowed guide line lands ON the bar rather than on its edge.
      return { i, px: box.x + xOfIndex(i, { width: box.w, n, band: isBand(spec) }), py: box.y + box.h / 2 };
    });
  }, [spec, box]);

  const v = at ? valueAt(spec, at.i, ctx) : null;
  const tip = at ? placeTip(at.px, at.py, { w: box.x + box.w + 40, h: box.y + box.h + 40 }) : null;

  return (
    <>
      {/* THE GUIDE LINE, so the tooltip and the chart agree about which column is being read. */}
      {at && (
        <line x1={box.x + (box.w * at.i) / Math.max(1, (spec?.x?.length || 1) - 1)} y1={box.y}
              x2={box.x + (box.w * at.i) / Math.max(1, (spec?.x?.length || 1) - 1)} y2={box.y + box.h}
              className="hv-guide" />
      )}
      <rect ref={ref} x={box.x} y={box.y} width={box.w} height={box.h}
            fill="transparent" tabIndex={0} className="hv-hit"
            role="application" aria-label="Chart values — use the arrow keys"
            onMouseMove={move} onMouseLeave={() => setAt(null)}
            // TAP SHOWS, TAP ELSEWHERE DISMISSES. There is no hover on a phone, and a chart whose
            // values are mouse-only is a chart half the audience cannot read.
            onPointerDown={move} onKeyDown={key} onBlur={() => setAt(null)} />
      {v && tip && (
        <foreignObject x={tip.x} y={tip.y} width="230" height="180" className="hv-fo">
          <div className="hv-tip" xmlns="http://www.w3.org/1999/xhtml">
            <div className="hv-m">
              <span>{v.label}</span>
              {/* ⚠️ NOT DECORATION. A precise number feels like a fact; this is what keeps a modelled
                  figure from reading as a recorded one. */}
              {v.projected && <span className="chip">projected</span>}
            </div>
            {v.rows.map(r => (
              <div className={"hv-r" + (r.dim ? " dim" : "")} key={r.id}>
                <i style={{ background: r.color || `var(--${r.tone || "signal"})` }} />
                <span>{r.label}</span>
                {r.axis === "right" && <span className="hv-ax">right</span>}
                <b>{fmtRow(r, format || v.format)}</b>
              </div>
            ))}
            {/* ⚠️ A SUBTOTAL PER BREAKDOWN, NAMED. "Total" alone is ambiguous the moment a chart has a
                breakdown AND a second measure — it has to say WHICH measure it totals. */}
            {(v.groups || []).map(g => (
              <div className="hv-r hv-t" key={g.group}>
                <span>{g.label}</span><b>{fmt(g.value, format || v.format)}</b>
              </div>
            ))}
            {v.total != null && (
              <div className="hv-r hv-t"><span>Stack total</span><b>{fmt(v.total, format || v.format)}</b></div>
            )}
            {v.band && (
              <div className="hv-f">Range {fmt(v.band.lo, v.format)} to {fmt(v.band.hi, v.format)}</div>
            )}
            {v.categorical && (
              <div className="hv-f">Totalled across the whole window — there is no time axis here.</div>
            )}
          </div>
        </foreignObject>
      )}
    </>
  );
}


/** Values for a ROW-shaped chart — `HBars`, `Pace`, `Goals`, `Milestones`, `Diverging`.
 *
 *  ⚠️ A SEPARATE COMPONENT, BECAUSE THE GEOMETRY IS SEPARATE. Rows are a fixed height and the thing
 *  under the pointer is one row, not a column across every series. Sharing `HoverLayer` would have
 *  meant a flag inside it choosing between two coordinate systems — which is how `spec.rows` and
 *  `spec.series` got conflated in the lens.
 */
export function RowHoverLayer({ spec, box, rowH, format }) {
  const [at, setAt] = useState(null);
  const ref = useRef(null);
  const count = (spec?.rows || []).length;

  const move = useCallback((e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !count) return;
    const py = ((e.clientY - r.top) / (r.height || 1)) * box.h;
    const px = ((e.clientX - r.left) / (r.width || 1)) * box.w;
    const i = rowIndexAt(py, { top: 0, rowH, count });
    setAt(i == null ? null : { i, px: box.x + px, py: box.y + py });
  }, [box, rowH, count]);

  const key = useCallback((e) => {
    if (!count) return;
    if (e.key === "Escape") { setAt(null); return; }
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    setAt(p => {
      const i = Math.max(0, Math.min(count - 1, (p?.i ?? -1) + d));
      return { i, px: box.x + box.w / 2, py: box.y + i * rowH + rowH / 2 };
    });
  }, [box, rowH, count]);

  const v = at ? rowAt(spec, at.i) : null;
  const tip = at ? placeTip(at.px, at.py, { w: box.x + box.w + 40, h: box.y + box.h + 40 }) : null;

  return (
    <>
      {/* THE HOVERED ROW IS BANDED, not underlined — a row is an area, and a rule beneath it reads as
          belonging to the row below. */}
      {at && (
        <rect x={box.x} y={box.y + at.i * rowH} width={box.w} height={rowH}
              className="hv-band" />
      )}
      <rect ref={ref} x={box.x} y={box.y} width={box.w} height={box.h}
            fill="transparent" tabIndex={0} className="hv-hit"
            role="application" aria-label="Chart values — use the arrow keys"
            onMouseMove={move} onMouseLeave={() => setAt(null)}
            onPointerDown={move} onKeyDown={key} onBlur={() => setAt(null)} />
      {v && tip && (
        <foreignObject x={tip.x} y={tip.y} width="230" height="180" className="hv-fo">
          <div className="hv-tip" xmlns="http://www.w3.org/1999/xhtml">
            <div className="hv-m"><span>{v.label}</span></div>
            {v.parts.map((p, i) => (
              <div className="hv-r" key={i}>
                <i style={{ background: p.color || `var(--${p.tone || "signal"})` }} />
                <span>{p.label}</span>
                <b>{fmt(p.value, format || v.format)}</b>
              </div>
            ))}
            {v.total != null && (
              <div className="hv-r hv-t"><span>Total</span><b>{fmt(v.total, format || v.format)}</b></div>
            )}
            {v.note && <div className="hv-f">{v.note}</div>}
          </div>
        </foreignObject>
      )}
    </>
  );
}
