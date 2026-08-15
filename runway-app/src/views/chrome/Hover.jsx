import { useState, useRef, useCallback } from "react";
import { formatFor } from "../../engine/measures";
import { valueAt, indexAt, placeTip } from "../../engine/hover";
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
    const i = indexAt(px, { left: 0, width: box.w, n });
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
      return { i, px: box.x + (box.w * i) / Math.max(1, n - 1), py: box.y + box.h / 2 };
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
